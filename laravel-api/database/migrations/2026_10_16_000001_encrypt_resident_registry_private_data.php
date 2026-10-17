<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('resident_registry')) {
            return;
        }

        if (!Schema::hasColumn('resident_registry', 'encrypted_data')) {
            Schema::table('resident_registry', function (Blueprint $table) {
                $table->text('encrypted_data')->nullable();
            });
        }
        DB::statement('DROP INDEX IF EXISTS resident_registry_household_location_idx');

        DB::transaction(function () {
            DB::table('resident_registry')
                ->whereNull('encrypted_data')
                ->orderBy('id')
                ->chunk(100, function ($residents) {
                    foreach ($residents as $resident) {
                        $privateData = [
                            'firstName' => $resident->first_name,
                            'lastName' => $resident->last_name,
                            'birthDate' => $resident->birth_date,
                            'sex' => $resident->sex,
                            'householdId' => $resident->household_id,
                            'address' => $resident->address,
                            'sourceReference' => $resident->source_reference,
                            'sourceFilename' => $resident->source_filename,
                        ];

                        DB::table('resident_registry')->where('id', $resident->id)->update([
                            'encrypted_data' => Crypt::encryptString(json_encode([
                                ...$privateData,
                                '_recordId' => $resident->id,
                            ], JSON_THROW_ON_ERROR)),
                            'first_name' => '',
                            'last_name' => '',
                            'birth_date' => null,
                            'sex' => null,
                            'household_id' => null,
                            'address' => null,
                            'source_reference' => null,
                            'source_filename' => null,
                        ]);
                    }
                });
        });
    }

    public function down(): void
    {
        // Keep encrypted resident data intact on rollback.
    }
};
