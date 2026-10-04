<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ApiIdentity
{
    public static function fromRequest(Request $request): ?object
    {
        $authorization = (string) $request->header('Authorization', '');
        if (!str_starts_with($authorization, 'Bearer ')) {
            return null;
        }

        $token = substr($authorization, 7);
        if ($token === '') {
            return null;
        }

        $tokenHash = hash('sha256', $token);
        $record = DB::table('api_tokens')
            ->where('token_hash', $tokenHash)
            ->where(function ($query) {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->first();

        if ($record) {
            $actor = DB::table('users')->where('id', $record->user_id)->first();
            if ($actor) {
                DB::table('api_tokens')->where('id', $record->id)->update(['last_used_at' => now()]);
                return self::normalizeUser($actor);
            }
        }

        return self::fromLegacyJwt($token);
    }

    public static function normalizeUser(object $user): object
    {
        $user->firstName = $user->first_name ?? $user->firstName ?? '';
        $user->lastName = $user->last_name ?? $user->lastName ?? '';
        $user->householdId = $user->household_id ?? $user->householdId ?? null;
        $user->familyMembers = $user->family_members ?? $user->familyMembers ?? null;
        $user->householdMembers = self::decodeJson($user->household_members ?? $user->householdMembers ?? []);
        $user->mfaEnabled = (bool) ($user->mfa_enabled ?? $user->mfaEnabled ?? false);
        $user->mfaSecret = $user->mfa_secret ?? $user->mfaSecret ?? null;
        $user->mfaLastStep = (int) ($user->mfa_last_step ?? $user->mfaLastStep ?? 0);
        $user->createdAt = $user->created_at ?? $user->createdAt ?? null;
        $user->zone = $user->zone_number ?? $user->zone ?? null;

        return $user;
    }

    public static function safeUser(object $user): array
    {
        $user = self::normalizeUser(clone $user);
        $user->mfaSetupPending = !$user->mfaEnabled && !empty($user->mfaSecret);
        unset($user->password_hash, $user->passwordHash, $user->mfa_secret, $user->mfaSecret, $user->mfa_last_step);

        return (array) $user;
    }

    private static function fromLegacyJwt(string $token): ?object
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$header, $payload, $signature] = $parts;
        $decodedSignature = self::base64UrlDecode($signature);
        if ($decodedSignature === false) {
            return null;
        }

        $secret = (string) config('app.jwt_secret');
        $expected = hash_hmac('sha256', $header.'.'.$payload, $secret, true);
        if (!hash_equals($expected, $decodedSignature)) {
            return null;
        }

        $decodedPayload = self::base64UrlDecode($payload);
        $claims = $decodedPayload === false ? null : json_decode($decodedPayload);
        if (!$claims || empty($claims->sub) || ($claims->purpose ?? null) === 'mfa_pending') {
            return null;
        }
        if (isset($claims->exp) && $claims->exp <= time()) {
            return null;
        }

        $actor = DB::table('users')->where('id', $claims->sub)->first();

        return $actor ? self::normalizeUser($actor) : null;
    }

    private static function base64UrlDecode(string $value): string|false
    {
        $decoded = base64_decode(strtr($value, '-_', '+/').str_repeat('=', (4 - strlen($value) % 4) % 4), true);

        return $decoded === false ? false : $decoded;
    }

    public static function decodeJson(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (is_object($value)) {
            return (array) $value;
        }
        if (!is_string($value) || $value === '') {
            return [];
        }

        $decoded = json_decode($value, true);

        return is_array($decoded) ? $decoded : [];
    }
}
