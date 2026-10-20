<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AdminInvitationCommandTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'app.env' => 'testing',
            'invitations.public_app_url' => 'https://barangay-legaspi.gov.ph',
            'invitations.from_email' => 'no-reply@example.test',
            'services.resend.key' => 're_test_secret',
        ]);
    }

    public function test_admin_invitation_is_single_use_hashed_audited_and_not_printed(): void
    {
        Http::fake([
            'https://api.resend.com/emails' => Http::response(['id' => 'email-1'], 200),
        ]);

        $exitCode = Artisan::call('app:invite-admin', [
            'email' => 'Initial.Admin@example.test',
            '--confirm' => true,
        ]);
        $output = Artisan::output();

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString('The link was not printed.', $output);
        $this->assertStringNotContainsString('token=', $output);
        $this->assertDatabaseHas('staff_invitations', [
            'email' => 'initial.admin@example.test',
            'role' => 'admin',
            'position' => 'Administrator',
            'accepted_at' => null,
            'revoked_at' => null,
        ]);
        $invitation = DB::table('staff_invitations')->where('email', 'initial.admin@example.test')->first();
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $invitation->token_hash);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'admin.invitation.issued',
            'target_id' => $invitation->id,
            'actor_role' => 'deployment_operator',
        ]);
        Http::assertSent(function ($request) {
            $this->assertSame(['initial.admin@example.test'], $request['to']);
            $this->assertStringContainsString('/staff-invite#token=', $request['text']);

            return $request->url() === 'https://api.resend.com/emails';
        });
    }

    public function test_admin_invitation_requires_explicit_confirmation(): void
    {
        $exitCode = Artisan::call('app:invite-admin', [
            'email' => 'initial.admin@example.test',
        ]);

        $this->assertSame(1, $exitCode);
        $this->assertDatabaseCount('staff_invitations', 0);
        $this->assertDatabaseCount('audit_logs', 0);
        Http::assertNothingSent();
    }

    public function test_failed_email_delivery_revokes_and_audits_the_invitation(): void
    {
        Http::fake([
            'https://api.resend.com/emails' => Http::response(['message' => 'unavailable'], 503),
        ]);

        $exitCode = Artisan::call('app:invite-admin', [
            'email' => 'initial.admin@example.test',
            '--confirm' => true,
        ]);

        $this->assertSame(1, $exitCode);
        $invitation = DB::table('staff_invitations')->where('email', 'initial.admin@example.test')->first();
        $this->assertNotNull($invitation);
        $this->assertNotNull($invitation->revoked_at);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'admin.invitation.delivery_failed',
            'target_id' => $invitation->id,
        ]);
    }
}
