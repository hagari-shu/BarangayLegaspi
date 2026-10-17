<?php

namespace App\Support;

use Illuminate\Support\Facades\Crypt;
use UnexpectedValueException;

class ResidentRegistryData
{
    private const FIELDS = [
        'firstName',
        'lastName',
        'birthDate',
        'sex',
        'householdId',
        'maritalStatus',
        'occupation',
        'address',
        'sourceReference',
        'sourceFilename',
    ];

    public static function encrypt(array $data, string $recordId): string
    {
        $privateData = [];
        foreach (self::FIELDS as $field) {
            $privateData[$field] = $data[$field] ?? null;
        }
        $privateData['_recordId'] = $recordId;

        return Crypt::encryptString(json_encode($privateData, JSON_THROW_ON_ERROR));
    }

    public static function decrypt(object $resident): array
    {
        $ciphertext = $resident->encrypted_data ?? null;
        if (!is_string($ciphertext) || $ciphertext === '') {
            throw new UnexpectedValueException('Resident private data is missing its encrypted payload.');
        }

        $privateData = json_decode(Crypt::decryptString($ciphertext), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($privateData)) {
            throw new UnexpectedValueException('Resident private data has an invalid encrypted payload.');
        }

        foreach (self::FIELDS as $field) {
            if (!array_key_exists($field, $privateData) && in_array($field, ['maritalStatus', 'occupation'], true)) {
                $privateData[$field] = null;
            } elseif (!array_key_exists($field, $privateData)) {
                throw new UnexpectedValueException('Resident private data is incomplete.');
            }
        }
        if (($privateData['_recordId'] ?? null) !== ($resident->id ?? null)) {
            throw new UnexpectedValueException('Resident private data does not match its record.');
        }
        unset($privateData['_recordId']);

        return $privateData;
    }
}
