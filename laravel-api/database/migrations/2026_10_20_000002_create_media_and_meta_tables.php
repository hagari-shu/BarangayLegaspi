<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('official_profiles')) {
            Schema::create('official_profiles', function (Blueprint $table): void {
                $table->string('role', 20)->primary();
                $table->string('display_name', 120)->default('');
                $table->text('profile_url')->default('');
                $table->text('group_url')->default('');
                $table->json('community_links')->default('[]');
                $table->uuid('updated_by')->nullable();
                $table->timestampTz('updated_at')->useCurrent();
                $table->foreign('updated_by')->references('id')->on('users')->nullOnDelete();
            });
        }

        foreach (['captain', 'secretary', 'treasurer'] as $role) {
            DB::table('official_profiles')->insertOrIgnore([
                'role' => $role,
                'display_name' => '',
                'profile_url' => '',
                'group_url' => '',
                'community_links' => json_encode([]),
                'updated_at' => now(),
            ]);
        }

        if (!Schema::hasTable('messenger_subscribers')) {
            Schema::create('messenger_subscribers', function (Blueprint $table): void {
                $table->text('psid')->primary();
                $table->boolean('opted_in')->default(false);
                $table->timestampTz('last_message_at');
                $table->timestampTz('updated_at')->useCurrent();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('messenger_subscribers');
        Schema::dropIfExists('official_profiles');
    }
};
