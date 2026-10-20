<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        if (app()->environment('production')) {
            $appKey = (string) config('app.key');
            $jwtSecret = (string) config('app.jwt_secret');
            $appKeyMaterial = str_starts_with($appKey, 'base64:')
                ? base64_decode(substr($appKey, 7), true)
                : $appKey;

            if (config('app.debug')) {
                throw new \RuntimeException('APP_DEBUG must be false in production.');
            }
            if ($appKeyMaterial === false || strlen($appKeyMaterial) < 32) {
                throw new \RuntimeException('APP_KEY must be configured with at least 32 characters in production.');
            }
            if (
                $jwtSecret === ''
                || strlen($jwtSecret) < 32
                || $jwtSecret === 'replace-with-a-random-secret-at-least-32-characters-long'
            ) {
                throw new \RuntimeException('JWT_SECRET must be configured with a unique random value of at least 32 characters in production.');
            }
            if (hash_equals($appKeyMaterial, $jwtSecret)) {
                throw new \RuntimeException('JWT_SECRET must be different from APP_KEY.');
            }
            if (config('database.default') !== 'pgsql') {
                throw new \RuntimeException('PostgreSQL must be configured as the production database.');
            }
            $allowedOrigins = config('cors.allowed_origins', []);
            if (empty($allowedOrigins)) {
                throw new \RuntimeException('CORS_ORIGINS must contain the deployed frontend origin in production.');
            }
            foreach ($allowedOrigins as $origin) {
                $parsedOrigin = is_string($origin) ? parse_url($origin) : false;
                if (
                    !$parsedOrigin
                    || strtolower((string) ($parsedOrigin['scheme'] ?? '')) !== 'https'
                    || empty($parsedOrigin['host'])
                    || str_contains($parsedOrigin['host'], '*')
                    || isset($parsedOrigin['user'])
                    || isset($parsedOrigin['pass'])
                    || isset($parsedOrigin['query'])
                    || isset($parsedOrigin['fragment'])
                    || !in_array($parsedOrigin['path'] ?? '', ['', '/'], true)
                ) {
                    throw new \RuntimeException('Every production CORS_ORIGINS entry must be an exact HTTPS origin.');
                }
            }
        }

        $mfaKey = (string) config('app.mfa_encryption_key');
        if (app()->environment('production') && $mfaKey !== '') {
            if (strlen($mfaKey) < 32) {
                throw new \RuntimeException('MFA_ENCRYPTION_KEY must contain at least 32 characters.');
            }
            if (hash_equals((string) config('app.jwt_secret'), $mfaKey)) {
                throw new \RuntimeException('MFA_ENCRYPTION_KEY must be different from JWT_SECRET.');
            }
        }
        $previousMfaKeys = array_values(array_filter(array_map(
            'trim',
            explode(',', (string) config('app.mfa_encryption_key_previous'))
        )));
        if (app()->environment('production')) {
            foreach ($previousMfaKeys as $previousMfaKey) {
                if (strlen($previousMfaKey) < 32) {
                    throw new \RuntimeException('Every MFA_ENCRYPTION_KEY_PREVIOUS entry must contain at least 32 characters.');
                }
                if ($mfaKey !== '' && hash_equals($mfaKey, $previousMfaKey)) {
                    throw new \RuntimeException('MFA_ENCRYPTION_KEY_PREVIOUS entries must be different from MFA_ENCRYPTION_KEY.');
                }
            }
            if (count($previousMfaKeys) !== count(array_unique($previousMfaKeys))) {
                throw new \RuntimeException('MFA_ENCRYPTION_KEY_PREVIOUS must not contain duplicate entries.');
            }
        }
    }
}
