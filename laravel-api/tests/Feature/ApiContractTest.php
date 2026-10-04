<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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

        $this->withToken($login->json('token'))
            ->getJson('/api/dashboard')
            ->assertOk();

        $this->withToken($login->json('token'))
            ->postJson('/api/announcements', [
                'title' => 'Community update',
                'content' => 'Scheduled public meeting',
                'socialChannels' => ['facebook', 'instagram', 'invalid'],
            ])
            ->assertCreated()
            ->assertJsonPath('announcement.socialChannels', ['facebook', 'instagram']);
    }
}
