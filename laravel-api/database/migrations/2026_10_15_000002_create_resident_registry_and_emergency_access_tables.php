<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('resident_registry')) {
            Schema::create('resident_registry', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('first_name', 100);
                $table->string('last_name', 100);
                $table->date('birth_date')->nullable();
                $table->string('sex', 20)->nullable();
                $table->string('household_id', 100)->nullable();
                $table->string('purok', 100)->nullable();
                $table->unsignedTinyInteger('zone')->nullable();
                $table->string('address', 255)->nullable();
                $table->string('record_status', 20)->default('active');
                $table->string('verification_status', 20)->default('pending');
                $table->string('source_reference', 255)->nullable();
                $table->string('source_filename', 255)->nullable();
                $table->char('source_fingerprint', 64)->nullable()->unique();
                $table->text('encrypted_data')->nullable();
                $table->uuid('created_by')->nullable();
                $table->uuid('verified_by')->nullable();
                $table->timestampTz('verified_at')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->nullable();
                $table->index(['zone', 'purok', 'record_status', 'verification_status'], 'resident_registry_location_status_idx');
                $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
                $table->foreign('verified_by')->references('id')->on('users')->nullOnDelete();
            });
        }

        if (!Schema::hasTable('emergency_access_grants')) {
            Schema::create('emergency_access_grants', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('admin_id')->index();
                $table->string('reason', 500);
                $table->json('scopes');
                $table->string('active_slot', 30)->nullable()->unique();
                $table->timestampTz('activated_at')->useCurrent();
                $table->timestampTz('expires_at');
                $table->uuid('revoked_by')->nullable();
                $table->timestampTz('revoked_at')->nullable();
                $table->foreign('admin_id')->references('id')->on('users')->cascadeOnDelete();
                $table->foreign('revoked_by')->references('id')->on('users')->nullOnDelete();
                $table->index(['expires_at', 'revoked_at'], 'emergency_access_active_idx');
            });
        }
    }

    public function down(): void
    {
        // Preserve resident and emergency-access audit data on rollback.
    }
};
