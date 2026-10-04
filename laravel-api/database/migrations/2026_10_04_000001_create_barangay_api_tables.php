<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('users')) {
            Schema::create('users', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('first_name', 100);
                $table->string('last_name', 100);
                $table->string('mobile', 20)->unique();
                $table->string('email')->unique();
                $table->text('password_hash');
                $table->string('role', 30)->default('resident');
                $table->string('household_id', 50)->nullable();
                $table->integer('family_members')->default(4);
                $table->json('household_members')->default('[]');
                $table->string('status', 80)->default('Active Resident');
                $table->text('address')->nullable();
                $table->integer('zone')->nullable();
                $table->string('position', 120)->nullable();
                $table->string('availability', 50)->default('Available');
                $table->text('mfa_secret')->nullable();
                $table->boolean('mfa_enabled')->default(false);
                $table->unsignedBigInteger('mfa_last_step')->default(0);
                $table->timestampTz('created_at')->useCurrent();
            });
        }

        $this->addColumn('users', 'household_members', fn (Blueprint $table) => $table->json('household_members')->default('[]'));
        $this->addColumn('users', 'mfa_secret', fn (Blueprint $table) => $table->text('mfa_secret')->nullable());
        $this->addColumn('users', 'mfa_enabled', fn (Blueprint $table) => $table->boolean('mfa_enabled')->default(false));
        $this->addColumn('users', 'mfa_last_step', fn (Blueprint $table) => $table->unsignedBigInteger('mfa_last_step')->default(0));
        $this->addColumn('users', 'position', fn (Blueprint $table) => $table->string('position', 120)->nullable());
        $this->addColumn('users', 'availability', fn (Blueprint $table) => $table->string('availability', 50)->default('Available'));

        if (!Schema::hasTable('requests')) {
            Schema::create('requests', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id')->index();
                $table->string('type', 100);
                $table->text('purpose');
                $table->text('notes')->nullable();
                $table->string('status', 50)->default('Pending');
                $table->string('delivery_method', 30)->default('online');
                $table->text('delivery_note')->nullable();
                $table->json('follow_ups')->default('[]');
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->nullable();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }
        $this->addColumn('requests', 'delivery_method', fn (Blueprint $table) => $table->string('delivery_method', 30)->default('online'));
        $this->addColumn('requests', 'delivery_note', fn (Blueprint $table) => $table->text('delivery_note')->nullable());
        $this->addColumn('requests', 'follow_ups', fn (Blueprint $table) => $table->json('follow_ups')->default('[]'));
        $this->addColumn('requests', 'updated_at', fn (Blueprint $table) => $table->timestampTz('updated_at')->nullable());

        if (!Schema::hasTable('announcements')) {
            Schema::create('announcements', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('tag', 30)->default('green');
                $table->string('title', 200);
                $table->text('content');
                $table->string('date', 100)->nullable();
                $table->json('social_channels')->default('[]');
                $table->timestampTz('created_at')->useCurrent();
            });
        }
        $this->addColumn('announcements', 'social_channels', fn (Blueprint $table) => $table->json('social_channels')->default('[]'));

        if (!Schema::hasTable('approvals')) {
            Schema::create('approvals', function (Blueprint $table) {
                $table->string('id', 100)->primary();
                $table->uuid('request_id')->nullable();
                $table->uuid('approved_by')->nullable();
                $table->string('approved_by_role', 30)->nullable();
                $table->timestampTz('date_approved')->nullable();
                $table->json('request_snapshot')->nullable();
                $table->timestampTz('archived_at')->nullable();
            });
        }
        $this->addColumn('approvals', 'request_id', fn (Blueprint $table) => $table->uuid('request_id')->nullable());
        $this->addColumn('approvals', 'approved_by', fn (Blueprint $table) => $table->uuid('approved_by')->nullable());
        $this->addColumn('approvals', 'approved_by_role', fn (Blueprint $table) => $table->string('approved_by_role', 30)->nullable());
        $this->addColumn('approvals', 'date_approved', fn (Blueprint $table) => $table->timestampTz('date_approved')->nullable());
        $this->addColumn('approvals', 'request_snapshot', fn (Blueprint $table) => $table->json('request_snapshot')->nullable());
        $this->addColumn('approvals', 'archived_at', fn (Blueprint $table) => $table->timestampTz('archived_at')->nullable());

        if (!Schema::hasTable('audit_logs')) {
            Schema::create('audit_logs', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('actor_id')->nullable();
                $table->string('actor_role', 30)->nullable();
                $table->string('action', 100);
                $table->string('target_type', 50)->nullable();
                $table->string('target_id', 100)->nullable();
                $table->json('metadata')->default('{}');
                $table->timestampTz('created_at')->useCurrent();
            });
        }
        $this->addColumn('audit_logs', 'actor_role', fn (Blueprint $table) => $table->string('actor_role', 30)->nullable());
        $this->addColumn('audit_logs', 'metadata', fn (Blueprint $table) => $table->json('metadata')->default('{}'));

        if (!Schema::hasTable('reports')) {
            Schema::create('reports', function (Blueprint $table) {
                $table->string('id', 100)->primary();
                $table->string('type', 100);
                $table->string('title', 200);
                $table->text('description')->nullable();
                $table->string('severity', 50)->nullable();
                $table->integer('zone')->nullable();
                $table->string('status', 50)->default('Open');
                $table->timestampTz('report_date')->useCurrent();
            });
        }

        if (!Schema::hasTable('payments')) {
            Schema::create('payments', function (Blueprint $table) {
                $table->string('id', 100)->primary();
                $table->string('label', 200);
                $table->string('status', 50)->default('Pending');
                $table->string('amount', 50);
                $table->timestampTz('created_at')->useCurrent();
            });
        }
        if (!Schema::hasTable('api_tokens')) {
            Schema::create('api_tokens', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('user_id')->index();
                $table->char('token_hash', 64)->unique();
                $table->timestampTz('expires_at')->nullable();
                $table->timestampTz('last_used_at')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }

        if (!Schema::hasTable('mfa_challenges')) {
            Schema::create('mfa_challenges', function (Blueprint $table) {
                $table->char('token_hash', 64)->primary();
                $table->uuid('user_id')->index();
                $table->timestampTz('expires_at');
                $table->timestampTz('created_at')->useCurrent();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }

        if (!Schema::hasTable('password_reset_tokens')) {
            Schema::create('password_reset_tokens', function (Blueprint $table) {
                $table->char('token_hash', 64)->primary();
                $table->uuid('user_id')->index();
                $table->timestampTz('expires_at');
                $table->timestampTz('created_at')->useCurrent();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }

        if (!Schema::hasTable('reminders')) {
            Schema::create('reminders', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('request_id')->index();
                $table->uuid('user_id')->index();
                $table->timestampTz('scheduled_at');
                $table->timestampTz('created_at')->useCurrent();
                $table->foreign('request_id')->references('id')->on('requests')->cascadeOnDelete();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }

        if (!Schema::hasTable('archives')) {
            Schema::create('archives', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('name', 255)->unique();
                $table->string('category', 50);
                $table->json('contents');
                $table->timestampTz('created_at')->useCurrent();
            });
        }
    }

    public function down(): void
    {
        // Existing installations may contain legacy data; this migration is intentionally irreversible.
    }

    private function addColumn(string $tableName, string $columnName, Closure $definition): void
    {
        if (!Schema::hasColumn($tableName, $columnName)) {
            Schema::table($tableName, $definition);
        }
    }
};
