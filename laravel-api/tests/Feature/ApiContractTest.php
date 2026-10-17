<?php

namespace Tests\Feature;

use App\Support\ResidentRegistryData;
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
            ->assertJsonPath('storage', DB::connection()->getDriverName());
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

    public function test_resident_registry_migration_encrypts_existing_personal_data_and_clears_legacy_columns(): void
    {
        DB::table('resident_registry')->insert([
            'id' => '00000000-0000-4000-8000-000000000105',
            'first_name' => 'Legacy',
            'last_name' => 'Resident',
            'birth_date' => '1990-01-02',
            'sex' => 'Female',
            'household_id' => 'HH-LEGACY',
            'purok' => 'Purok 2',
            'zone' => 2,
            'address' => 'Private address',
            'record_status' => 'active',
            'verification_status' => 'pending',
            'source_reference' => 'Register page 1',
            'source_filename' => 'private-roster.csv',
            'created_at' => now(),
        ]);

        $migration = require database_path('migrations/2026_10_16_000001_encrypt_resident_registry_private_data.php');
        $migration->up();

        $stored = DB::table('resident_registry')->where('id', '00000000-0000-4000-8000-000000000105')->first();
        $this->assertSame('', $stored->first_name);
        $this->assertSame('', $stored->last_name);
        $this->assertNull($stored->birth_date);
        $this->assertNull($stored->sex);
        $this->assertNull($stored->household_id);
        $this->assertNull($stored->address);
        $this->assertNull($stored->source_reference);
        $this->assertNull($stored->source_filename);
        $this->assertStringNotContainsString('Legacy', $stored->encrypted_data);
        $this->assertSame('Private address', ResidentRegistryData::decrypt($stored)['address']);
    }

    public function test_public_content_reads_from_laravel_storage_without_node_dependency(): void
    {
        DB::table('announcements')->insert([
            'id' => '00000000-0000-4000-8000-000000000099',
            'tag' => 'green',
            'title' => 'Office hours',
            'content' => 'The office is open on Friday.',
            'date' => '2026-10-15',
            'social_channels' => '["facebook"]',
            'created_at' => now(),
        ]);

        $this->getJson('/api/events')
            ->assertOk()
            ->assertExactJson(['events' => []]);

        $this->getJson('/api/announcements')
            ->assertOk()
            ->assertJsonPath('announcements.0.id', '00000000-0000-4000-8000-000000000099')
            ->assertJsonPath('announcements.0.title', 'Office hours')
            ->assertJsonPath('announcements.0.socialChannels.0', 'facebook');
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
            ->patchJson('/api/admin/users/00000000-0000-4000-8000-000000000001', [
                'householdId' => 'LEG-2026-001',
                'familyMembers' => 2,
                'householdMembers' => [
                    ['name' => 'Elena Santos', 'relationship' => 'Spouse'],
                ],
            ])
            ->assertForbidden();

        $this->withToken($login->json('token'))
            ->patchJson('/api/admin/users/00000000-0000-4000-8000-000000000001', [
                'householdMembers' => [['name' => 'Missing relationship']],
            ])
            ->assertForbidden();

        $this->withToken($login->json('token'))
            ->postJson('/api/announcements', [
                'title' => 'Community update',
                'content' => 'Scheduled public meeting',
                'socialChannels' => ['facebook', 'instagram', 'invalid'],
            ])
            ->assertForbidden();

        $this->withToken($login->json('token'))
            ->patchJson('/api/profile', ['firstName' => 'Changed'])
            ->assertForbidden();

        $this->assertDatabaseCount('announcements', 0);
        $this->assertDatabaseHas('users', ['id' => '00000000-0000-4000-8000-000000000001', 'household_id' => '2024-ADMIN']);
    }

    public function test_staff_cannot_create_or_delete_announcements(): void
    {
        $this->createStaffForApiTests();
        $login = $this->postJson('/api/login', [
            'identifier' => 'staff@barangay.gov.ph',
            'password' => 'Staff!2026Pass',
        ])->assertOk();

        $this->withToken($login->json('token'))
            ->postJson('/api/announcements', ['title' => 'Notice', 'content' => 'Content'])
            ->assertForbidden();

        $this->assertDatabaseCount('announcements', 0);
    }

    public function test_staff_can_review_pending_resident_accounts_but_admin_cannot_even_with_emergency_access(): void
    {
        $this->createAdminForApiTests();
        $this->createStaffForApiTests();
        $resident = $this->postJson('/api/register', [
            'firstName' => 'Pending',
            'lastName' => 'Resident',
            'mobile' => '09171234567',
            'email' => 'pending.review@example.test',
            'password' => 'Resident!2026Pass',
        ])->assertCreated();
        $residentId = $resident->json('user.id');

        $staffLogin = $this->postJson('/api/login', [
            'identifier' => 'staff@barangay.gov.ph',
            'password' => 'Staff!2026Pass',
        ])->assertOk();
        $adminLogin = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();
        $staffToken = $staffLogin->json('token');
        $adminToken = $adminLogin->json('token');

        $this->withToken($staffToken)
            ->getJson('/api/staff/account-approvals')
            ->assertOk()
            ->assertJsonPath('approvals.0.id', $residentId);
        $this->withToken($adminToken)->getJson('/api/staff/account-approvals')->assertForbidden();

        $this->withToken($adminToken)->postJson('/api/admin/emergency-access', [
            'reason' => 'Staff review access boundary verification.',
            'currentPassword' => 'Admin!2026Pass',
        ])->assertCreated();
        $this->withToken($adminToken)
            ->patchJson('/api/staff/account-approvals/'.$residentId, ['status' => 'Active Resident'])
            ->assertForbidden();

        $this->withToken($staffToken)
            ->patchJson('/api/staff/account-approvals/'.$residentId, ['status' => 'admin'])
            ->assertBadRequest();
        $this->withToken($staffToken)
            ->patchJson('/api/staff/account-approvals/'.$residentId, ['status' => 'Active Resident'])
            ->assertOk()
            ->assertJsonPath('user.status', 'Active Resident');
        $this->assertDatabaseHas('users', ['id' => $residentId, 'status' => 'Active Resident']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resident_account.approved', 'target_id' => $residentId]);
    }

    public function test_resident_staff_and_admin_roles_are_limited_to_their_api_surfaces(): void
    {
        $this->createAdminForApiTests();
        $this->createStaffForApiTests();
        $this->createResidentForApiTests();

        $resident = $this->postJson('/api/login', [
            'identifier' => 'resident@barangay.gov.ph',
            'password' => 'Resident!2026Pass',
        ])->assertOk();
        $staff = $this->postJson('/api/login', [
            'identifier' => 'staff@barangay.gov.ph',
            'password' => 'Staff!2026Pass',
        ])->assertOk();
        $admin = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();

        $this->withToken($resident->json('token'))->getJson('/api/requests')->assertOk();
        $this->withToken($resident->json('token'))->getJson('/api/admin/users')->assertForbidden();
        $this->withToken($resident->json('token'))
            ->postJson('/api/announcements', ['title' => 'Notice', 'content' => 'Content'])
            ->assertForbidden();

        $this->withToken($staff->json('token'))->getJson('/api/staff/requests')->assertOk();
        $this->withToken($staff->json('token'))->getJson('/api/staff/reports')->assertOk();
        $this->withToken($staff->json('token'))->getJson('/api/admin/users')->assertForbidden();
        $this->withToken($staff->json('token'))->getJson('/api/admin/approvals')->assertForbidden();
        $this->withToken($staff->json('token'))
            ->postJson('/api/admin/captain-photo/upload-url', ['contentType' => 'image/png'])
            ->assertForbidden();

        $this->withToken($admin->json('token'))->getJson('/api/admin/users')->assertOk();
        $this->withToken($admin->json('token'))->getJson('/api/admin/approvals')->assertOk();
        $this->withToken($admin->json('token'))->postJson('/api/announcements', [
            'title' => 'Blocked notice',
            'content' => 'An emergency grant must not unlock this operation.',
        ])->assertForbidden();
        $this->withToken($admin->json('token'))->getJson('/api/staff/requests')->assertForbidden();
        $this->withToken($admin->json('token'))->postJson('/api/admin/emergency-access', [
            'reason' => 'Temporary staff absence requires processing the resident request queue.',
            'currentPassword' => 'Admin!2026Pass',
        ])->assertCreated();
        $this->withToken($admin->json('token'))->getJson('/api/staff/requests')->assertOk();
        $this->withToken($admin->json('token'))->postJson('/api/announcements', [
            'title' => 'Still blocked',
            'content' => 'Break-glass does not unlock announcements.',
        ])->assertForbidden();
        $this->assertDatabaseCount('announcements', 0);
    }

    public function test_mfa_setup_preserves_pending_secrets_and_matches_the_frontend_contract(): void
    {
        config([
            'app.jwt_secret' => 'test-jwt-secret-that-is-at-least-32-characters',
            'app.mfa_encryption_key' => 'test-mfa-encryption-key-that-is-at-least-32-characters',
        ]);
        $this->createAdminForApiTests();
        $login = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();

        $firstSetup = $this->withToken($login->json('token'))
            ->postJson('/api/mfa/setup')
            ->assertOk()
            ->assertJsonStructure(['secret', 'otpauthUri']);
        $secondSetup = $this->withToken($login->json('token'))
            ->postJson('/api/mfa/setup')
            ->assertOk()
            ->assertJsonPath('secret', $firstSetup->json('secret'))
            ->assertJsonPath('otpauthUri', $firstSetup->json('otpauthUri'));
        $this->withToken($login->json('token'))
            ->postJson('/api/mfa/setup', ['rotate' => true])
            ->assertOk()
            ->assertJsonMissing(['secret' => $secondSetup->json('secret')]);
    }

    public function test_mfa_codes_cannot_be_replayed_when_enabling_or_disabling_mfa(): void
    {
        config([
            'app.jwt_secret' => 'test-jwt-secret-that-is-at-least-32-characters',
            'app.mfa_encryption_key' => 'test-mfa-encryption-key-that-is-at-least-32-characters',
        ]);
        $this->createAdminForApiTests();
        $login = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();
        $token = $login->json('token');
        $setup = $this->withToken($token)->postJson('/api/mfa/setup')->assertOk();
        $code = $this->totpCode($setup->json('secret'), (int) floor(time() / 30));

        $this->withToken($token)
            ->postJson('/api/mfa/enable', ['code' => $code])
            ->assertOk();
        $this->withToken($token)
            ->postJson('/api/mfa/enable', ['code' => $code])
            ->assertStatus(409);
        $mfaLogin = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk()->assertJsonPath('requiresMfa', true);
        $this->postJson('/api/login/mfa', [
            'challengeToken' => $mfaLogin->json('challengeToken'),
            'code' => $code,
        ])->assertUnauthorized();
        $this->withToken($token)
            ->postJson('/api/mfa/disable', ['currentPassword' => 'Admin!2026Pass', 'code' => $code])
            ->assertUnauthorized();

        $this->assertDatabaseHas('users', [
            'email' => 'admin@barangay.gov.ph',
            'mfa_enabled' => true,
        ]);
    }

    public function test_staff_queue_reports_and_csv_export_match_the_frontend_contract(): void
    {
        $this->createAdminForApiTests();
        $requestId = '00000000-0000-4000-8000-000000000002';
        $submittedAt = now();
        DB::table('requests')->insert([
            'id' => $requestId,
            'user_id' => '00000000-0000-4000-8000-000000000001',
            'type' => 'Barangay Certificate',
            'purpose' => 'private purpose',
            'notes' => 'private note',
            'status' => 'Approved',
            'delivery_method' => 'online',
            'delivery_note' => '',
            'follow_ups' => '[]',
            'status_history' => json_encode([
                ['kind' => 'status', 'status' => 'Pending', 'createdAt' => $submittedAt->copy()->subHour()->toISOString()],
                ['kind' => 'status', 'status' => 'Approved', 'createdAt' => $submittedAt->toISOString()],
            ]),
            'created_at' => $submittedAt->copy()->subHour(),
            'updated_at' => $submittedAt,
        ]);
        $login = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();
        $token = $login->json('token');

        $this->withToken($token)->getJson('/api/staff/dashboard-requests?status=all')->assertForbidden();
        $this->withToken($token)->postJson('/api/admin/emergency-access', [
            'reason' => 'Temporary staff absence requires reviewing the resident request queue.',
            'currentPassword' => 'Admin!2026Pass',
        ])->assertCreated();

        $this->withToken($token)
            ->getJson('/api/staff/dashboard-requests?status=all&search=private%20purpose&page=1&pageSize=1')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('requests.0.id', $requestId)
            ->assertJsonPath('requests.0.first_name', 'Carmen')
            ->assertJsonPath('summary.approved', 1)
            ->assertJsonPath('summary.deadlineTracking', false);

        $date = $submittedAt->format('Y-m-d');
        $report = $this->withToken($token)
            ->getJson("/api/staff/reports?from={$date}&to={$date}")
            ->assertOk()
            ->assertJsonPath('summary.received', 1)
            ->assertJsonPath('summary.approvedDecisions', 1);
        $this->assertStringNotContainsString('private purpose', $report->getContent());
        $this->assertStringNotContainsString('admin@barangay.gov.ph', $report->getContent());

        $csv = $this->withToken($token)
            ->get("/api/staff/reports/export.csv?from={$date}&to={$date}")
            ->assertOk()
            ->assertHeader('Content-Type', 'text/csv; charset=utf-8');
        $this->assertStringContainsString('Barangay Certificate', $csv->getContent());
        $this->assertStringNotContainsString('private purpose', $csv->getContent());

        $this->withToken($token)
            ->getJson('/api/staff/reports?from=2026-02-30')
            ->assertBadRequest();
    }

    public function test_new_requests_include_a_status_timeline_and_the_creator_name(): void
    {
        $this->createResidentForApiTests();
        $login = $this->postJson('/api/login', [
            'identifier' => 'resident@barangay.gov.ph',
            'password' => 'Resident!2026Pass',
        ])->assertOk();

        $created = $this->withToken($login->json('token'))
            ->postJson('/api/requests', [
                'type' => 'Barangay Certificate',
                'purpose' => 'School enrollment',
            ])
            ->assertCreated()
            ->assertJsonPath('request.firstName', 'Jamie')
            ->assertJsonPath('request.statusHistory.0.kind', 'status')
            ->assertJsonPath('request.statusHistory.0.status', 'Pending');

        $this->assertDatabaseHas('requests', [
            'id' => $created->json('request.id'),
            'status' => 'Pending',
        ]);
    }

    public function test_admin_cannot_archive_a_resident_while_in_monitoring_mode(): void
    {
        $this->createAdminForApiTests();
        $residentId = '00000000-0000-4000-8000-000000000003';
        DB::table('users')->insert([
            'id' => $residentId,
            'first_name' => 'Luz',
            'last_name' => 'Reyes',
            'mobile' => '09171234567',
            'email' => 'luz@example.test',
            'password_hash' => password_hash('Resident!2026Pass', PASSWORD_BCRYPT),
            'role' => 'resident',
            'household_id' => '2026-RESIDENT',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'Active Resident',
            'address' => 'Legaspi',
            'zone' => 2,
            'created_at' => now(),
        ]);
        $login = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();

        $this->withToken($login->json('token'))
            ->postJson("/api/admin/residents/{$residentId}/archive")
            ->assertForbidden();
        $this->assertDatabaseHas('users', ['id' => $residentId, 'status' => 'Active Resident']);
    }

    public function test_admin_cannot_change_the_captain_photo_while_in_monitoring_mode(): void
    {
        $this->createAdminForApiTests();
        $login = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();

        $this->get('/api/captain-photo')
            ->assertNotFound()
            ->assertHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        $this->withToken($login->json('token'))
            ->postJson('/api/admin/captain-photo/upload-url', ['contentType' => 'image/gif'])
            ->assertForbidden();
        $this->withToken($login->json('token'))
            ->postJson('/api/admin/captain-photo/upload-url', ['contentType' => 'image/webp'])
            ->assertForbidden();
        $this->withToken($login->json('token'))
            ->postJson('/api/admin/captain-photo')
            ->assertForbidden();
        $this->withToken($login->json('token'))
            ->deleteJson('/api/admin/captain-photo')
            ->assertForbidden();
    }

    public function test_quality_assessment_endpoints_are_no_longer_registered(): void
    {
        $this->getJson('/api/quality-assessment')->assertNotFound();
        $this->putJson('/api/quality-assessment', [])->assertNotFound();
        $this->getJson('/api/admin/quality-assessments')->assertNotFound();
    }

    public function test_staff_registry_search_and_demographics_are_private_and_grouped_by_location(): void
    {
        $this->createAdminForApiTests();
        $this->createStaffForApiTests();
        $this->createResidentForApiTests();
        $staff = $this->postJson('/api/login', [
            'identifier' => 'staff@barangay.gov.ph',
            'password' => 'Staff!2026Pass',
        ])->assertOk();
        $resident = $this->postJson('/api/login', [
            'identifier' => 'resident@barangay.gov.ph',
            'password' => 'Resident!2026Pass',
        ])->assertOk();

        $this->withToken($staff->json('token'))
            ->postJson('/api/staff/residents', ['firstName' => 'Unknown', 'lastName' => 'Sex', 'sex' => 'Unclassified'])
            ->assertBadRequest();
        $this->withToken($staff->json('token'))
            ->postJson('/api/staff/residents', ['firstName' => 'Missing', 'lastName' => 'Sex'])
            ->assertBadRequest();

        DB::table('resident_registry')->insert([
            $this->encryptedRegistryFixture(
                '00000000-0000-4000-8000-000000000101',
                'Maria',
                'Dela Cruz',
                now('Asia/Manila')->subYears(25)->toDateString(),
                'Female',
                'HH-101',
                3,
                'Purok 3 Daya',
                'verified',
            ),
            $this->encryptedRegistryFixture(
                '00000000-0000-4000-8000-000000000102',
                'Juan',
                'Dela Cruz',
                now('Asia/Manila')->subYears(30)->toDateString(),
                'Male',
                'HH-101',
                3,
                'Purok 3 Daya',
                'verified',
            ),
            $this->encryptedRegistryFixture(
                '00000000-0000-4000-8000-000000000103',
                'Pending',
                'Resident',
                now('Asia/Manila')->subYears(25)->toDateString(),
                'Female',
                'HH-101',
                3,
                'Purok 3 Daya',
                'pending',
            ),
        ]);

        $this->withToken($resident->json('token'))->getJson('/api/staff/residents')->assertForbidden();
        $this->withToken($staff->json('token'))
            ->getJson('/api/staff/residents?search=Maria%20Dela&birthDate='.now('Asia/Manila')->subYears(25)->toDateString().'&age=25&zone=3&purok=Purok%203%20Daya')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('residents.0.firstName', 'Maria')
            ->assertJsonPath('residents.0.age', 25)
            ->assertJsonPath('residents.0.verificationStatus', 'verified');
        $readAudit = DB::table('audit_logs')->where('action', 'resident_registry.read')->first();
        $this->assertNotNull($readAudit);
        $this->assertStringNotContainsString('Maria', $readAudit->metadata);
        $this->assertStringNotContainsString(now('Asia/Manila')->subYears(25)->toDateString(), $readAudit->metadata);
        $this->assertStringNotContainsString('Purok 3 Daya', $readAudit->metadata);

        $this->withToken($staff->json('token'))
            ->getJson('/api/staff/demographics?zone=3&purok=Purok%203%20Daya')
            ->assertOk()
            ->assertJsonPath('overall.total', 2)
            ->assertJsonPath('overall.male', 1)
            ->assertJsonPath('overall.female', 1)
            ->assertJsonMissingPath('overall.unclassified')
            ->assertJsonPath('overall.households', 1)
            ->assertJsonPath('byPurok.0.label', 'Purok 3 Daya')
            ->assertJsonPath('byPurok.0.total', 2)
            ->assertJsonPath('byHousehold.0.householdId', 'HH-101');

        $admin = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();
        $this->withToken($admin->json('token'))
            ->getJson('/api/admin/demographics')
            ->assertOk()
            ->assertJsonPath('overall.total', 2)
            ->assertJsonMissingPath('byHousehold');
        $this->withToken($resident->json('token'))->getJson('/api/admin/demographics')->assertForbidden();

        $this->withToken($staff->json('token'))->getJson('/api/staff/residents?birthDate=2026-02-30')->assertBadRequest();
        $this->withToken($staff->json('token'))->getJson('/api/staff/residents?age=131')->assertBadRequest();
    }

    public function test_registry_creations_are_flagged_for_review_and_excluded_from_counts_until_verified(): void
    {
        $this->createStaffForApiTests();
        $login = $this->postJson('/api/login', [
            'identifier' => 'staff@barangay.gov.ph',
            'password' => 'Staff!2026Pass',
        ])->assertOk();
        $token = $login->json('token');

        $created = $this->withToken($token)->postJson('/api/staff/residents', [
            'firstName' => 'Luz',
            'lastName' => 'Reyes',
            'birthDate' => '1990-04-12',
            'sex' => 'Female',
            'household' => 'Household 5',
            'householdId' => 'Legacy household value',
            'maritalStatus' => 'Married',
            'occupation' => 'Teacher',
            'purok' => 'Purok 5',
            'zone' => 5,
            'sourceReference' => 'Register page 4 row 2',
        ])->assertCreated()
            ->assertJsonPath('resident.verificationStatus', 'pending')
            ->assertJsonPath('resident.household', 'Household 5')
            ->assertJsonPath('resident.maritalStatus', 'Married')
            ->assertJsonPath('resident.occupation', 'Teacher')
            ->assertJsonPath('reviewRequired', true);
        $id = $created->json('resident.id');

        $storedResident = DB::table('resident_registry')->where('id', $id)->first();
        $this->assertStringNotContainsString('Household 5', $storedResident->encrypted_data);
        $this->assertStringNotContainsString('Married', $storedResident->encrypted_data);
        $this->assertStringNotContainsString('Teacher', $storedResident->encrypted_data);
        $this->withToken($token)->patchJson('/api/staff/residents/'.$id, [
            'household' => 'Household 6',
            'householdId' => 'Ignored legacy value',
            'maritalStatus' => 'Single',
            'occupation' => 'Nurse',
        ])->assertOk()
            ->assertJsonPath('resident.household', 'Household 6')
            ->assertJsonPath('resident.householdId', 'Household 6')
            ->assertJsonPath('resident.maritalStatus', 'Single')
            ->assertJsonPath('resident.occupation', 'Nurse');

        $storedResident = DB::table('resident_registry')->where('id', $id)->first();
        $this->assertStringNotContainsString('Household 6', $storedResident->encrypted_data);
        $this->assertStringNotContainsString('Single', $storedResident->encrypted_data);
        $this->assertStringNotContainsString('Nurse', $storedResident->encrypted_data);

        $this->withToken($token)->getJson('/api/staff/demographics?zone=5')->assertOk()->assertJsonPath('overall.total', 0);
        $this->withToken($token)->patchJson('/api/staff/residents/'.$id.'/verify', ['verificationStatus' => 'verified'])
            ->assertOk()
            ->assertJsonPath('resident.verificationStatus', 'verified');
        $this->withToken($token)->getJson('/api/staff/demographics?zone=5')->assertOk()->assertJsonPath('overall.total', 1);
        $this->withToken($token)->patchJson('/api/staff/residents/'.$id.'/status', ['status' => 'deceased'])
            ->assertOk()
            ->assertJsonPath('resident.status', 'deceased');
        $this->withToken($token)->getJson('/api/staff/demographics?zone=5')->assertOk()->assertJsonPath('overall.total', 0);

        $this->assertDatabaseHas('audit_logs', ['action' => 'resident_registry.created', 'target_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resident_registry.verified', 'target_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'resident_registry.status_changed', 'target_id' => $id]);
    }

    public function test_possible_registry_duplicates_require_explicit_review_before_saving(): void
    {
        $this->createStaffForApiTests();
        $login = $this->postJson('/api/login', [
            'identifier' => 'staff@barangay.gov.ph',
            'password' => 'Staff!2026Pass',
        ])->assertOk();
        DB::table('resident_registry')->insert([
            $this->encryptedRegistryFixture(
                '00000000-0000-4000-8000-000000000104',
                'Ana',
                'Santos',
                '1995-08-12',
                'Female',
                'HH-1',
                1,
                'Purok 1',
                'verified',
            )
        ]);

        $payload = [
            'firstName' => 'Ana',
            'lastName' => 'Santos',
            'birthDate' => '1995-08-12',
            'sex' => 'Female',
            'householdId' => 'HH-1',
            'purok' => 'Purok 1',
            'zone' => 1,
        ];
        $this->withToken($login->json('token'))->postJson('/api/staff/residents', $payload)
            ->assertStatus(409)
            ->assertJsonPath('reviewRequired', true)
            ->assertJsonPath('potentialMatches.0.id', '00000000-0000-4000-8000-000000000104');
        $this->assertDatabaseCount('resident_registry', 1);

        $this->withToken($login->json('token'))->postJson('/api/staff/residents', $payload + ['confirmPotentialMatch' => true])
            ->assertCreated()
            ->assertJsonPath('reviewRequired', true);
        $this->assertDatabaseCount('resident_registry', 2);
    }

    public function test_registry_csv_import_is_validated_pending_and_audited_and_printing_is_audited(): void
    {
        $this->createStaffForApiTests();
        $login = $this->postJson('/api/login', [
            'identifier' => 'staff@barangay.gov.ph',
            'password' => 'Staff!2026Pass',
        ])->assertOk();
        $token = $login->json('token');
        $records = [
            [
                'firstName' => 'Lina',
                'lastName' => 'Reyes',
                'birthDate' => '1988-02-29',
                'sex' => 'Female',
                'household' => 'Household 3A',
                'zone' => '3',
                'maritalStatus' => 'Married',
                'occupation' => 'Teacher',
                'sourceReference' => 'Page 1 row 2',
            ],
            [
                'firstName' => 'Marco',
                'lastName' => 'Reyes',
                'birthDate' => null,
                'sex' => null,
                'household' => 'Household 3A',
                'zone' => '3',
                'maritalStatus' => 'Single',
                'occupation' => 'Farmer',
                'sourceReference' => 'Page 1 row 3',
            ],
        ];

        $this->withToken($token)->postJson('/api/staff/residents/import', [
            'filename' => 'purok-3-roster.csv',
            'residents' => [['firstName' => 'Lina', 'lastName' => 'Reyes', 'zone' => '8']],
        ])->assertBadRequest();
        $this->assertDatabaseCount('resident_registry', 0);

        $this->withToken($token)->postJson('/api/staff/residents/import', [
            'filename' => 'purok-3-roster.csv',
            'residents' => $records,
        ])->assertCreated()
            ->assertJsonPath('imported', 2)
            ->assertJsonPath('verificationStatus', 'pending');
        $this->assertDatabaseCount('resident_registry', 2);
        $storedResident = DB::table('resident_registry')->orderBy('created_at')->first();
        $this->assertSame('', $storedResident->first_name);
        $this->assertSame('', $storedResident->last_name);
        $this->assertNull($storedResident->birth_date);
        $this->assertNull($storedResident->household_id);
        $this->assertNull($storedResident->source_filename);
        $this->assertSame('pending', $storedResident->verification_status);
        $this->assertStringNotContainsString('Lina', $storedResident->encrypted_data);
        $this->assertSame('Lina', ResidentRegistryData::decrypt($storedResident)['firstName']);
        $this->assertSame('Household 3A', ResidentRegistryData::decrypt($storedResident)['householdId']);
        $this->assertSame('Married', ResidentRegistryData::decrypt($storedResident)['maritalStatus']);
        $this->assertSame('Teacher', ResidentRegistryData::decrypt($storedResident)['occupation']);
        $this->assertSame('purok-3-roster.csv', ResidentRegistryData::decrypt($storedResident)['sourceFilename']);
        $this->withToken($token)->getJson('/api/staff/residents?maritalStatus=Married&occupation=Teacher')
            ->assertOk()
            ->assertJsonPath('total', 1)
            ->assertJsonPath('residents.0.household', 'Household 3A')
            ->assertJsonPath('residents.0.maritalStatus', 'Married')
            ->assertJsonPath('residents.0.occupation', 'Teacher');

        $duplicate = $this->withToken($token)->postJson('/api/staff/residents/import', [
            'filename' => 'purok-3-roster.csv',
            'residents' => [$records[0]],
        ])->assertStatus(409)
            ->assertJsonPath('reviewRequired', true)
            ->assertJsonPath('potentialMatches.0.row', 2);
        $this->assertDatabaseCount('resident_registry', 2);
        $this->withToken($token)->postJson('/api/staff/residents/import', [
            'filename' => 'purok-3-roster.csv',
            'residents' => [$records[0]],
            'confirmPotentialMatches' => true,
        ])->assertCreated()
            ->assertJsonPath('imported', 1);
        $this->assertDatabaseCount('resident_registry', 3);

        $this->withToken($token)->postJson('/api/staff/residents/export-audit', [
            'count' => 3,
            'format' => 'csv',
            'grouping' => 'zone_household_name',
            'filters' => [
                'hasSearch' => false,
                'hasBirthDate' => false,
                'hasAge' => false,
                'hasZone' => true,
                'hasMaritalStatusFilter' => false,
                'hasOccupationFilter' => false,
            ],
        ])->assertOk()->assertJsonPath('success', true);
        $exportLog = DB::table('audit_logs')->where('action', 'resident_registry.exported')->first();
        $this->assertNotNull($exportLog);
        $this->assertStringNotContainsString('Lina', $exportLog->metadata);
        $this->assertStringNotContainsString('Household 3A', $exportLog->metadata);
        $this->withToken($token)->postJson('/api/staff/residents/export-audit', [
            'count' => 1,
            'format' => 'csv',
            'grouping' => 'name',
            'filters' => [],
        ])->assertBadRequest();

        $this->withToken($token)->postJson('/api/staff/residents/print-audit', [
            'count' => 3,
            'filters' => ['zone' => '3', 'purok' => 'Purok 3 Daya', 'page' => 1],
        ])->assertStatus(503)
            ->assertJsonPath('message', 'Managed office printing is not configured. No print job was started.');

        $importLogs = DB::table('audit_logs')->where('action', 'resident_registry.bulk_imported')->get();
        $this->assertCount(2, $importLogs);
        $this->assertStringNotContainsString('Lina', $importLogs->toJson());
        $this->assertStringNotContainsString('purok-3-roster.csv', $importLogs->toJson());
        $printLog = DB::table('audit_logs')->where('action', 'resident_registry.print.blocked')->first();
        $this->assertNotNull($printLog);
        $this->assertStringNotContainsString('Lina', $printLog->metadata);
        $this->assertStringNotContainsString('Reyes', $printLog->metadata);
        $this->assertStringNotContainsString('1988-02-29', $printLog->metadata);
        $this->assertNotNull($duplicate->json('potentialMatches.0.records.0.id'));
    }

    public function test_admin_emergency_access_requires_reauthentication_is_scoped_and_expires(): void
    {
        $this->createAdminForApiTests();
        $adminLogin = $this->postJson('/api/login', [
            'identifier' => 'admin@barangay.gov.ph',
            'password' => 'Admin!2026Pass',
        ])->assertOk();
        $token = $adminLogin->json('token');

        $this->withToken($token)->getJson('/api/staff/residents')->assertForbidden();
        $this->withToken($token)->getJson('/api/staff/dashboard-requests')->assertForbidden();
        $this->withToken($token)->getJson('/api/requests')->assertForbidden();
        $this->withToken($token)->postJson('/api/admin/emergency-access', [
            'reason' => 'Staff unavailable during an urgent local service interruption.',
            'currentPassword' => 'wrong-password',
        ])->assertUnauthorized();
        $this->assertDatabaseCount('emergency_access_grants', 0);

        $activation = $this->withToken($token)->postJson('/api/admin/emergency-access', [
            'reason' => 'Staff unavailable during an urgent local service interruption.',
            'currentPassword' => 'Admin!2026Pass',
        ])->assertCreated()
            ->assertJsonPath('active', true);
        $this->withToken($token)->getJson('/api/staff/residents')->assertOk();
        $this->withToken($token)->getJson('/api/staff/dashboard-requests')->assertOk();
        $this->withToken($token)->getJson('/api/requests')->assertOk();
        $this->withToken($token)->patchJson('/api/requests/00000000-0000-4000-8000-000000000099/status', ['status' => 'Approved'])->assertNotFound();
        $this->assertDatabaseHas('audit_logs', ['action' => 'emergency_access.activated']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'emergency_access.used', 'target_id' => 'resident-registry.read']);

        \Illuminate\Support\Carbon::setTestNow(now()->addMinutes(21));
        try {
            $this->withToken($token)->getJson('/api/staff/residents')->assertForbidden();
            $this->withToken($token)->postJson('/api/admin/emergency-access', [
                'reason' => 'Staff unavailable during an urgent local service interruption.',
                'currentPassword' => 'Admin!2026Pass',
            ])->assertCreated();
        } finally {
            \Illuminate\Support\Carbon::setTestNow();
        }

        $this->assertNotEmpty($activation->json('grant.id'));
    }

    private function createAdminForApiTests(): void
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
    }

    private function createStaffForApiTests(): void
    {
        DB::table('users')->insert([
            'id' => '00000000-0000-4000-8000-000000000002',
            'first_name' => 'Alex',
            'last_name' => 'Staff',
            'mobile' => '09999999998',
            'email' => 'staff@barangay.gov.ph',
            'password_hash' => password_hash('Staff!2026Pass', PASSWORD_BCRYPT),
            'role' => 'staff',
            'household_id' => null,
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'Active Staff',
            'address' => null,
            'zone' => null,
            'availability' => 'Available',
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);
    }

    private function createResidentForApiTests(): void
    {
        DB::table('users')->insert([
            'id' => '00000000-0000-4000-8000-000000000003',
            'first_name' => 'Jamie',
            'last_name' => 'Resident',
            'mobile' => '09999999997',
            'email' => 'resident@barangay.gov.ph',
            'password_hash' => password_hash('Resident!2026Pass', PASSWORD_BCRYPT),
            'role' => 'resident',
            'household_id' => null,
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'Active Resident',
            'address' => 'Legaspi, Tayug',
            'zone' => 1,
            'availability' => 'Available',
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);
    }

    private function encryptedRegistryFixture(
        string $id,
        string $firstName,
        string $lastName,
        ?string $birthDate,
        ?string $sex,
        ?string $householdId,
        int $zone,
        string $purok,
        string $verificationStatus,
    ): array {
        return [
            'id' => $id,
            'first_name' => '',
            'last_name' => '',
            'birth_date' => null,
            'sex' => null,
            'household_id' => null,
            'purok' => $purok,
            'zone' => $zone,
            'address' => null,
            'record_status' => 'active',
            'verification_status' => $verificationStatus,
            'source_reference' => null,
            'source_filename' => null,
            'encrypted_data' => ResidentRegistryData::encrypt([
                'firstName' => $firstName,
                'lastName' => $lastName,
                'birthDate' => $birthDate,
                'sex' => $sex,
                'householdId' => $householdId,
            ], $id),
            'created_at' => now(),
        ];
    }

    private function totpCode(string $secret, int $step): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        foreach (str_split($secret) as $character) {
            $value = strpos($alphabet, $character);
            $this->assertNotFalse($value);
            $bits .= str_pad(decbin($value), 5, '0', STR_PAD_LEFT);
        }
        $key = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $key .= chr(bindec($byte));
            }
        }

        $counter = pack('N2', ($step >> 32) & 0xffffffff, $step & 0xffffffff);
        $digest = hash_hmac('sha1', $counter, $key, true);
        $offset = ord($digest[strlen($digest) - 1]) & 0x0f;
        $binary = ((ord($digest[$offset]) & 0x7f) << 24)
            | ((ord($digest[$offset + 1]) & 0xff) << 16)
            | ((ord($digest[$offset + 2]) & 0xff) << 8)
            | (ord($digest[$offset + 3]) & 0xff);

        return str_pad((string) ($binary % 1_000_000), 6, '0', STR_PAD_LEFT);
    }
}
