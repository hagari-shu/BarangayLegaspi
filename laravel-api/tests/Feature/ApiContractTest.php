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

    public function test_quality_ratings_are_saved_per_user_and_only_aggregates_are_admin_visible(): void
    {
        $accounts = [
            'resident' => ['00000000-0000-4000-8000-000000000011', 'resident-quality@example.test', '09'.'888888881', 'Resident'],
            'staff' => ['00000000-0000-4000-8000-000000000012', 'staff-quality@example.test', '09'.'888888882', 'Staff'],
            'admin' => ['00000000-0000-4000-8000-000000000013', 'admin-quality@example.test', '09'.'888888883', 'Admin'],
        ];

        foreach ($accounts as $role => [$id, $email, $mobile, $name]) {
            DB::table('users')->insert([
                'id' => $id,
                'first_name' => $name,
                'last_name' => 'Quality',
                'mobile' => $mobile,
                'email' => $email,
                'password_hash' => password_hash('Quality!2026Pass', PASSWORD_BCRYPT),
                'role' => $role,
                'household_id' => 'QUALITY-'.$role,
                'family_members' => 1,
                'household_members' => '[]',
                'status' => $role === 'staff' ? 'On Duty' : ($role === 'admin' ? 'Administrator' : 'Active Resident'),
                'address' => 'Barangay Legaspi',
                'zone' => 1,
                'availability' => 'Available',
                'mfa_enabled' => false,
                'mfa_last_step' => 0,
                'created_at' => now(),
            ]);
        }

        $tokens = [];
        foreach ($accounts as $role => [, $email]) {
            $tokens[$role] = $this->postJson('/api/login', [
                'identifier' => $email,
                'password' => 'Quality!2026Pass',
            ])->assertOk()->json('token');
        }

        $scores = [
            'correctness' => 5,
            'reliability' => null,
            'efficiency' => null,
            'integrity' => null,
            'usability' => null,
            'maintainability' => null,
            'flexibility' => null,
            'testability' => null,
            'portability' => null,
            'reusability' => null,
            'interoperability' => null,
        ];

        $this->withToken($tokens['resident'])
            ->putJson('/api/quality-assessment', [
                'scores' => $scores,
                'notes' => ['correctness' => 'This note must remain in the browser.'],
            ])
            ->assertOk()
            ->assertJsonPath('assessment.scores.correctness', 5)
            ->assertJsonMissingPath('assessment.notes');
        $this->assertStringNotContainsString(
            'This note must remain in the browser.',
            DB::table('quality_assessments')->where('user_id', $accounts['resident'][0])->value('scores'),
        );

        $this->withToken($tokens['staff'])
            ->getJson('/api/quality-assessment')
            ->assertOk()
            ->assertJsonPath('assessment.scores.correctness', null);

        $scores['correctness'] = 3;
        $this->withToken($tokens['staff'])
            ->putJson('/api/quality-assessment', ['scores' => $scores])
            ->assertOk();

        $this->withToken($tokens['admin'])
            ->getJson('/api/admin/quality-assessments')
            ->assertOk()
            ->assertJsonPath('summary.responseCount', 2)
            ->assertJsonPath('summary.totalRatings', 2)
            ->assertJsonPath('summary.average', 4)
            ->assertJsonPath('summary.factors.correctness.average', 4)
            ->assertJsonMissingPath('summary.resident-quality@example.test');

        $this->withToken($tokens['resident'])
            ->getJson('/api/admin/quality-assessments')
            ->assertForbidden();

        $scores['correctness'] = 6;
        $this->withToken($tokens['resident'])
            ->putJson('/api/quality-assessment', ['scores' => $scores])
            ->assertBadRequest();
        $this->assertDatabaseCount('quality_assessments', 2);
    }
}
