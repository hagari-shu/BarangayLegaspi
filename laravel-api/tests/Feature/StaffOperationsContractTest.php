<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class StaffOperationsContractTest extends TestCase
{
    use RefreshDatabase;

    private function addUser(string $id, string $role, string $mobile): string
    {
        DB::table('users')->insert([
            'id' => $id,
            'first_name' => ucfirst($role),
            'last_name' => 'Operator',
            'mobile' => $mobile,
            'email' => $role.'-'.$id.'@example.test',
            'password_hash' => password_hash('Password!2026', PASSWORD_BCRYPT),
            'role' => $role,
            'household_id' => 'staff-operations-test',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => $role === 'admin' ? 'Administrator' : ($role === 'staff' ? 'On Duty' : 'Active Resident'),
            'address' => 'Barangay Hall, Legaspi',
            'zone' => $role === 'resident' ? 1 : 0,
            'position' => ucfirst($role),
            'availability' => 'Available',
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);

        $token = bin2hex(random_bytes(32));
        DB::table('api_tokens')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'user_id' => $id,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDay(),
            'created_at' => now(),
        ]);

        return $token;
    }

    public function test_invitation_validation_and_acceptance_are_role_aware_and_support_admin_bootstrap(): void
    {
        foreach (['staff', 'admin'] as $index => $role) {
            $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
            DB::table('staff_invitations')->insert([
                'id' => (string) \Illuminate\Support\Str::uuid(),
                'email' => $role.'-invite@example.test',
                'role' => $role,
                'position' => 'Operations Officer',
                'token_hash' => hash('sha256', $token),
                'issued_at' => now(),
                'expires_at' => now()->addHours(12),
            ]);

            $validation = $this->postJson('/api/staff/invitations/validate', ['token' => $token])
                ->assertOk()
                ->assertJsonPath('role', $role)
                ->assertJsonPath('email', $role.'-invite@example.test');
            $this->assertStringContainsString('no-store', $validation->headers->get('Cache-Control', ''));

            $this->postJson('/api/staff/invitations/accept', [
                'token' => $token,
                'firstName' => ucfirst($role),
                'lastName' => 'Operator',
                'mobile' => '0917000000'.($index + 1),
                'password' => 'StrongPass!2026',
            ])->assertCreated()->assertJsonPath('role', $role);

            $this->assertDatabaseHas('users', [
                'email' => $role.'-invite@example.test',
                'role' => $role,
                'position' => $role === 'admin' ? 'Administrator' : 'Operations Officer',
            ]);
            $this->postJson('/api/staff/invitations/accept', [
                'token' => $token,
                'firstName' => 'Another',
                'lastName' => 'Attempt',
                'mobile' => '0917999999'.($index + 1),
                'password' => 'StrongPass!2026',
            ])->assertStatus(410);
        }

        $this->assertDatabaseHas('audit_logs', ['action' => 'admin.invitation.accepted', 'actor_role' => 'admin']);
    }

    public function test_invitation_issue_endpoint_preserves_disabled_node_contract(): void
    {
        $adminToken = $this->addUser('00000000-0000-4000-8000-000000000101', 'admin', '09170000101');
        $this->withHeader('Authorization', 'Bearer '.$adminToken)
            ->postJson('/api/staff/invitations', ['role' => 'admin'])
            ->assertStatus(410)
            ->assertJsonPath('message', 'Portal invitations are no longer issued. Create the account directly from the portal.');
        $this->assertDatabaseCount('staff_invitations', 0);
    }

    public function test_temporary_access_is_single_use_and_scoped_to_active_staff(): void
    {
        $staffId = '00000000-0000-4000-8000-000000000201';
        $token = bin2hex(random_bytes(32));
        DB::table('users')->insert([
            'id' => $staffId,
            'first_name' => 'Staff',
            'last_name' => 'Member',
            'mobile' => '09170000201',
            'email' => 'staff-temp@example.test',
            'password_hash' => password_hash('Password!2026', PASSWORD_BCRYPT),
            'role' => 'staff',
            'household_id' => 'staff-temp',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'On Duty',
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 0,
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);
        DB::table('staff_temporary_access_grants')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'user_id' => $staffId,
            'token_hash' => hash('sha256', $token),
            'issued_at' => now(),
            'expires_at' => now()->addMinutes(15),
        ]);

        $this->postJson('/api/staff/temporary-access/redeem', ['token' => $token])
            ->assertOk()
            ->assertJsonStructure(['token', 'user'])
            ->assertJsonMissingPath('user.password_hash');
        $this->postJson('/api/staff/temporary-access/redeem', ['token' => $token])
            ->assertUnauthorized();
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'staff.temporary_access.redeemed',
            'target_id' => $staffId,
        ]);

        $mfaStaffId = '00000000-0000-4000-8000-000000000202';
        $mfaToken = bin2hex(random_bytes(32));
        DB::table('users')->insert([
            'id' => $mfaStaffId,
            'first_name' => 'MFA',
            'last_name' => 'Staff',
            'mobile' => '09170000202',
            'email' => 'staff-mfa-temp@example.test',
            'password_hash' => password_hash('Password!2026', PASSWORD_BCRYPT),
            'role' => 'staff',
            'household_id' => 'staff-mfa-temp',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'On Duty',
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 0,
            'mfa_secret' => 'encrypted-secret',
            'mfa_enabled' => true,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);
        DB::table('staff_temporary_access_grants')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'user_id' => $mfaStaffId,
            'token_hash' => hash('sha256', $mfaToken),
            'issued_at' => now(),
            'expires_at' => now()->addMinutes(15),
        ]);
        $challenge = $this->postJson('/api/staff/temporary-access/redeem', ['token' => $mfaToken])
            ->assertOk()
            ->assertJsonPath('requiresMfa', true)
            ->json('challengeToken');
        $this->assertDatabaseHas('mfa_challenges', [
            'token_hash' => hash('sha256', $challenge),
            'user_id' => $mfaStaffId,
            'temporary_access' => true,
        ]);
    }

    public function test_staff_presence_and_dashboard_permissions_match_role_contract(): void
    {
        $staffToken = $this->addUser('00000000-0000-4000-8000-000000000301', 'staff', '09170000301');
        $adminToken = $this->addUser('00000000-0000-4000-8000-000000000302', 'admin', '09170000302');
        $residentToken = $this->addUser('00000000-0000-4000-8000-000000000303', 'resident', '09170000303');

        $this->withHeader('Authorization', 'Bearer '.$staffToken)
            ->postJson('/api/staff/presence')->assertOk()->assertJsonPath('ok', true);
        $this->withHeader('Authorization', 'Bearer '.$adminToken)
            ->postJson('/api/staff/presence')->assertForbidden();
        $this->withHeader('Authorization', 'Bearer '.$residentToken)
            ->getJson('/api/staff/dashboard-requests')->assertForbidden();

        $presence = $this->withHeader('Authorization', 'Bearer '.$adminToken)
            ->getJson('/api/admin/staff/presence')
            ->assertOk()
            ->assertJsonStructure(['staff' => ['*' => ['id', 'firstName', 'lastName', 'position', 'email', 'mobile', 'status', 'lastSeen']]]);
        $this->assertNotNull($presence->json('staff.0.lastSeen'));
        $this->withHeader('Authorization', 'Bearer '.$staffToken)
            ->getJson('/api/staff/dashboard-requests')
            ->assertOk()
            ->assertJsonPath('summary.deadlineTracking', false);
    }

    public function test_staff_request_report_csv_filters_and_escapes_spreadsheet_formulas(): void
    {
        $staffToken = $this->addUser('00000000-0000-4000-8000-000000000401', 'staff', '09170000401');
        $requestId = '00000000-0000-4000-8000-000000000402';
        DB::table('requests')->insert([
            'id' => $requestId,
            'user_id' => '00000000-0000-4000-8000-000000000401',
            'type' => '=SUM(A1:A2)',
            'purpose' => 'Test',
            'notes' => '',
            'status' => 'Approved',
            'delivery_method' => 'online',
            'delivery_note' => '',
            'follow_ups' => '[]',
            'status_history' => json_encode([['status' => 'Approved', 'createdAt' => now()->toISOString()]]),
            'created_at' => now(),
        ]);

        $this->withHeader('Authorization', 'Bearer '.$staffToken)
            ->getJson('/api/staff/reports')
            ->assertOk()
            ->assertJsonPath('summary.received', 1)
            ->assertJsonPath('summary.approved', 1);

        $response = $this->withHeader('Authorization', 'Bearer '.$staffToken)
            ->get('/api/staff/reports/export.csv');
        $response->assertOk();
        $this->assertStringContainsString('attachment; filename="service-requests-all-time.csv"', $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString("\"'=SUM(A1:A2)\"", $response->getContent());
    }

    public function test_staff_retraction_creates_one_linked_announcement_only_once(): void
    {
        $staffToken = $this->addUser('00000000-0000-4000-8000-000000000501', 'staff', '09170000501');
        $announcementId = '00000000-0000-4000-8000-000000000502';
        DB::table('announcements')->insert([
            'id' => $announcementId,
            'tag' => 'green',
            'title' => 'Office hours',
            'content' => 'Original notice',
            'date' => '2026-10-20',
            'social_channels' => '[]',
            'social_delivery' => '{}',
            'created_at' => now(),
        ]);

        $this->withHeader('Authorization', 'Bearer '.$staffToken)
            ->postJson('/api/announcements/'.$announcementId.'/retract', ['content' => 'Correction'])
            ->assertCreated()
            ->assertJsonPath('announcement.relatedAnnouncementId', $announcementId);
        $this->withHeader('Authorization', 'Bearer '.$staffToken)
            ->postJson('/api/announcements/'.$announcementId.'/retract', ['content' => 'Another correction'])
            ->assertStatus(409);
        $this->assertDatabaseCount('announcements', 2);
    }

    public function test_reports_creation_and_staff_password_reset_are_role_checked_and_audited(): void
    {
        $staffToken = $this->addUser('00000000-0000-4000-8000-000000000551', 'staff', '09170000551');
        $adminToken = $this->addUser('00000000-0000-4000-8000-000000000552', 'admin', '09170000552');
        $staffId = '00000000-0000-4000-8000-000000000553';
        DB::table('users')->insert([
            'id' => $staffId,
            'first_name' => 'Target',
            'last_name' => 'Staff',
            'mobile' => '09170000553',
            'email' => 'target-staff@example.test',
            'password_hash' => password_hash('OldPassword!2026', PASSWORD_BCRYPT),
            'role' => 'staff',
            'household_id' => 'target-staff',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'On Duty',
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 0,
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);
        DB::table('api_tokens')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'user_id' => $staffId,
            'token_hash' => hash('sha256', 'existing-staff-session'),
            'expires_at' => now()->addDay(),
            'created_at' => now(),
        ]);

        $this->withHeader('Authorization', 'Bearer '.$staffToken)
            ->postJson('/api/staff/reports', ['type' => 'Safety', 'title' => 'Broken light'])
            ->assertForbidden();
        $this->withHeader('Authorization', 'Bearer '.$adminToken)
            ->postJson('/api/staff/reports', ['type' => 'Safety', 'title' => 'Broken light'])
            ->assertCreated()
            ->assertJsonPath('report.status', 'Open');

        $this->withHeader('Authorization', 'Bearer '.$adminToken)
            ->postJson('/api/admin/staff/'.$staffId.'/password', ['password' => 'Replacement!2026'])
            ->assertOk()
            ->assertExactJson(['ok' => true]);
        $this->assertDatabaseCount('api_tokens', 2);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'staff.password_reset',
            'target_id' => $staffId,
        ]);
        $this->assertTrue(password_verify('Replacement!2026', DB::table('users')->where('id', $staffId)->value('password_hash')));
    }

    public function test_temporary_access_delivery_failure_revokes_grant_and_never_returns_link(): void
    {
        config(['app.env' => 'testing']);
        $keys = ['RESET_DELIVERY_URL' => 'https://delivery.example.test/hooks', 'PUBLIC_APP_URL' => 'https://portal.example.test'];
        $previous = [];
        foreach ($keys as $key => $value) {
            $previous[$key] = [
                'environment' => getenv($key),
                'envExists' => array_key_exists($key, $_ENV),
                'envValue' => $_ENV[$key] ?? null,
                'serverExists' => array_key_exists($key, $_SERVER),
                'serverValue' => $_SERVER[$key] ?? null,
            ];
            putenv($key.'='.$value);
            $_ENV[$key] = $value;
            $_SERVER[$key] = $value;
        }
        Http::fake(['https://delivery.example.test/hooks' => Http::response(['error' => 'offline'], 503)]);
        $adminToken = $this->addUser('00000000-0000-4000-8000-000000000601', 'admin', '09170000601');
        $staffId = '00000000-0000-4000-8000-000000000602';
        DB::table('users')->insert([
            'id' => $staffId,
            'first_name' => 'Staff',
            'last_name' => 'Member',
            'mobile' => '09170000602',
            'email' => 'delivery-target@example.test',
            'password_hash' => password_hash('Password!2026', PASSWORD_BCRYPT),
            'role' => 'staff',
            'household_id' => 'staff-delivery',
            'family_members' => 1,
            'household_members' => '[]',
            'status' => 'On Duty',
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 0,
            'mfa_enabled' => false,
            'mfa_last_step' => 0,
            'created_at' => now(),
        ]);

        try {
            $this->withHeader('Authorization', 'Bearer '.$adminToken)
                ->postJson('/api/admin/staff/'.$staffId.'/temporary-access')
                ->assertStatus(503)
                ->assertJsonMissingPath('token');
            $this->assertDatabaseHas('staff_temporary_access_grants', ['user_id' => $staffId]);
            $this->assertNotNull(DB::table('staff_temporary_access_grants')->where('user_id', $staffId)->value('revoked_at'));
        } finally {
            foreach ($previous as $key => $value) {
                if ($value['environment'] === false) {
                    putenv($key);
                } else {
                    putenv($key.'='.$value['environment']);
                }
                if ($value['envExists']) {
                    $_ENV[$key] = $value['envValue'];
                } else {
                    unset($_ENV[$key]);
                }
                if ($value['serverExists']) {
                    $_SERVER[$key] = $value['serverValue'];
                } else {
                    unset($_SERVER[$key]);
                }
            }
        }
    }
}
