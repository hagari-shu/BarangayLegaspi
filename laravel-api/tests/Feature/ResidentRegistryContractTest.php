<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class ResidentRegistryContractTest extends TestCase
{
    use RefreshDatabase;

    private string $staffId;

    private string $staffToken;

    private string $adminId;

    private string $adminToken;

    protected function setUp(): void
    {
        parent::setUp();

        $this->staffId = $this->createUser('staff', 'staff@example.test');
        $this->staffToken = $this->issueToken($this->staffId);
        $this->adminId = $this->createUser('admin', 'admin@example.test');
        $this->adminToken = $this->issueToken($this->adminId);
    }

    private function createUser(string $role, string $email, string $status = 'Active Resident'): string
    {
        $id = (string) Str::uuid();
        DB::table('users')->insert([
            'id' => $id,
            'first_name' => 'Test',
            'last_name' => ucfirst($role),
            'mobile' => match ($role) {
                'staff' => '09170000001',
                'admin' => '09170000002',
                default => '09170000003',
            },
            'email' => $email,
            'password_hash' => password_hash('Test!2026Password', PASSWORD_BCRYPT),
            'role' => $role,
            'household_id' => 'registry-test',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => $status,
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 1,
            'availability' => 'Available',
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);

        return $id;
    }

    private function issueToken(string $userId): string
    {
        $token = Str::random(64);
        DB::table('api_tokens')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);

        return $token;
    }

    private function staffHeaders(): array
    {
        return ['Authorization' => 'Bearer '.$this->staffToken];
    }

    private function adminHeaders(): array
    {
        return ['Authorization' => 'Bearer '.$this->adminToken];
    }

    public function test_registry_endpoints_require_staff_and_admin_roles(): void
    {
        $this->getJson('/api/staff/residents')->assertUnauthorized();
        $this->withHeaders($this->adminHeaders())->getJson('/api/staff/residents')->assertForbidden();
        $this->withHeaders($this->staffHeaders())->getJson('/api/staff/residents')->assertOk();
        $this->withHeaders($this->staffHeaders())->postJson('/api/admin/residents/'.Str::uuid().'/archive')->assertForbidden();
    }

    public function test_source_review_open_is_idempotent_and_resolution_is_audited(): void
    {
        $this->withHeaders($this->staffHeaders())->postJson('/api/staff/registry-source-reviews', [
            'zone' => 3,
            'purok' => '<Riverside>',
        ])->assertCreated()
            ->assertJsonPath('review.purok', 'Riverside')
            ->assertJsonPath('created', true);

        $this->withHeaders($this->staffHeaders())->postJson('/api/staff/registry-source-reviews', [
            'zone' => '3',
            'purok' => 'riverside',
        ])->assertOk()->assertJsonPath('created', false);

        $this->withHeaders($this->staffHeaders())->getJson('/api/staff/registry-source-reviews')
            ->assertOk()
            ->assertJsonCount(1, 'reviews');

        $reviewId = DB::table('registry_source_reviews')->value('id');
        $this->withHeaders($this->staffHeaders())->patchJson("/api/staff/registry-source-reviews/{$reviewId}/resolve")
            ->assertOk()->assertJsonPath('review.status', 'resolved');
        $this->withHeaders($this->staffHeaders())->patchJson("/api/staff/registry-source-reviews/{$reviewId}/resolve")
            ->assertNotFound();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'resident_registry.source_review_opened',
            'target_id' => $reviewId,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'resident_registry.source_review_resolved',
            'target_id' => $reviewId,
        ]);
        $this->withHeaders($this->staffHeaders())->postJson('/api/staff/registry-source-reviews', [
            'zone' => 8,
            'purok' => 'Bad zone',
        ])->assertBadRequest();
    }

    public function test_resident_registration_match_confirmation_and_staff_updates_follow_the_registry_contract(): void
    {
        $headers = $this->staffHeaders();
        $payload = [
            'firstName' => '<Maria>',
            'lastName' => 'Dela Cruz',
            'birthDate' => '1990-06-12',
            'sex' => 'Female',
            'maritalStatus' => 'Married',
            'occupation' => 'Teacher',
            'householdId' => 'HH-1',
            'purok' => 'Riverside',
            'zone' => 2,
            'address' => 'Main Road',
            'sourceReference' => 'Register 1',
        ];

        $this->withHeaders($headers)->postJson('/api/staff/residents', $payload)
            ->assertCreated()
            ->assertJsonPath('resident.verificationStatus', 'pending')
            ->assertJsonPath('created', true)
            ->assertJsonPath('reviewRequired', true);
        $residentId = DB::table('resident_registry')->value('id');

        $duplicate = $this->withHeaders($headers)->postJson('/api/staff/residents', $payload)
            ->assertStatus(409)
            ->assertJsonPath('reviewRequired', true)
            ->json();
        $this->withHeaders($headers)->postJson('/api/staff/residents', $payload + [
            'confirmPotentialMatch' => true,
            'reviewedMatches' => $duplicate['reviewedMatches'],
        ])->assertOk()->assertJsonPath('created', false);
        $this->assertDatabaseCount('resident_registry', 1);

        $this->withHeaders($headers)->getJson('/api/staff/residents?search=maria&zone=2&pageSize=0')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('pageSize', 25)
            ->assertJsonPath('residents.0.firstName', 'Maria')
            ->assertJsonPath('residents.0.age', (int) now('Asia/Manila')->format('Y') - 1990 - (now('Asia/Manila')->format('md') < '0612' ? 1 : 0));
        $this->withHeaders($headers)->getJson('/api/staff/residents/zones')
            ->assertOk()->assertJsonPath('zones.1.zone', 2)->assertJsonPath('zones.1.total', 1);
        $this->withHeaders($headers)->getJson("/api/staff/residents/{$residentId}")
            ->assertOk()->assertJsonPath('resident.address', 'Main Road');

        $this->withHeaders($headers)->patchJson("/api/staff/residents/{$residentId}", [
            'occupation' => 'Principal',
            'unsupported' => 'ignored?',
        ])->assertBadRequest();
        $this->withHeaders($headers)->patchJson("/api/staff/residents/{$residentId}", [
            'occupation' => 'Principal',
            'zone' => 3,
        ])->assertOk()->assertJsonPath('resident.occupation', 'Principal')->assertJsonPath('resident.zone', 3);
        $this->withHeaders($headers)->patchJson("/api/staff/residents/{$residentId}/verify", [
            'verificationStatus' => 'verified',
        ])->assertOk()->assertJsonPath('resident.verificationStatus', 'verified');
        $this->withHeaders($headers)->patchJson("/api/staff/residents/{$residentId}/status", [
            'status' => 'inactive',
        ])->assertOk()->assertJsonPath('resident.status', 'inactive');

        $this->withHeaders($headers)->getJson('/api/staff/demographics')
            ->assertOk()->assertJsonPath('overall.total', 0);
        $this->withHeaders($headers)->patchJson("/api/staff/residents/{$residentId}/status", [
            'status' => 'active',
        ])->assertOk();
        $this->withHeaders($headers)->getJson('/api/staff/demographics?zone=3')
            ->assertOk()
            ->assertJsonPath('overall.total', 1)
            ->assertJsonPath('overall.female', 1)
            ->assertJsonPath('overall.households', 1);
        $this->assertSame(5, DB::table('audit_logs')->where('target_type', 'resident_registry')->count());
    }

    public function test_import_validates_rows_requires_duplicate_review_and_skips_fingerprints_without_deleting_records(): void
    {
        $headers = $this->staffHeaders();
        $base = [
            'firstName' => 'Ana',
            'lastName' => 'Santos',
            'birthDate' => '1988-03-04',
            'sex' => 'Female',
            'maritalStatus' => 'Single',
            'occupation' => 'Vendor',
            'householdId' => 'HH-4',
            'purok' => 'Centro',
            'zone' => '4',
            'address' => 'Market Street',
            'sourceReference' => '',
        ];

        $this->withHeaders($headers)->postJson('/api/staff/residents/import', [
            'filename' => 'register.csv',
            'residents' => [$base + ['zone' => 4]],
        ])->assertCreated()->assertJsonPath('imported', 1)->assertJsonPath('skipped', 0);
        $original = DB::table('resident_registry')->first();
        $this->assertSame('register.csv', $original->source_filename);

        $this->withHeaders($headers)->postJson('/api/staff/residents/import', [
            'filename' => 'duplicate.csv',
            'residents' => [array_replace($base, ['zone' => 4])],
        ])->assertBadRequest()->assertJsonPath('validationErrors.0.field', 'zone');
        $this->assertDatabaseCount('resident_registry', 1);

        $duplicateResponse = $this->withHeaders($headers)->postJson('/api/staff/residents/import', [
            'filename' => 'register.csv',
            'residents' => [$base + ['zone' => '4']],
        ])->assertStatus(409)->json();
        $this->withHeaders($headers)->postJson('/api/staff/residents/import', [
            'filename' => 'register.csv',
            'residents' => [$base + ['zone' => '4']],
            'confirmPotentialMatches' => true,
            'reviewedMatches' => $duplicateResponse['reviewedMatches'],
        ])->assertCreated()->assertJsonPath('imported', 0)->assertJsonPath('skipped', 1);
        $this->assertDatabaseCount('resident_registry', 1);

        $internalDuplicate = $this->withHeaders($headers)->postJson('/api/staff/residents/import', [
            'filename' => 'family.csv',
            'familyBatch' => true,
            'residents' => [
                array_replace($base, ['firstName' => 'Lina']),
                array_replace($base, ['firstName' => 'Lina']),
            ],
        ])->assertStatus(409)->json();
        $this->assertSame('same import file', $internalDuplicate['potentialMatches'][0]['records'][0]['source']);
        $this->withHeaders($headers)->postJson('/api/staff/residents/import', [
            'filename' => 'family.csv',
            'familyBatch' => true,
            'residents' => [
                array_replace($base, ['firstName' => 'Lina']),
                array_replace($base, ['firstName' => 'Lina']),
            ],
            'confirmPotentialMatches' => true,
            'reviewedMatches' => $internalDuplicate['reviewedMatches'],
        ])->assertCreated()->assertJsonPath('imported', 1)->assertJsonPath('skipped', 1);
        $this->assertDatabaseCount('resident_registry', 2);
        $this->assertDatabaseHas('resident_registry', ['id' => $original->id, 'source_filename' => 'register.csv']);
        $this->assertDatabaseHas('resident_registry', ['source_filename' => null]);
    }

    public function test_admin_archive_disables_only_resident_accounts_and_audits_the_change(): void
    {
        $residentId = $this->createUser('resident', 'archive@example.test');
        $this->withHeaders($this->adminHeaders())->postJson("/api/admin/residents/{$residentId}/archive")
            ->assertOk()->assertJsonPath('success', true)->assertJsonPath('user.status', 'Disabled');
        $this->withHeaders($this->adminHeaders())->postJson("/api/admin/residents/{$residentId}/archive")
            ->assertOk()->assertJsonPath('alreadyArchived', true);
        $this->withHeaders($this->adminHeaders())->postJson("/api/admin/residents/{$this->staffId}/archive")
            ->assertBadRequest()->assertJsonPath('message', 'Only resident accounts can be archived here.');
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'resident.archived',
            'target_type' => 'user',
            'target_id' => $residentId,
        ]);
    }
}
