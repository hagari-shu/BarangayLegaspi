<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class ApiContractTest extends TestCase
{
    use RefreshDatabase;

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

        $this->postJson('/api/super-admin/invitations/validate', ['token' => $token])
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store')
            ->assertJsonPath('email', 'invited.super.admin@example.test');

        $this->postJson('/api/super-admin/invitations/accept', [
            'token' => $token,
            'firstName' => 'Invited',
            'lastName' => 'Administrator',
            'mobile' => '09170000201',
            'password' => 'Chosen!Password2026',
        ])->assertCreated()
            ->assertHeader('Cache-Control', 'no-store');

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
