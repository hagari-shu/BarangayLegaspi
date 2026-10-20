<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class MediaRoutesTest extends TestCase
{
    use RefreshDatabase;

    private int $userNumber = 0;

    private function bearerFor(string $role): string
    {
        $id = (string) \Illuminate\Support\Str::uuid();
        $this->userNumber++;
        DB::table('users')->insert([
            'id' => $id,
            'first_name' => 'Media',
            'last_name' => 'Tester',
            'mobile' => sprintf('09170000%03d', $this->userNumber),
            'email' => 'media-'.$this->userNumber.'@example.test',
            'password_hash' => password_hash('TestPassword123!', PASSWORD_BCRYPT),
            'role' => $role,
            'household_id' => 'media-test',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'Active Resident',
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 1,
            'availability' => 'Available',
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);
        $token = 'media-route-token-'.$this->userNumber;
        DB::table('api_tokens')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'user_id' => $id,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);

        return $token;
    }

    public function test_public_image_routes_preserve_embedding_and_empty_resource_behavior(): void
    {
        $this->get('/api/captain-photo')
            ->assertNoContent()
            ->assertHeader('Cross-Origin-Resource-Policy', 'cross-origin')
            ->assertHeader('Cache-Control', 'no-store, private');

        $this->get('/api/official-profiles/not-a-role/photo')
            ->assertNotFound()
            ->assertHeader('Cross-Origin-Resource-Policy', 'cross-origin')
            ->assertHeader('Cache-Control', 'no-store, private');

        $this->getJson('/api/system-logo')->assertNotFound();
    }

    public function test_image_upload_requires_admin_and_rejects_unsupported_types_before_storage(): void
    {
        $this->postJson('/api/admin/captain-photo/upload-url', ['contentType' => 'image/gif'])
            ->assertUnauthorized();

        $token = $this->bearerFor('admin');
        $this->withToken($token)
            ->postJson('/api/admin/captain-photo/upload-url', ['contentType' => 'image/gif'])
            ->assertBadRequest()
            ->assertExactJson(['message' => 'Choose a JPEG, PNG, or WebP image.']);

        $this->withToken($token)
            ->postJson('/api/admin/captain-photo/upload-url', ['contentType' => 'image/png'])
            ->assertStatus(503)
            ->assertExactJson(['message' => 'Image storage is not configured.']);

        $residentToken = $this->bearerFor('resident');
        $this->withToken($residentToken)
            ->postJson('/api/admin/captain-photo/upload-url', ['contentType' => 'image/jpeg'])
            ->assertForbidden();
    }

    public function test_configured_storage_returns_a_five_minute_limited_signed_post(): void
    {
        config([
            'services.object_storage.bucket' => 'test-media-bucket',
            'services.object_storage.key' => 'test-access-key',
            'services.object_storage.secret' => 'test-secret-key',
            'services.object_storage.region' => 'us-east-1',
            'services.object_storage.endpoint' => null,
            'services.object_storage.use_path_style_endpoint' => false,
        ]);
        $token = $this->bearerFor('admin');

        $response = $this->withToken($token)
            ->postJson('/api/admin/captain-photo/upload-url', ['contentType' => 'image/png'])
            ->assertOk();
        $fields = $response->json('fields');
        $this->assertStringStartsWith('https://test-media-bucket.s3.amazonaws.com', $response->json('url'));
        $this->assertStringStartsWith('official/captain-portrait/pending/', $response->json('key'));
        $this->assertSame($response->json('key'), $fields['key']);
        $this->assertSame('image/png', $fields['Content-Type']);

        $policy = json_decode(base64_decode($fields['Policy'], true), true, 512, JSON_THROW_ON_ERROR);
        $this->assertContains(['content-length-range', 1, 5 * 1024 * 1024], $policy['conditions']);
        $this->assertContains(['Content-Type' => 'image/png'], $policy['conditions']);
    }

    public function test_remaining_media_admin_routes_enforce_roles_and_report_missing_storage(): void
    {
        $admin = $this->bearerFor('admin');
        $this->withToken($admin)
            ->postJson('/api/admin/system-logo/upload-url', ['contentType' => 'image/jpeg'])
            ->assertStatus(503);
        $this->withToken($admin)->postJson('/api/admin/system-logo', ['key' => 'branding/system-logo/pending/id'])
            ->assertStatus(503);
        $this->withToken($admin)->deleteJson('/api/admin/system-logo')->assertStatus(503);
        $this->withToken($admin)
            ->postJson('/api/admin/captain-photo', ['key' => 'official/captain-portrait/pending/id'])
            ->assertStatus(503);
        $this->withToken($admin)->deleteJson('/api/admin/captain-photo')->assertStatus(503);

        $staff = $this->bearerFor('staff');
        $this->withToken($staff)
            ->postJson('/api/admin/official-profiles/secretary/photo/upload-url', ['contentType' => 'image/webp'])
            ->assertStatus(503);
        $this->withToken($staff)
            ->postJson('/api/admin/official-profiles/secretary/photo', ['key' => 'official/secretary-portrait/pending/id'])
            ->assertStatus(503);
        $this->withToken($staff)
            ->deleteJson('/api/admin/official-profiles/secretary/photo')
            ->assertStatus(503);

        $this->get('/api/official-profiles/captain/photo')
            ->assertNoContent()
            ->assertHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        $this->withToken($admin)->getJson('/api/official-profiles/unknown/photo')->assertNotFound();
        $this->withToken($admin)->postJson('/api/admin/official-profiles/unknown/photo', [])->assertNotFound();
    }

    public function test_official_profiles_are_seeded_and_updatable_by_staff_with_audit(): void
    {
        $this->getJson('/api/official-profiles')
            ->assertOk()
            ->assertJsonCount(3, 'profiles')
            ->assertJsonPath('profiles.0.role', 'captain')
            ->assertJsonPath('profiles.0.photoUrl', null);

        $token = $this->bearerFor('staff');
        $this->withToken($token)
            ->putJson('/api/admin/official-profiles/captain', [
                'displayName' => '<Maria Santos>',
                'profileUrl' => 'https://example.test/profile',
                'groupUrl' => '',
                'communityLinks' => ['https://example.test/community'],
            ])
            ->assertOk()
            ->assertJsonPath('profile.displayName', 'Maria Santos')
            ->assertJsonPath('profile.groupUrl', 'https://example.test/community')
            ->assertJsonPath('profile.communityLinks.0', 'https://example.test/community');

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'official-profile.updated',
            'target_type' => 'official_profile',
            'target_id' => 'captain',
        ]);

        $this->withToken($token)
            ->putJson('/api/admin/official-profiles/captain', [
                'displayName' => 'Invalid link',
                'profileUrl' => 'http://example.test/profile',
            ])
            ->assertBadRequest();
    }

    public function test_meta_webhook_challenge_and_signed_messenger_event(): void
    {
        config([
            'services.meta.page_id' => 'page-123',
            'services.meta.page_access_token' => 'page-secret',
            'services.meta.app_secret' => 'app-secret',
            'services.meta.webhook_verify_token' => 'verification-secret',
            'services.meta.graph_api_version' => 'v21.0',
        ]);
        $this->get('/api/meta/webhook?hub.mode=subscribe&hub.verify_token=verification-secret&hub.challenge=challenge-value')
            ->assertOk()
            ->assertSeeText('challenge-value');

        Http::fake([
            'https://graph.facebook.com/v21.0/page-123/messages' => Http::response(['message_id' => 'mid.1'], 200),
        ]);
        $body = json_encode([
            'object' => 'page',
            'entry' => [[
                'id' => 'page-123',
                'messaging' => [[
                    'sender' => ['id' => 'psid-123'],
                    'timestamp' => now()->valueOf(),
                    'message' => ['text' => 'SUBSCRIBE'],
                ]],
            ]],
        ], JSON_THROW_ON_ERROR);
        $signature = 'sha256='.hash_hmac('sha256', $body, 'app-secret');

        $this->call('POST', '/api/meta/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_HUB_SIGNATURE_256' => $signature,
        ], $body)->assertOk();

        $this->assertDatabaseHas('messenger_subscribers', [
            'psid' => 'psid-123',
            'opted_in' => true,
        ]);
        Http::assertSent(fn ($request) => $request->url() === 'https://graph.facebook.com/v21.0/page-123/messages'
            && $request['access_token'] === 'page-secret');
    }

    public function test_meta_webhook_rejects_invalid_signature_and_status_is_staff_only(): void
    {
        config([
            'services.meta.page_id' => 'page-123',
            'services.meta.page_access_token' => 'page-secret',
            'services.meta.app_secret' => 'app-secret',
            'services.meta.webhook_verify_token' => 'verification-secret',
            'services.meta.graph_api_version' => 'v21.0',
        ]);

        $this->call('POST', '/api/meta/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json',
            'HTTP_X_HUB_SIGNATURE_256' => 'sha256='.str_repeat('0', 64),
        ], '{"object":"page","entry":[]}')->assertUnauthorized();

        $resident = $this->bearerFor('resident');
        $this->withToken($resident)->getJson('/api/social-integrations/status')->assertForbidden();

        $staff = $this->bearerFor('staff');
        $this->withToken($staff)
            ->getJson('/api/social-integrations/status')
            ->assertOk()
            ->assertJsonPath('integrations.facebook', true)
            ->assertJsonPath('integrations.messenger', true)
            ->assertJsonPath('messengerLink', 'https://m.me/page-123');
    }
}
