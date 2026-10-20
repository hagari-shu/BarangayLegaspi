<?php

namespace App\Http\Controllers;

use App\Services\MediaObjectStorage;
use App\Services\MetaIntegration;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class MediaController extends Controller
{
    public function __construct(
        private readonly MediaObjectStorage $storage,
        private readonly MetaIntegration $meta,
    ) {
    }

    public function captainPhoto(): Response
    {
        return $this->photoRedirect(MediaObjectStorage::CAPTAIN_KEY, 'captain photo');
    }

    public function systemLogo(): Response
    {
        if (!$this->storage->isConfigured()) {
            return response()->noContent(404)->header('Cache-Control', 'no-store');
        }
        try {
            $url = $this->storage->url(MediaObjectStorage::SYSTEM_LOGO_KEY);
            return $url
                ? response()->json(['url' => $url])->header('Cache-Control', 'no-store')
                : response()->noContent(404)->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            Log::error('Unable to load system logo.');
            return response()->json(['message' => 'Unable to load the system logo.'], 502)->header('Cache-Control', 'no-store');
        }
    }

    public function officialProfiles(): JsonResponse
    {
        try {
            $profiles = DB::table('official_profiles')
                ->orderByRaw("CASE role WHEN 'captain' THEN 1 WHEN 'secretary' THEN 2 ELSE 3 END")
                ->get();
            $profiles = $profiles->map(function (object $profile): array {
                $links = $this->decodeLinks($profile->community_links ?? []);
                return [
                    'role' => $profile->role,
                    'displayName' => $profile->display_name,
                    'profileUrl' => $profile->profile_url ?: '',
                    'groupUrl' => $profile->group_url ?: ($links[0] ?? ''),
                    'communityLinks' => count($links) ? $links : ($profile->group_url ? [$profile->group_url] : []),
                    'photoUrl' => $this->storage->isConfigured()
                        ? $this->storage->url(MediaObjectStorage::OFFICIAL_KEYS[$profile->role])
                        : null,
                ];
            })->all();

            return response()->json(['profiles' => $profiles])->header('Cache-Control', 'no-store');
        } catch (Throwable) {
            Log::error('Unable to load official profiles.');
            return response()->json(['message' => 'Unable to load official profiles.'], 500)->header('Cache-Control', 'no-store');
        }
    }

    public function officialPhoto(string $role): Response
    {
        if (!array_key_exists($role, MediaObjectStorage::OFFICIAL_KEYS)) {
            return response()->noContent(404)->header('Cross-Origin-Resource-Policy', 'cross-origin')->header('Cache-Control', 'no-store');
        }

        return $this->photoRedirect(MediaObjectStorage::OFFICIAL_KEYS[$role], 'official profile photo');
    }

    public function createCaptainPhotoUpload(Request $request): JsonResponse
    {
        if (!$this->requireAdmin($request)) {
            return response()->json(['message' => 'Admin access required.'], 403);
        }

        return $this->createUpload('official/captain-portrait', $request);
    }

    public function finalizeCaptainPhoto(Request $request): JsonResponse
    {
        return $this->finalize($request, 'official/captain-portrait', MediaObjectStorage::CAPTAIN_KEY, 'captain-photo.updated', 'image', MediaObjectStorage::CAPTAIN_KEY, 'Invalid official photo upload.');
    }

    public function deleteCaptainPhoto(Request $request): JsonResponse
    {
        return $this->delete($request, MediaObjectStorage::CAPTAIN_KEY, 'captain-photo.deleted', 'image', MediaObjectStorage::CAPTAIN_KEY, 'captain photo');
    }

    public function createSystemLogoUpload(Request $request): JsonResponse
    {
        if (!$this->requireAdmin($request)) {
            return response()->json(['message' => 'Admin access required.'], 403);
        }

        return $this->createUpload(MediaObjectStorage::SYSTEM_LOGO_KEY, $request);
    }

    public function finalizeSystemLogo(Request $request): JsonResponse
    {
        return $this->finalize($request, MediaObjectStorage::SYSTEM_LOGO_KEY, MediaObjectStorage::SYSTEM_LOGO_KEY, 'system-logo.updated', 'image', MediaObjectStorage::SYSTEM_LOGO_KEY, 'Invalid system logo upload.');
    }

    public function deleteSystemLogo(Request $request): JsonResponse
    {
        return $this->delete($request, MediaObjectStorage::SYSTEM_LOGO_KEY, 'system-logo.deleted', 'image', MediaObjectStorage::SYSTEM_LOGO_KEY, 'system logo');
    }

    public function updateOfficialProfile(Request $request, string $role): JsonResponse
    {
        if (!array_key_exists($role, MediaObjectStorage::OFFICIAL_KEYS)) {
            return response()->json(['message' => 'Official profile not found.'], 404);
        }
        if (!$this->requireStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff or Admin access required.'], 403);
        }

        $displayNameValue = $request->input('displayName', '');
        $profileUrl = $request->input('profileUrl') ?? '';
        $groupUrl = $request->input('groupUrl') ?? '';
        $links = $request->input('communityLinks');
        if (!is_string($displayNameValue) || !is_string($profileUrl) || !is_string($groupUrl)
            || ($links !== null && !is_array($links))
            || (is_array($links) && (!array_is_list($links) || count($links) > 8))
            || (is_array($links) && count(array_filter($links, fn ($link) => !is_string($link))) > 0)) {
            return response()->json(['message' => 'Enter a name up to 120 characters and valid profile links.'], 400);
        }
        $displayName = trim(str_replace(['<', '>'], '', $displayNameValue));
        $profileUrl = trim($profileUrl);
        $links = is_array($links)
            ? array_values(array_filter(array_map('trim', $links), fn (string $value) => $value !== ''))
            : (trim($groupUrl) !== '' ? [trim($groupUrl)] : []);
        if (strlen($displayName) > 120 || count($links) > 8
            || !$this->validProfileUrl($profileUrl)
            || count(array_filter($links, fn (string $url): bool => !$this->validProfileUrl($url))) > 0) {
            return response()->json(['message' => 'Enter a name up to 120 characters and valid profile links.'], 400);
        }

        try {
            $profile = [
                'role' => $role,
                'display_name' => $displayName,
                'profile_url' => $profileUrl,
                'group_url' => $links[0] ?? '',
                'community_links' => json_encode($links, JSON_THROW_ON_ERROR),
                'updated_by' => $request->attributes->get('actor')->id,
                'updated_at' => now(),
            ];
            DB::table('official_profiles')->updateOrInsert(['role' => $role], $profile);
            $this->writeAudit($request, 'official-profile.updated', 'official_profile', $role);
            return response()->json(['profile' => $this->shapeProfile((object) $profile)]);
        } catch (Throwable) {
            Log::error('Unable to update official profile.');
            return response()->json(['message' => 'Unable to update official profile.'], 500);
        }
    }

    public function createOfficialPhotoUpload(Request $request, string $role): JsonResponse
    {
        if (!array_key_exists($role, MediaObjectStorage::OFFICIAL_KEYS)) {
            return response()->json(['message' => 'Official profile not found.'], 404);
        }
        if (!$this->requireStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff or Admin access required.'], 403);
        }

        return $this->createUpload(MediaObjectStorage::OFFICIAL_KEYS[$role], $request);
    }

    public function finalizeOfficialPhoto(Request $request, string $role): JsonResponse
    {
        if (!array_key_exists($role, MediaObjectStorage::OFFICIAL_KEYS)) {
            return response()->json(['message' => 'Official profile not found.'], 404);
        }

        return $this->finalize($request, MediaObjectStorage::OFFICIAL_KEYS[$role], MediaObjectStorage::OFFICIAL_KEYS[$role], 'official-profile.photo_updated', 'official_profile', $role, 'Invalid official photo upload.', false, true);
    }

    public function deleteOfficialPhoto(Request $request, string $role): JsonResponse
    {
        if (!array_key_exists($role, MediaObjectStorage::OFFICIAL_KEYS)) {
            return response()->json(['message' => 'Official profile not found.'], 404);
        }

        return $this->delete($request, MediaObjectStorage::OFFICIAL_KEYS[$role], 'official-profile.photo_deleted', 'official_profile', $role, 'official photo', false, true);
    }

    public function verifyMetaWebhook(Request $request): Response
    {
        $verifyToken = (string) config('services.meta.webhook_verify_token');
        if ($verifyToken !== ''
            && $this->metaQueryParameter($request, 'hub.mode') === 'subscribe'
            && is_string($this->metaQueryParameter($request, 'hub.verify_token'))
            && hash_equals($verifyToken, $this->metaQueryParameter($request, 'hub.verify_token'))
            && is_string($this->metaQueryParameter($request, 'hub.challenge'))) {
            return response($this->metaQueryParameter($request, 'hub.challenge'), 200)->header('Content-Type', 'text/plain; charset=UTF-8');
        }

        return response('', 403);
    }

    public function receiveMetaWebhook(Request $request): Response
    {
        if (!$this->meta->status()['messenger']) {
            return response()->json(['message' => 'Messenger integration is not configured.'], 503);
        }
        $body = $request->getContent();
        if (strlen($body) > 1024 * 1024) {
            return response()->json(['message' => 'Webhook payload is too large.'], 413);
        }
        if (!$this->meta->verifySignature($body, $request->header('X-Hub-Signature-256'))) {
            return response()->json(['message' => 'Invalid webhook signature.'], 401);
        }

        try {
            $payload = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($payload)) {
                throw new \JsonException();
            }
            $this->meta->processWebhook($payload);
            return response('', 200);
        } catch (Throwable) {
            Log::error('Messenger webhook processing failed.');
            return response()->json(['message' => 'Unable to process Messenger event.'], 500);
        }
    }

    public function socialIntegrationStatus(Request $request): JsonResponse
    {
        if (!$this->requireStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff access required.'], 403);
        }

        $integrations = $this->meta->status();
        return response()->json([
            'integrations' => $integrations,
            'messengerLink' => $integrations['messenger']
                ? 'https://m.me/'.rawurlencode((string) config('services.meta.page_id'))
                : null,
        ]);
    }

    private function createUpload(string $key, Request $request): JsonResponse
    {
        $contentType = $request->input('contentType');
        if (!is_string($contentType) || !in_array($contentType, MediaObjectStorage::CONTENT_TYPES, true)) {
            return response()->json(['message' => 'Choose a JPEG, PNG, or WebP image.'], 400);
        }
        if (!$this->storage->isConfigured()) {
            return response()->json(['message' => 'Image storage is not configured.'], 503);
        }
        try {
            return response()->json($this->storage->createUpload($key, $contentType));
        } catch (Throwable) {
            Log::error('Unable to prepare image upload.');
            return response()->json(['message' => 'Unable to prepare the image upload.'], 502);
        }
    }

    private function finalize(
        Request $request,
        string $prefix,
        string $publishedKey,
        string $action,
        string $targetType,
        string $targetId,
        string $invalidUploadMessage,
        bool $adminOnly = true,
        bool $staffOrAdmin = false,
    ): JsonResponse {
        if ($adminOnly && !$this->requireAdmin($request)) {
            return response()->json(['message' => 'Admin access required.'], 403);
        }
        if ($staffOrAdmin && !$this->requireStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff or Admin access required.'], 403);
        }
        if (!$this->storage->isConfigured()) {
            return response()->json(['message' => 'Image storage is not configured.'], 503);
        }
        $key = $request->input('key');
        if (!is_string($key) || !str_starts_with($key, $prefix.'/pending/')) {
            return response()->json(['message' => 'Invalid image upload.'], 400);
        }
        try {
            $this->storage->finalizeUpload($prefix, $key, $publishedKey, $invalidUploadMessage);
            $this->writeAudit($request, $action, $targetType, $targetId);
            return response()->json(['ok' => true]);
        } catch (RuntimeException $exception) {
            if (str_starts_with($exception->getMessage(), 'Invalid official photo upload')
                || str_starts_with($exception->getMessage(), 'Invalid system logo upload')
                || str_starts_with($exception->getMessage(), 'Upload must be')
                || str_starts_with($exception->getMessage(), 'Uploaded file is not')) {
                return response()->json(['message' => $exception->getMessage()], 400);
            }
            Log::error('Unable to verify uploaded image.');
            return response()->json(['message' => 'Unable to verify the uploaded image.'], 502);
        } catch (Throwable) {
            Log::error('Unable to verify uploaded image.');
            return response()->json(['message' => 'Unable to verify the uploaded image.'], 502);
        }
    }

    private function delete(
        Request $request,
        string $key,
        string $action,
        string $targetType,
        string $targetId,
        string $label,
        bool $adminOnly = true,
        bool $staffOrAdmin = false,
    ): JsonResponse {
        if ($adminOnly && !$this->requireAdmin($request)) {
            return response()->json(['message' => 'Admin access required.'], 403);
        }
        if ($staffOrAdmin && !$this->requireStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff or Admin access required.'], 403);
        }
        if (!$this->storage->isConfigured()) {
            return response()->json(['message' => 'Image storage is not configured.'], 503);
        }
        try {
            $this->storage->delete($key);
            $this->writeAudit($request, $action, $targetType, $targetId);
            return response()->json(['ok' => true]);
        } catch (Throwable) {
            Log::error('Unable to remove '.$label.'.');
            return response()->json(['message' => 'Unable to remove the '.$label.'.'], 502);
        }
    }

    private function photoRedirect(string $key, string $label): Response
    {
        $headers = [
            'Cross-Origin-Resource-Policy' => 'cross-origin',
            'Cache-Control' => 'no-store',
        ];
        try {
            $url = $this->storage->isConfigured() ? $this->storage->url($key) : null;
            return $url
                ? response('', 302, [...$headers, 'Location' => $url])
                : response('', 204, $headers);
        } catch (Throwable) {
            Log::error('Unable to load '.$label.'.');
            return response()->json(['message' => 'Unable to load the '.$label.'.'], 502)->withHeaders($headers);
        }
    }

    private function requireAdmin(Request $request): bool
    {
        return in_array($request->attributes->get('actor')->role ?? null, ['admin', 'super_admin'], true);
    }

    private function requireStaffOrAdmin(Request $request): bool
    {
        return in_array($request->attributes->get('actor')->role ?? null, ['staff', 'admin', 'super_admin'], true);
    }

    private function writeAudit(Request $request, string $action, string $targetType, string $targetId): void
    {
        $actor = $request->attributes->get('actor');
        DB::table('audit_logs')->insert([
            'id' => (string) Str::uuid(),
            'actor_id' => $actor->id,
            'actor_role' => $actor->role,
            'action' => $action,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'metadata' => json_encode(new \stdClass(), JSON_THROW_ON_ERROR),
            'created_at' => now(),
        ]);
    }

    private function validProfileUrl(string $url): bool
    {
        if ($url === '') {
            return true;
        }
        if (strlen($url) > 2048) {
            return false;
        }
        $parts = parse_url($url);

        return is_array($parts)
            && strtolower($parts['scheme'] ?? '') === 'https'
            && !isset($parts['user'])
            && !isset($parts['pass'])
            && isset($parts['host']);
    }

    private function metaQueryParameter(Request $request, string $name): ?string
    {
        foreach (explode('&', (string) $request->getQueryString()) as $parameter) {
            if ($parameter === '') {
                continue;
            }
            [$key, $value] = array_pad(explode('=', $parameter, 2), 2, '');
            if (rawurldecode($key) === $name) {
                return urldecode($value);
            }
        }

        return null;
    }

    private function decodeLinks(mixed $links): array
    {
        if (is_array($links)) {
            return $links;
        }
        if (is_string($links)) {
            $decoded = json_decode($links, true);
            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    private function shapeProfile(object $profile): array
    {
        $links = $this->decodeLinks($profile->community_links ?? []);
        return [
            'role' => $profile->role,
            'displayName' => $profile->display_name,
            'profileUrl' => $profile->profile_url ?: '',
            'groupUrl' => $profile->group_url ?: ($links[0] ?? ''),
            'communityLinks' => count($links) ? $links : ($profile->group_url ? [$profile->group_url] : []),
        ];
    }
}
