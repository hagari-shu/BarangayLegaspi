<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class IssueAdminInvitation extends Command
{
    protected $signature = 'app:invite-admin {email} {--confirm : Confirm issuance of an Admin setup invitation}';

    protected $description = 'Issue a single-use Admin setup invitation through the configured email provider';

    public function handle(): int
    {
        if (!$this->option('confirm')) {
            $this->error('No invitation issued. Re-run with --confirm after verifying the recipient and target database.');

            return self::FAILURE;
        }

        $email = strtolower(trim((string) $this->argument('email')));
        if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('Provide a valid recipient email address.');

            return self::FAILURE;
        }

        $publicAppUrl = (string) config('invitations.public_app_url', '');
        $fromEmail = (string) config('invitations.from_email', '');
        $apiKey = (string) config('services.resend.key', '');
        $publicUrl = parse_url($publicAppUrl);
        if (
            !$publicUrl
            || strtolower((string) ($publicUrl['scheme'] ?? '')) !== 'https'
            || empty($publicUrl['host'])
            || isset($publicUrl['user'])
            || isset($publicUrl['pass'])
            || isset($publicUrl['query'])
            || isset($publicUrl['fragment'])
            || !in_array($publicUrl['path'] ?? '', ['', '/'], true)
        ) {
            $this->error('PUBLIC_APP_URL must be configured as the official HTTPS portal origin.');

            return self::FAILURE;
        }
        if (!$apiKey || strlen($apiKey) > 4096 || !filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
            $this->error('Configure RESEND_API_KEY and a valid SUPER_ADMIN_INVITATION_FROM_EMAIL.');

            return self::FAILURE;
        }
        if (!Schema::hasTable('staff_invitations')) {
            $this->error('The Laravel staff invitation schema is not installed. No invitation was issued.');

            return self::FAILURE;
        }

        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $invitationId = (string) Str::uuid();
        $issuedAt = now();
        $expiresAt = $issuedAt->copy()->addHours(12);
        $inviteUrl = rtrim($publicAppUrl, '/').'/staff-invite#'.http_build_query(['token' => $token]);

        try {
            $created = DB::transaction(function () use ($email, $invitationId, $issuedAt, $expiresAt, $token) {
                if (DB::table('users')->whereRaw('LOWER(email) = ?', [$email])->lockForUpdate()->exists()) {
                    return false;
                }

                if (Schema::hasTable('super_admin_invitations')) {
                    $pendingSuperAdminInvitation = DB::table('super_admin_invitations')
                        ->whereRaw('LOWER(email) = ?', [$email])
                        ->whereNull('accepted_at')
                        ->whereNull('revoked_at')
                        ->where('expires_at', '>', $issuedAt)
                        ->lockForUpdate()
                        ->exists();
                    if ($pendingSuperAdminInvitation) {
                        return false;
                    }
                }

                $pending = DB::table('staff_invitations')
                    ->whereRaw('LOWER(email) = ?', [$email])
                    ->whereNull('accepted_at')
                    ->whereNull('revoked_at')
                    ->where('expires_at', '>', $issuedAt)
                    ->lockForUpdate()
                    ->exists();
                if ($pending) {
                    return false;
                }

                $expiredInvitations = DB::table('staff_invitations')
                    ->whereRaw('LOWER(email) = ?', [$email])
                    ->whereNull('accepted_at')
                    ->whereNull('revoked_at')
                    ->where('expires_at', '<=', $issuedAt)
                    ->lockForUpdate()
                    ->get(['id', 'role']);
                foreach ($expiredInvitations as $expiredInvitation) {
                    DB::table('staff_invitations')
                        ->where('id', $expiredInvitation->id)
                        ->update(['revoked_at' => $issuedAt]);
                    DB::table('audit_logs')->insert([
                        'id' => (string) Str::uuid(),
                        'actor_id' => null,
                        'actor_role' => 'deployment_operator',
                        'action' => $expiredInvitation->role === 'admin'
                            ? 'admin.invitation.expired_revoked'
                            : 'staff.invitation.expired_revoked',
                        'target_type' => $expiredInvitation->role.'_invitation',
                        'target_id' => $expiredInvitation->id,
                        'metadata' => json_encode(['reason' => 'expired_before_reissue']),
                        'created_at' => $issuedAt,
                    ]);
                }

                DB::table('staff_invitations')->insert([
                    'id' => $invitationId,
                    'email' => $email,
                    'role' => 'admin',
                    'position' => 'Administrator',
                    'token_hash' => hash('sha256', $token),
                    'issued_at' => $issuedAt,
                    'expires_at' => $expiresAt,
                ]);
                DB::table('audit_logs')->insert([
                    'id' => (string) Str::uuid(),
                    'actor_id' => null,
                    'actor_role' => 'deployment_operator',
                    'action' => 'admin.invitation.issued',
                    'target_type' => 'admin_invitation',
                    'target_id' => $invitationId,
                    'metadata' => json_encode(['expiresAt' => $expiresAt->toISOString()]),
                    'created_at' => $issuedAt,
                ]);

                return true;
            });
        } catch (\Throwable $error) {
            Log::error('Admin invitation issuance failed before delivery', [
                'exception' => $error::class,
            ]);
            $this->error('Unable to issue the Admin invitation. Check the Laravel database and migration status.');

            return self::FAILURE;
        }

        if (!$created) {
            $this->error('An account or active invitation already uses this email. No invitation was issued.');

            return self::FAILURE;
        }

        $safeUrl = htmlspecialchars($inviteUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeExpiry = htmlspecialchars($expiresAt->toISOString(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        try {
            $response = Http::timeout(10)
                ->acceptJson()
                ->withToken($apiKey)
                ->post('https://api.resend.com/emails', [
                    'from' => 'Barangay Legaspi <'.$fromEmail.'>',
                    'to' => [$email],
                    'subject' => 'Administrator account setup invitation',
                    'html' => '<p>You have been invited to set up a Barangay Legaspi Administrator account.</p><p><a href="'.$safeUrl.'">Set up your account</a></p><p>This single-use link expires at '.$safeExpiry.'.</p><p>If you were not expecting this invitation, you can ignore this email.</p>',
                    'text' => "You have been invited to set up a Barangay Legaspi Administrator account.\n\nSet up your account: {$inviteUrl}\n\nThis single-use link expires at {$expiresAt->toISOString()}.\nIf you were not expecting this invitation, you can ignore this email.",
                ]);
            if (!$response->successful()) {
                throw new \RuntimeException('Email provider rejected delivery with HTTP '.$response->status().'.');
            }
        } catch (\Throwable $error) {
            DB::transaction(function () use ($invitationId, $email) {
                DB::table('staff_invitations')
                    ->where('id', $invitationId)
                    ->whereNull('accepted_at')
                    ->update(['revoked_at' => now()]);
                DB::table('audit_logs')->insert([
                    'id' => (string) Str::uuid(),
                    'actor_id' => null,
                    'actor_role' => 'deployment_operator',
                    'action' => 'admin.invitation.delivery_failed',
                    'target_type' => 'admin_invitation',
                    'target_id' => $invitationId,
                    'metadata' => json_encode(['email' => $email]),
                    'created_at' => now(),
                ]);
            });
            Log::error('Admin invitation email delivery failed', [
                'exception' => $error::class,
                'message' => $error->getMessage(),
            ]);
            $this->error('The invitation was revoked because email delivery failed. Fix email configuration before retrying.');

            return self::FAILURE;
        }

        $this->info('Admin setup invitation was emailed to the intended account holder.');
        $this->line('The single-use invitation expires at '.$expiresAt->toISOString().'. The link was not printed.');

        return self::SUCCESS;
    }
}
