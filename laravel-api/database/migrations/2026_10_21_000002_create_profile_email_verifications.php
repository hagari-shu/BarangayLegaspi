<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('profile_email_verifications')) {
            Schema::create('profile_email_verifications', function (Blueprint $table) {
                $table->uuid('user_id')->primary();
                $table->string('email', 255);
                $table->char('code_hash', 64);
                $table->timestampTz('expires_at');
                $table->unsignedTinyInteger('attempts')->default(0);
                $table->timestampTz('created_at')->useCurrent();
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('profile_email_verifications');
    }
};
