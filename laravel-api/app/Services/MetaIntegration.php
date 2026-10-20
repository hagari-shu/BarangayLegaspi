<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class MetaIntegration
{
    public function status(): array
    {
        $config = config('services.meta');
        $facebook = !empty($config['page_id'])
            && !empty($config['page_access_token'])
            && !empty($config['graph_api_version']);

        return [
            'facebook' => $facebook,
            'messenger' => $facebook && !empty($config['app_secret']) && !empty($config['webhook_verify_token']),
        ];
    }

    public function verifySignature(string $body, ?string $signature): bool
    {
        $secret = (string) config('services.meta.app_secret');
        if ($secret === '' || !is_string($signature) || !preg_match('/^sha256=([a-f0-9]{64})$/i', $signature, $matches)) {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $body, $secret), strtolower($matches[1]));
    }

    public function processWebhook(array $payload): void
    {
        if (($payload['object'] ?? null) !== 'page' || !is_array($payload['entry'] ?? null)) {
            return;
        }

        $pageId = (string) config('services.meta.page_id');
        foreach ($payload['entry'] as $entry) {
            if (!is_array($entry) || (string) ($entry['id'] ?? '') !== $pageId) {
                continue;
            }
            foreach (($entry['messaging'] ?? []) as $event) {
                if (!is_array($event)) {
                    continue;
                }
                $psid = $event['sender']['id'] ?? null;
                if (!is_string($psid) || $psid === '' || $psid === $pageId || !empty($event['message']['is_echo'])) {
                    continue;
                }
                $timestamp = $event['timestamp'] ?? null;
                $lastMessageAt = now()->setTimestamp(
                    is_numeric($timestamp) ? (int) floor(((float) $timestamp) / 1000) : now()->timestamp,
                );
                $text = strtolower(trim((string) ($event['message']['text'] ?? '')));

                if (in_array($text, ['subscribe', 'subscribe announcements'], true)) {
                    $this->upsertSubscriber($psid, true, $lastMessageAt);
                    $this->sendMessage($psid, 'You are subscribed to Barangay Legaspi announcements on Messenger. You can opt out anytime by sending STOP.');
                } elseif (in_array($text, ['stop', 'unsubscribe'], true)) {
                    $this->upsertSubscriber($psid, false, $lastMessageAt);
                    $this->sendMessage($psid, 'You have been unsubscribed from announcement messages.');
                } else {
                    $this->recordContact($psid, $lastMessageAt);
                    if (!empty($event['message']['text']) || !empty($event['postback'])) {
                        $this->sendMessage($psid, 'To receive Barangay Legaspi announcements here, reply SUBSCRIBE. Reply STOP anytime to opt out.');
                    }
                }
            }
        }
    }

    private function upsertSubscriber(string $psid, bool $optedIn, mixed $lastMessageAt): void
    {
        DB::table('messenger_subscribers')->updateOrInsert(
            ['psid' => $psid],
            ['opted_in' => $optedIn, 'last_message_at' => $lastMessageAt, 'updated_at' => now()],
        );
    }

    private function recordContact(string $psid, mixed $lastMessageAt): void
    {
        $subscriber = DB::table('messenger_subscribers')->where('psid', $psid)->exists();
        if ($subscriber) {
            DB::table('messenger_subscribers')->where('psid', $psid)->update([
                'last_message_at' => $lastMessageAt,
                'updated_at' => now(),
            ]);
        } else {
            $this->upsertSubscriber($psid, false, $lastMessageAt);
        }
    }

    private function sendMessage(string $recipientId, string $text): void
    {
        $config = config('services.meta');
        $version = (string) ($config['graph_api_version'] ?? '');
        $pageId = (string) ($config['page_id'] ?? '');
        if (!preg_match('/^v\d+\.\d+$/', $version) || $pageId === '') {
            throw new \RuntimeException('Messenger integration is not configured.');
        }

        $response = Http::asForm()->timeout(10)->post(
            'https://graph.facebook.com/'.$version.'/'.rawurlencode($pageId).'/messages',
            [
                'access_token' => $config['page_access_token'],
                'recipient' => json_encode(['id' => $recipientId], JSON_THROW_ON_ERROR),
                'messaging_type' => 'RESPONSE',
                'message' => json_encode(['text' => $text], JSON_THROW_ON_ERROR),
            ],
        );
        if (!$response->successful() || !is_string($response->json('message_id')) || $response->json('message_id') === '') {
            throw new \RuntimeException('Meta did not confirm the Messenger message.');
        }
    }
}
