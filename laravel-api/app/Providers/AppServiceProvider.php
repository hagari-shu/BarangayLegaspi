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
        $mfaKey = (string) config('app.mfa_encryption_key');
        if (app()->environment('production') && $mfaKey !== '') {
            if (strlen($mfaKey) < 32) {
                throw new \RuntimeException('MFA_ENCRYPTION_KEY must contain at least 32 characters.');
            }
            if (hash_equals((string) config('app.jwt_secret'), $mfaKey)) {
                throw new \RuntimeException('MFA_ENCRYPTION_KEY must be different from JWT_SECRET.');
            }
        }
    }
}
