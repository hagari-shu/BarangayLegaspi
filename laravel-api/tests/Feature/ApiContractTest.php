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

    public function test_quality_assessment_endpoints_are_no_longer_registered(): void
    {
        $this->getJson('/api/quality-assessment')->assertNotFound();
        $this->putJson('/api/quality-assessment', [])->assertNotFound();
        $this->getJson('/api/admin/quality-assessments')->assertNotFound();
    }
}
