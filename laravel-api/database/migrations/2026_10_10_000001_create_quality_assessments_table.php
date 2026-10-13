<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('quality_assessments')) {
            Schema::create('quality_assessments', function (Blueprint $table) {
                $table->uuid('user_id')->primary();
                $table->string('role', 30);
                $table->json('scores');
                $table->timestampTz('updated_at');
                $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('quality_assessments');
    }
};
