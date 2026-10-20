<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('resident_registry')) {
            Schema::create('resident_registry', function (Blueprint $table): void {
                $table->uuid('id')->primary();
                $table->string('first_name', 100);
                $table->string('last_name', 100);
                $table->date('birth_date')->nullable();
                $table->string('sex', 20)->nullable();
                $table->string('marital_status', 30)->nullable();
                $table->string('occupation', 120)->nullable();
                $table->string('household_id', 100)->nullable();
                $table->string('purok', 100)->nullable();
                $table->smallInteger('zone')->nullable();
                $table->string('address', 255)->nullable();
                $table->string('record_status', 20)->default('active');
                $table->string('verification_status', 20)->default('pending');
                $table->string('source_reference', 255)->nullable();
                $table->string('source_filename', 255)->nullable();
                $table->char('source_fingerprint', 64)->nullable()->unique();
                $table->uuid('created_by')->nullable();
                $table->uuid('verified_by')->nullable();
                $table->timestampTz('verified_at')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->nullable();
                $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
                $table->foreign('verified_by')->references('id')->on('users')->nullOnDelete();
                $table->index(['zone', 'purok', 'record_status', 'verification_status'], 'resident_registry_location_status_idx');
                $table->index(['household_id', 'zone', 'purok'], 'resident_registry_household_location_idx');
            });
        }

        if (!Schema::hasTable('registry_source_reviews')) {
            Schema::create('registry_source_reviews', function (Blueprint $table): void {
                $table->uuid('id')->primary();
                $table->smallInteger('zone')->nullable();
                $table->string('purok', 100);
                $table->string('status', 20)->default('open');
                $table->uuid('created_by')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->uuid('resolved_by')->nullable();
                $table->timestampTz('resolved_at')->nullable();
                $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
                $table->foreign('resolved_by')->references('id')->on('users')->nullOnDelete();
                $table->index(['status', 'created_at'], 'registry_source_reviews_status_created_idx');
            });
        }

        if (DB::getDriverName() === 'pgsql' || DB::getDriverName() === 'sqlite') {
            DB::statement(
                'CREATE UNIQUE INDEX IF NOT EXISTS registry_source_reviews_open_location_idx '
                .'ON registry_source_reviews (COALESCE(zone, 0), LOWER(purok)) WHERE status = \'open\''
            );
        }
    }

    public function down(): void
    {
        // Registry records are production data and must not be removed by rollback.
    }
};
