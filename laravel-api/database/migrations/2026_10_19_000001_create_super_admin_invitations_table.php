<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('super_admin_invitations')) {
            Schema::create('super_admin_invitations', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->string('email');
                $table->char('token_hash', 64)->unique();
                $table->timestampTz('issued_at');
                $table->timestampTz('expires_at');
                $table->timestampTz('accepted_at')->nullable();
                $table->timestampTz('revoked_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('super_admin_invitations');
    }
};
