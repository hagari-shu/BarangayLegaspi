<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Tests\TestCase;

class ApiContractTest extends TestCase
{
    use RefreshDatabase;

    private function insertAuthUser(string $id, string $email, string $password): void
    {
        DB::table('users')->insert([
            'id' => $id,
            'first_name' => 'Test',
            'last_name' => 'Account',
            'mobile' => '09170000999',
            'email' => $email,
            'password_hash' => password_hash($password, PASSWORD_BCRYPT),
            'role' => 'admin',
            'household_id' => 'security-test',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'Administrator',
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 0,
            'availability' => 'Available',
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);
    }

    private function legacyJwtFor(string $userId, ?int $issuedAt = null): string
    {
        $encode = static fn (string $value): string => rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
        $header = $encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT'], JSON_THROW_ON_ERROR));
        $payload = $encode(json_encode([
            'sub' => $userId,
            'role' => 'admin',
            'iat' => $issuedAt ?? time(),
            'exp' => time() + 3600,
        ], JSON_THROW_ON_ERROR));
        $signature = $encode(hash_hmac('sha256', $header.'.'.$payload, (string) config('app.jwt_secret'), true));

        return $header.'.'.$payload.'.'.$signature;
    }

    public function test_health_reports_the_active_database_driver(): void
    {
        $this->getJson('/api/health')
            ->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('storage', 'sqlite');
    }

    public function test_root_redirects_to_api_health_instead_of_rendering_a_blade_page(): void
    {
        $this->get('/')
            ->assertRedirect('/api/health');
    }

    public function test_client_error_reports_log_only_allowlisted_metadata(): void
    {
        Log::shouldReceive('warning')
            ->once()
            ->with('Client-side error reported', [
                'type' => 'window-error',
                'route' => '/admin',
                'role' => 'unknown',
                'language' => 'fil',
            ]);

        $this->postJson('/api/client-errors', [
            'type' => 'window-error',
            'route' => '/admin/users/123?email=private@example.test',
            'language' => 'fil',
            'message' => 'private@example.test',
        ])->assertAccepted()->assertJsonPath('received', true);

        $this->postJson('/api/client-errors', [
            'type' => 'custom',
            'message' => 'must not be logged',
        ])->assertBadRequest();
    }

    public function test_migrations_do_not_seed_demo_payment_records(): void
    {
        $this->assertDatabaseCount('payments', 0);
    }

    public function test_public_event_and_announcement_reads_do_not_seed_examples(): void
    {
        config(['services.public_content.api_base' => 'https://barangaylegaspi.onrender.com/api']);
        Http::fake([
            'https://barangaylegaspi.onrender.com/api/events' => Http::response([
                'events' => [['title' => 'Community meeting', 'date' => '2026-10-18']],
            ]),
            'https://barangaylegaspi.onrender.com/api/announcements' => Http::response([
                'announcements' => [['id' => 'notice-1', 'title' => 'Office hours']],
            ]),
        ]);

        $this->getJson('/api/events')
            ->assertOk()
            ->assertExactJson(['events' => [['title' => 'Community meeting', 'date' => '2026-10-18']]]);

        $this->getJson('/api/announcements')
            ->assertOk()
            ->assertExactJson(['announcements' => [['id' => 'notice-1', 'title' => 'Office hours']]]);

        Http::assertSent(fn ($request) => $request->url() === 'https://barangaylegaspi.onrender.com/api/events');
        Http::assertSent(fn ($request) => $request->url() === 'https://barangaylegaspi.onrender.com/api/announcements');
    }

    public function test_public_content_gateway_returns_502_instead_of_an_empty_success_when_source_is_unavailable(): void
    {
        config(['services.public_content.api_base' => 'https://barangaylegaspi.onrender.com/api']);
        Http::fake([
            'https://barangaylegaspi.onrender.com/api/announcements' => Http::response(['message' => 'unavailable'], 503),
        ]);

        $this->getJson('/api/announcements')
            ->assertStatus(502)
            ->assertExactJson(['message' => 'Public content is temporarily unavailable.']);
    }

    public function test_resident_registration_preserves_the_frontend_response_contract(): void
    {
        $this->postJson('/api/register', [
            'firstName' => 'Maria',
            'lastName' => 'Dela Cruz',
            'mobile' => '09171234567',
            'email' => 'maria@example.test',
            'password' => 'Barangay!2026',
            'address' => 'Legaspi, Tayug',
            'zone' => 2,
            'householdMembers' => [['name' => 'Juan', 'relationship' => 'Sibling']],
        ])
            ->assertCreated()
            ->assertJsonPath('requiresApproval', true)
            ->assertJsonPath('user.status', 'Pending Verification')
            ->assertJsonMissingPath('user.password_hash');

        $this->assertDatabaseHas('users', ['email' => 'maria@example.test', 'zone' => 2]);
    }

    public function test_login_issues_a_bearer_token_and_protected_dashboard_accepts_it(): void
    {
        DB::table('users')->insert([
            'id' => '00000000-0000-4000-8000-000000000001',
            'first_name' => 'Carmen',
            'last_name' => 'Santos',
            'mobile' => '09999999999',
            'email' => 'admin@barangay.gov.ph',
            'password_hash' => password_hash('Admin!2026Pass', PASSWORD_BCRYPT),
            'role' => 'admin',
            'household_id' => '2024-ADMIN',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'Administrator',
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 0,
            'availability' => 'Available',
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);

        $this->getJson('/api/dashboard')->assertUnauthorized();

        $login = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk()->assertJsonStructure(['token', 'user']);

        config(['services.public_content.api_base' => 'https://barangaylegaspi.onrender.com/api']);
        Http::fake([
            'https://barangaylegaspi.onrender.com/api/announcements' => Http::response(['announcements' => []]),
            'https://barangaylegaspi.onrender.com/api/events' => Http::response(['events' => []]),
        ]);

        $this->withToken($login->json('token'))
            ->getJson('/api/dashboard')
            ->assertOk();

        $this->withToken($login->json('token'))
            ->patchJson('/api/admin/users/00000000-0000-4000-8000-000000000001', [
                'householdId' => 'LEG-2026-001',
                'familyMembers' => 2,
                'householdMembers' => [
                    ['name' => 'Elena Santos', 'relationship' => 'Spouse'],
                ],
            ])
            ->assertOk()
            ->assertJsonPath('user.householdId', 'LEG-2026-001')
            ->assertJsonPath('user.familyMembers', 2)
            ->assertJsonPath('user.householdMembers.0.name', 'Elena Santos');

        $this->withToken($login->json('token'))
            ->patchJson('/api/admin/users/00000000-0000-4000-8000-000000000001', [
                'householdMembers' => [['name' => 'Missing relationship']],
            ])
            ->assertBadRequest();

        $this->withToken($login->json('token'))
            ->postJson('/api/announcements', [
                'title' => 'Community update',
                'content' => 'Scheduled public meeting',
                'socialChannels' => ['facebook', 'instagram', 'invalid'],
            ])
            ->assertStatus(409)
            ->assertJsonPath('message', 'Announcements are managed by the active portal API until the Laravel cutover is complete.');

        $this->withToken($login->json('token'))
            ->deleteJson('/api/announcements/00000000-0000-4000-8000-000000000099')
            ->assertStatus(409);

        $this->assertDatabaseCount('announcements', 0);
    }

    public function test_password_change_revokes_other_database_tokens_and_legacy_jwts(): void
    {
        config(['app.jwt_secret' => 'laravel-contract-test-jwt-secret-32-characters']);
        $userId = '00000000-0000-4000-8000-000000000301';
        $this->insertAuthUser($userId, 'password-change@example.test', 'Original!Password2026');
        $legacyToken = $this->legacyJwtFor($userId, time() - 30);

        $firstLogin = $this->postJson('/api/login', [
            'identifier' => 'password-change@example.test',
            'password' => 'Original!Password2026',
        ])->assertOk();
        $secondLogin = $this->postJson('/api/login', [
            'identifier' => 'password-change@example.test',
            'password' => 'Original!Password2026',
        ])->assertOk();

        $this->withToken($firstLogin->json('token'))
            ->postJson('/api/change-password', [
                'currentPassword' => 'Original!Password2026',
                'newPassword' => 'Updated!Password2026',
            ])
            ->assertOk();

        $this->withToken($firstLogin->json('token'))->getJson('/api/profile')->assertUnauthorized();
        $this->withToken($secondLogin->json('token'))->getJson('/api/profile')->assertUnauthorized();
        $this->withToken($legacyToken)->getJson('/api/profile')->assertUnauthorized();
        $this->assertDatabaseCount('api_tokens', 0);

        $newLogin = $this->postJson('/api/login', [
            'identifier' => 'password-change@example.test',
            'password' => 'Updated!Password2026',
        ])->assertOk();
        $this->withToken($newLogin->json('token'))->getJson('/api/profile')->assertOk();
    }

    public function test_logout_revokes_a_legacy_jwt_instead_of_allowing_it_to_be_reused(): void
    {
        config(['app.jwt_secret' => 'laravel-contract-test-jwt-secret-32-characters']);
        $userId = '00000000-0000-4000-8000-000000000302';
        $this->insertAuthUser($userId, 'logout@example.test', 'Original!Password2026');
        $token = $this->legacyJwtFor($userId);
        $tokenHash = hash('sha256', $token);

        $this->withToken($token)->getJson('/api/profile')->assertOk();
        $this->withToken($token)->postJson('/api/logout')->assertOk();
        $this->withToken($token)->getJson('/api/profile')->assertUnauthorized();
        $this->assertDatabaseHas('api_token_revocations', ['token_hash' => $tokenHash]);
    }

    public function test_password_reset_revokes_legacy_jwts_as_well_as_database_tokens(): void
    {
        config(['app.jwt_secret' => 'laravel-contract-test-jwt-secret-32-characters']);
        $userId = '00000000-0000-4000-8000-000000000303';
        $this->insertAuthUser($userId, 'password-reset@example.test', 'Original!Password2026');
        $legacyToken = $this->legacyJwtFor($userId, time() - 30);
        $resetToken = str_repeat('R', 43);

        DB::table('password_reset_tokens')->insert([
            'token_hash' => hash('sha256', $resetToken),
            'user_id' => $userId,
            'expires_at' => now()->addMinutes(15),
            'created_at' => now(),
        ]);

        $this->postJson('/api/reset-password', [
            'token' => $resetToken,
            'newPassword' => 'Reset!Password2026',
        ])->assertOk();

        $this->withToken($legacyToken)->getJson('/api/profile')->assertUnauthorized();
        $this->postJson('/api/login', [
            'identifier' => 'password-reset@example.test',
            'password' => 'Reset!Password2026',
        ])->assertOk();
    }

    public function test_production_requires_distinct_non_placeholder_application_and_jwt_secrets(): void
    {
        config([
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.jwt_secret' => 'replace-with-a-random-secret-at-least-32-characters-long',
        ]);
        $this->app->detectEnvironment(fn () => 'production');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('JWT_SECRET must be configured with a unique random value');

        (new \App\Providers\AppServiceProvider($this->app))->boot();
    }

    public function test_production_rejects_an_invalid_application_key(): void
    {
        config([
            'app.key' => 'short-key',
            'app.jwt_secret' => 'laravel-contract-test-jwt-secret-32-characters',
        ]);
        $this->app->detectEnvironment(fn () => 'production');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('APP_KEY must be configured');

        (new \App\Providers\AppServiceProvider($this->app))->boot();
    }

    public function test_production_rejects_debug_mode(): void
    {
        config([
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.jwt_secret' => 'laravel-contract-test-jwt-secret-32-characters',
            'app.debug' => true,
            'cors.allowed_origins' => ['https://portal.example.test'],
        ]);
        $this->app->detectEnvironment(fn () => 'production');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('APP_DEBUG must be false');

        (new \App\Providers\AppServiceProvider($this->app))->boot();
    }

    public function test_production_requires_postgresql_and_an_explicit_cors_origin(): void
    {
        config([
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.jwt_secret' => 'laravel-contract-test-jwt-secret-32-characters',
            'app.debug' => false,
            'database.default' => 'sqlite',
            'cors.allowed_origins' => ['https://portal.example.test'],
        ]);
        $this->app->detectEnvironment(fn () => 'production');

        try {
            (new \App\Providers\AppServiceProvider($this->app))->boot();
            $this->fail('Production must refuse to start with a non-PostgreSQL database.');
        } catch (RuntimeException $error) {
            $this->assertSame('PostgreSQL must be configured as the production database.', $error->getMessage());
        }

        config([
            'database.default' => 'pgsql',
            'cors.allowed_origins' => [],
        ]);

        try {
            (new \App\Providers\AppServiceProvider($this->app))->boot();
            $this->fail('Production must require an explicit CORS origin.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString(
                'CORS_ORIGINS must contain the deployed frontend origin',
                $error->getMessage()
            );
        } finally {
            config(['database.default' => 'sqlite']);
        }
    }

    public function test_production_cors_rejects_non_https_or_non_origin_values(): void
    {
        config([
            'app.key' => 'base64:'.base64_encode(str_repeat('a', 32)),
            'app.jwt_secret' => 'laravel-contract-test-jwt-secret-32-characters',
            'app.debug' => false,
            'database.default' => 'pgsql',
            'cors.allowed_origins' => ['http://localhost:5173'],
        ]);
        $this->app->detectEnvironment(fn () => 'production');

        try {
            (new \App\Providers\AppServiceProvider($this->app))->boot();
            $this->fail('Production must reject non-HTTPS CORS origins.');
        } catch (RuntimeException $error) {
            $this->assertSame(
                'Every production CORS_ORIGINS entry must be an exact HTTPS origin.',
                $error->getMessage()
            );
        } finally {
            config(['database.default' => 'sqlite']);
        }
    }

    public function test_super_admin_monitoring_is_role_restricted_and_admin_access_remains_compatible(): void
    {
        foreach ([
            [
                'id' => '00000000-0000-4000-8000-000000000101',
                'first_name' => 'System',
                'last_name' => 'Oversight',
                'mobile' => '09170000101',
                'email' => 'super.admin@example.test',
                'role' => 'super_admin',
                'status' => 'Administrator',
                'password' => 'SuperAdmin!2026',
            ],
            [
                'id' => '00000000-0000-4000-8000-000000000102',
                'first_name' => 'Daily',
                'last_name' => 'Admin',
                'mobile' => '09170000102',
                'email' => 'daily.admin@example.test',
                'role' => 'admin',
                'status' => 'Administrator',
                'password' => 'RegularAdmin!2026',
            ],
        ] as $account) {
            DB::table('users')->insert([
                'id' => $account['id'],
                'first_name' => $account['first_name'],
                'last_name' => $account['last_name'],
                'mobile' => $account['mobile'],
                'email' => $account['email'],
                'password_hash' => password_hash($account['password'], PASSWORD_BCRYPT),
                'role' => $account['role'],
                'household_id' => 'role-test-'.$account['role'],
                'family_members' => 1,
                'household_members' => '[]',
                'status' => $account['status'],
                'address' => 'Barangay Hall, Legaspi',
                'zone' => 0,
                'availability' => 'Available',
                'mfa_enabled' => false,
                'mfa_last_step' => 0,
                'created_at' => now(),
            ]);
        }

        $superAdminLogin = $this->postJson('/api/login', [
            'identifier' => 'super.admin@example.test',
            'password' => 'SuperAdmin!2026',
        ])->assertOk()->assertJsonPath('user.role', 'super_admin');
        $adminLogin = $this->postJson('/api/login', [
            'identifier' => 'daily.admin@example.test',
            'password' => 'RegularAdmin!2026',
        ])->assertOk()->assertJsonPath('user.role', 'admin');

        $this->withToken($superAdminLogin->json('token'))
            ->getJson('/api/admin/users')
            ->assertOk();
        $this->withToken($superAdminLogin->json('token'))
            ->getJson('/api/super-admin/monitoring')
            ->assertOk()
            ->assertJsonPath('summary.totalSuperAdmins', 1);

        $this->withToken($adminLogin->json('token'))
            ->getJson('/api/admin/users')
            ->assertOk();
        $this->withToken($adminLogin->json('token'))
            ->getJson('/api/super-admin/monitoring')
            ->assertForbidden();
        $this->withToken($adminLogin->json('token'))
            ->patchJson('/api/admin/users/00000000-0000-4000-8000-000000000101', [
                'status' => 'Disabled',
            ])
            ->assertForbidden();
    }

    public function test_super_admin_setup_invitation_is_single_use_and_stores_only_a_token_hash(): void
    {
        $token = str_repeat('A', 43);
        $tokenHash = hash('sha256', $token);
        DB::table('super_admin_invitations')->insert([
            'id' => '00000000-0000-4000-8000-000000000201',
            'email' => 'invited.super.admin@example.test',
            'token_hash' => $tokenHash,
            'issued_at' => now(),
            'expires_at' => now()->addHours(12),
        ]);

        $validationResponse = $this->postJson('/api/super-admin/invitations/validate', ['token' => $token])
            ->assertOk()
            ->assertJsonPath('email', 'invited.super.admin@example.test');
        $this->assertStringContainsString('no-store', $validationResponse->headers->get('Cache-Control', ''));

        $acceptanceResponse = $this->postJson('/api/super-admin/invitations/accept', [
            'token' => $token,
            'firstName' => 'Invited',
            'lastName' => 'Administrator',
            'mobile' => '09170000201',
            'password' => 'Chosen!Password2026',
        ])->assertCreated();
        $this->assertStringContainsString('no-store', $acceptanceResponse->headers->get('Cache-Control', ''));

        $this->assertDatabaseHas('users', [
            'email' => 'invited.super.admin@example.test',
            'role' => 'super_admin',
            'status' => 'Administrator',
        ]);
        $this->assertDatabaseHas('super_admin_invitations', [
            'token_hash' => $tokenHash,
        ]);
        $this->assertDatabaseMissing('super_admin_invitations', [
            'token_hash' => $token,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'super_admin.invitation.accepted',
            'actor_role' => 'super_admin',
        ]);

        $this->postJson('/api/super-admin/invitations/accept', [
            'token' => $token,
            'firstName' => 'Invited',
            'lastName' => 'Administrator',
            'mobile' => '09170000201',
            'password' => 'Chosen!Password2026',
        ])->assertStatus(410);
    }

    public function test_quality_assessment_endpoints_are_no_longer_registered(): void
    {
        $this->getJson('/api/quality-assessment')->assertNotFound();
        $this->putJson('/api/quality-assessment', [])->assertNotFound();
        $this->getJson('/api/admin/quality-assessments')->assertNotFound();
    }
}
