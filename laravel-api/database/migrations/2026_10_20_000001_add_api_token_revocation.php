<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('users') && !Schema::hasColumn('users', 'tokens_valid_after')) {
            Schema::table('users', function (Blueprint $table) {
                $table->unsignedBigInteger('tokens_valid_after')->nullable();
            });
        }

        if (!Schema::hasTable('api_token_revocations')) {
            Schema::create('api_token_revocations', function (Blueprint $table) {
                $table->char('token_hash', 64)->primary();
                $table->timestampTz('expires_at');
                $table->timestampTz('created_at')->useCurrent();
            });
        }
    }

    public function down(): void
    {
        // Removing revocation records could make logged-out credentials valid again.
    }
};
