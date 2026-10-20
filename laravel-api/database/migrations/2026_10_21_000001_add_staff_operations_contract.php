<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && !Schema::hasColumn('users', 'last_seen')) {
            Schema::table('users', fn (Blueprint $table) => $table->timestampTz('last_seen')->nullable());
        }

        if (Schema::hasTable('requests') && !Schema::hasColumn('requests', 'status_history')) {
            Schema::table('requests', fn (Blueprint $table) => $table->json('status_history')->default('[]'));
        }

        if (Schema::hasTable('announcements')) {
            if (!Schema::hasColumn('announcements', 'social_delivery')) {
                Schema::table('announcements', fn (Blueprint $table) => $table->json('social_delivery')->default('{}'));
            }
            if (!Schema::hasColumn('announcements', 'facebook_post_id')) {
                Schema::table('announcements', fn (Blueprint $table) => $table->text('facebook_post_id')->nullable());
            }
            if (!Schema::hasColumn('announcements', 'retraction_announcement_id')) {
                Schema::table('announcements', fn (Blueprint $table) => $table->uuid('retraction_announcement_id')->nullable());
            }
            if (!Schema::hasColumn('announcements', 'related_announcement_id')) {
                Schema::table('announcements', fn (Blueprint $table) => $table->uuid('related_announcement_id')->nullable());
            }
        }

        if (!Schema::hasTable('staff_invitations')) {
            Schema::create('staff_invitations', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('email', 255);
                $table->string('role', 30)->default('staff');
                $table->string('position', 120)->default('Staff');
                $table->char('token_hash', 64)->unique();
                $table->timestampTz('issued_at');
                $table->timestampTz('expires_at');
                $table->timestampTz('accepted_at')->nullable();
                $table->timestampTz('revoked_at')->nullable();
            });
        }

        if (!Schema::hasTable('staff_temporary_access_grants')) {
            Schema::create('staff_temporary_access_grants', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id')->index();
                $table->char('token_hash', 64)->unique();
                $table->uuid('issued_by')->nullable();
                $table->timestampTz('issued_at');
                $table->timestampTz('expires_at');
                $table->timestampTz('used_at')->nullable();
                $table->timestampTz('revoked_at')->nullable();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('issued_by')->references('id')->on('users')->nullOnDelete();
                $table->index(['user_id', 'expires_at'], 'staff_temporary_access_grants_user_idx');
            });
        }

        if (!Schema::hasTable('announcement_messenger_deliveries')) {
            Schema::create('announcement_messenger_deliveries', function (Blueprint $table) {
                $table->uuid('announcement_id');
                $table->text('psid');
                $table->timestampTz('sent_at');
                $table->primary(['announcement_id', 'psid']);
                $table->foreign('announcement_id')->references('id')->on('announcements')->cascadeOnDelete();
            });
        }

        if (Schema::hasTable('mfa_challenges')) {
            if (!Schema::hasColumn('mfa_challenges', 'temporary_access')) {
                Schema::table('mfa_challenges', fn (Blueprint $table) => $table->boolean('temporary_access')->default(false));
            }
            if (!Schema::hasColumn('mfa_challenges', 'session_expires_at')) {
                Schema::table('mfa_challenges', fn (Blueprint $table) => $table->timestampTz('session_expires_at')->nullable());
            }
        }

        if (Schema::hasTable('staff_invitations') && in_array(DB::getDriverName(), ['pgsql', 'sqlite'], true)) {
            DB::statement(
                'CREATE UNIQUE INDEX IF NOT EXISTS staff_invitations_pending_email_idx '.
                'ON staff_invitations (LOWER(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL'
            );
        }
    }

    public function down(): void
    {
        // Keep issued/consumed credentials and operational history intact on rollback.
    }
};
