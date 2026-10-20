<?php

namespace App\Http\Controllers;

use App\Support\ApiIdentity;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class ResidentRegistryController extends Controller
{
    private const MARITAL_STATUSES = ['Single', 'Married', 'Widowed', 'Legally Separated', 'Annulled'];
    private const VERIFICATION_STATUSES = ['pending', 'verified', 'needs_review'];
    private const RECORD_STATUSES = ['active', 'inactive', 'deceased', 'archived'];

    private function badRequest(string $message, array $extra = []): JsonResponse
    {
        return response()->json(['message' => $message] + $extra, 400);
    }

    private function jsString(mixed $value): string
    {
        if ($value === null) {
            return '';
        }

        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_array($value)) {
            return array_is_list($value)
                ? implode(',', array_map(fn (mixed $item): string => $this->jsString($item), $value))
                : '[object Object]';
        }

        return is_object($value) ? '[object Object]' : (string) $value;
    }

    private function cleanText(mixed $value): string
    {
        return trim(str_replace(['<', '>'], '', $this->jsString($value)));
    }

    private function numberFromJs(mixed $value): float
    {
        if (is_bool($value)) {
            return $value ? 1.0 : 0.0;
        }
        if ($value === null) {
            return 0.0;
        }
        if (is_int($value) || is_float($value)) {
            return (float) $value;
        }
        if (is_string($value) && trim($value) === '') {
            return 0.0;
        }
        if (is_string($value) && preg_match('/^0[xX][0-9a-fA-F]+$/', trim($value))) {
            return (float) hexdec(trim($value));
        }

        return is_numeric($value) ? (float) $value : NAN;
    }

    private function isUuid(string $value): bool
    {
        return (bool) preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value);
    }

    private function validDateKey(string $value): bool
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return false;
        }

        $date = CarbonImmutable::createFromFormat('!Y-m-d', $value, 'UTC');

        return $date !== false && $date->format('Y-m-d') === $value;
    }

    private function today(): string
    {
        return now('Asia/Manila')->format('Y-m-d');
    }

    private function timestamp(): string
    {
        return now('UTC')->format('Y-m-d\TH:i:s.v\Z');
    }

    private function isoTimestamp(mixed $value): ?string
    {
        if (!$value) {
            return null;
        }

        return CarbonImmutable::parse($value, 'UTC')->utc()->format('Y-m-d\TH:i:s.v\Z');
    }

    private function actor(Request $request): object
    {
        return $request->attributes->get('actor');
    }

    private function audit(object $actor, string $action, string $targetType, ?string $targetId, array $metadata = []): array
    {
        return [
            'id' => (string) Str::uuid(),
            'actor_id' => $actor->id,
            'actor_role' => $actor->role,
            'action' => $action,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR),
            'created_at' => now('UTC'),
        ];
    }

    private function dateValue(mixed $value): ?string
    {
        if (!$value) {
            return null;
        }

        return $value instanceof \DateTimeInterface ? $value->format('Y-m-d') : substr((string) $value, 0, 10);
    }

    private function normalizeResident(object|array $record): array
    {
        $row = (array) $record;
        $birthDate = $row['birth_date'] ?? $row['birthDate'] ?? null;

        return [
            'id' => $row['id'],
            'firstName' => $row['first_name'] ?? $row['firstName'] ?? '',
            'lastName' => $row['last_name'] ?? $row['lastName'] ?? '',
            'birthDate' => $this->dateValue($birthDate),
            'sex' => $row['sex'] ?? null,
            'maritalStatus' => $row['marital_status'] ?? $row['maritalStatus'] ?? null,
            'occupation' => $row['occupation'] ?? null,
            'householdId' => $row['household_id'] ?? $row['householdId'] ?? null,
            'purok' => $row['purok'] ?? null,
            'zone' => isset($row['zone']) ? (int) $row['zone'] : null,
            'address' => $row['address'] ?? null,
            'status' => $row['record_status'] ?? $row['recordStatus'] ?? $row['status'] ?? 'active',
            'verificationStatus' => $row['verification_status'] ?? $row['verificationStatus'] ?? 'pending',
        ];
    }

    private function residentMatchRecords(array $resident): array
    {
        $query = DB::table('resident_registry')
            ->whereRaw('LOWER(first_name) = ?', [mb_strtolower($resident['firstName'], 'UTF-8')])
            ->whereRaw('LOWER(last_name) = ?', [mb_strtolower($resident['lastName'], 'UTF-8')]);

        if ($resident['birthDate'] !== null) {
            $query->where(function ($matches) use ($resident): void {
                $matches->where('birth_date', $resident['birthDate'])->orWhereNull('birth_date');
            });
        }

        return $query->orderBy('created_at')->orderBy('id')->get([
            'id', 'first_name', 'last_name', 'birth_date', 'household_id', 'purok', 'zone', 'verification_status',
        ])->map(fn ($record): array => [
            'id' => (string) $record->id,
            'firstName' => $record->first_name,
            'lastName' => $record->last_name,
            'birthDate' => $this->dateValue($record->birth_date),
            'householdId' => $record->household_id,
            'purok' => $record->purok,
            'zone' => $record->zone === null ? null : (int) $record->zone,
            'verificationStatus' => $record->verification_status,
        ])->all();
    }

    private function savedMatchSnapshot(array $matches): array
    {
        return array_values(array_filter(array_map(static function (array $match): array {
            $ids = array_values(array_map('strval', array_column(
                array_filter($match['records'], static fn (array $record): bool => ($record['source'] ?? null) !== 'same import file'),
                'id'
            )));
            sort($ids, SORT_STRING);

            return ['row' => $match['row'], 'ids' => $ids];
        }, $matches), static fn (array $match): bool => count($match['ids']) > 0));
    }

    private function matchImportRows(array $residents, array $existingMatches): array
    {
        $matches = [];
        foreach ($residents as $index => $resident) {
            $records = $existingMatches[$index] ?? [];
            for ($earlierIndex = 0; $earlierIndex < $index; $earlierIndex++) {
                $earlier = $residents[$earlierIndex];
                if (mb_strtolower(trim($resident['firstName']), 'UTF-8') === mb_strtolower(trim($earlier['firstName']), 'UTF-8')
                    && mb_strtolower(trim($resident['lastName']), 'UTF-8') === mb_strtolower(trim($earlier['lastName']), 'UTF-8')) {
                    $records[] = [
                        'id' => 'upload-row-'.($earlierIndex + 2),
                        'firstName' => $earlier['firstName'],
                        'lastName' => $earlier['lastName'],
                        'birthDate' => $earlier['birthDate'],
                        'source' => 'same import file',
                    ];
                }
            }
            if ($records !== []) {
                $matches[] = ['row' => $index + 2, 'records' => $records];
            }
        }

        return $matches;
    }

    private function matchSnapshotsEqual(array $left, array $right): bool
    {
        return $left === $right;
    }

    private function lockIdentityKeys(array $residents): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $keys = array_values(array_unique(array_map(
            static function (array $resident): string {
                $firstName = mb_strtolower(trim($resident['firstName']), 'UTF-8');
                $lastName = mb_strtolower(trim($resident['lastName']), 'UTF-8');

                return strlen($firstName).':'.$firstName.$lastName;
            },
            $residents
        )));
        sort($keys, SORT_STRING);
        foreach ($keys as $key) {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [$key]);
        }
    }

    private function fingerprint(array $resident): string
    {
        $payload = [
            mb_strtolower(trim($resident['firstName']), 'UTF-8'),
            mb_strtolower(trim($resident['lastName']), 'UTF-8'),
            $resident['birthDate'] ?? null,
            $resident['sex'] ?? null,
            $resident['maritalStatus'] ?? null,
            $resident['occupation'] ?? null,
            $resident['householdId'] ?? null,
            $resident['purok'] ?? null,
            $resident['zone'] ?? null,
            $resident['address'] ?? null,
            $resident['sourceReference'] ?? null,
        ];

        return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private function insertResidents(array $residents, array $audit, bool $confirmed, array $reviewedMatches, int $rowOffset = 2): array
    {
        return DB::transaction(function () use ($residents, $audit, $confirmed, $reviewedMatches, $rowOffset): array {
            $this->lockIdentityKeys($residents);
            $existingMatches = [];
            foreach ($residents as $resident) {
                $existingMatches[] = $this->residentMatchRecords($resident);
            }

            if ($rowOffset === 1) {
                $potentialMatches = $existingMatches[0] ?? [];
                $matchRows = $potentialMatches === [] ? [] : [['row' => 1, 'records' => $potentialMatches]];
            } else {
                $matchRows = $this->matchImportRows($residents, $existingMatches);
                $potentialMatches = $matchRows;
            }

            $currentSnapshot = $this->savedMatchSnapshot($matchRows);
            if (($potentialMatches !== [] && !$confirmed)
                || !$this->matchSnapshotsEqual($currentSnapshot, $reviewedMatches)) {
                return [
                    'inserted' => [],
                    'existing' => [],
                    'skipped' => 0,
                    'reviewRequired' => true,
                    'potentialMatches' => $potentialMatches,
                    'reviewedMatches' => $currentSnapshot,
                ];
            }

            $inserted = [];
            $existing = [];
            foreach ($residents as $resident) {
                $row = [
                    'id' => $resident['id'],
                    'first_name' => $resident['firstName'],
                    'last_name' => $resident['lastName'],
                    'birth_date' => $resident['birthDate'],
                    'sex' => $resident['sex'],
                    'marital_status' => $resident['maritalStatus'],
                    'occupation' => $resident['occupation'],
                    'household_id' => $resident['householdId'],
                    'purok' => $resident['purok'],
                    'zone' => $resident['zone'],
                    'address' => $resident['address'],
                    'record_status' => 'active',
                    'verification_status' => 'pending',
                    'source_reference' => $resident['sourceReference'] ?? null,
                    'source_filename' => $resident['sourceFilename'] ?? null,
                    'source_fingerprint' => $resident['sourceFingerprint'],
                    'created_by' => $resident['createdBy'],
                    'verified_by' => null,
                    'verified_at' => null,
                    'created_at' => $resident['createdAt'],
                    'updated_at' => $resident['updatedAt'] ?? $resident['createdAt'],
                ];
                $didInsert = DB::table('resident_registry')->insertOrIgnore($row) > 0;
                if ($didInsert) {
                    $inserted[] = $resident;
                } else {
                    $existingRecord = DB::table('resident_registry')
                        ->where('source_fingerprint', $resident['sourceFingerprint'])
                        ->first(['id', 'source_fingerprint']);
                    if ($existingRecord) {
                        $existing[] = ['id' => $existingRecord->id, 'sourceFingerprint' => trim($existingRecord->source_fingerprint)];
                    }
                }
            }

            if ($inserted !== []) {
                $audit['metadata'] = json_encode(
                    array_merge(json_decode($audit['metadata'], true, 512, JSON_THROW_ON_ERROR), ['count' => count($inserted)]),
                    JSON_THROW_ON_ERROR
                );
                DB::table('audit_logs')->insert($audit);
            }

            return [
                'inserted' => $inserted,
                'existing' => $existing,
                'skipped' => count($residents) - count($inserted),
                'reviewRequired' => false,
                'potentialMatches' => $potentialMatches,
                'reviewedMatches' => $currentSnapshot,
            ];
        });
    }

    public function sourceReviews(): JsonResponse
    {
        try {
            $reviews = DB::table('registry_source_reviews')
                ->where('status', 'open')
                ->orderBy('created_at')
                ->get(['id', 'zone', 'purok', 'status', 'created_at'])
                ->map(fn ($review): array => [
                    'id' => (string) $review->id,
                    'zone' => $review->zone === null ? null : (int) $review->zone,
                    'purok' => $review->purok,
                    'status' => $review->status,
                    'createdAt' => $this->isoTimestamp($review->created_at),
                ])->all();

            return response()->json(['reviews' => $reviews]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to load source-review warnings.'], 500);
        }
    }

    public function openSourceReview(Request $request): JsonResponse
    {
        $body = $request->all();
        if (!is_string($body['purok'] ?? null)) {
            return $this->badRequest('Enter a purok name of up to 100 characters.');
        }
        $purok = $this->cleanText($body['purok']);
        $zoneText = !array_key_exists('zone', $body) || $body['zone'] === null ? '' : $this->jsString($body['zone']);
        $zone = $zoneText === '' ? null : $this->numberFromJs($zoneText);
        if ($purok === '' || mb_strlen($purok) > 100) {
            return $this->badRequest('Enter a purok name of up to 100 characters.');
        }
        if ($zone !== null && (!is_finite($zone) || floor($zone) !== $zone || $zone < 1 || $zone > 7)) {
            return $this->badRequest('Choose a valid zone from 1 to 7.');
        }
        $zone = $zone === null ? null : (int) $zone;
        $actor = $this->actor($request);

        try {
            $result = DB::transaction(function () use ($purok, $zone, $actor): array {
                $existingQuery = DB::table('registry_source_reviews')->where('status', 'open')
                    ->whereRaw('LOWER(purok) = ?', [mb_strtolower($purok, 'UTF-8')]);
                $zone === null
                    ? $existingQuery->whereNull('zone')
                    : $existingQuery->where('zone', $zone);
                $existing = $existingQuery->first();
                if ($existing) {
                    return ['review' => $existing, 'created' => false];
                }

                $createdAt = $this->timestamp();
                $review = [
                    'id' => (string) Str::uuid(),
                    'zone' => $zone,
                    'purok' => $purok,
                    'status' => 'open',
                    'created_by' => $actor->id,
                    'created_at' => $createdAt,
                    'resolved_by' => null,
                    'resolved_at' => null,
                ];
                DB::table('registry_source_reviews')->insert($review);
                DB::table('audit_logs')->insert($this->audit(
                    $actor,
                    'resident_registry.source_review_opened',
                    'resident_registry_source_review',
                    $review['id'],
                    ['zone' => $zone, 'purok' => $purok]
                ));

                return ['review' => (object) $review, 'created' => true];
            });

            $review = $result['review'];

            return response()->json([
                'review' => [
                    'id' => (string) $review->id,
                    'zone' => $review->zone === null ? null : (int) $review->zone,
                    'purok' => $review->purok,
                    'status' => $review->status,
                    'createdAt' => $this->isoTimestamp($review->created_at),
                ],
                'created' => $result['created'],
            ], $result['created'] ? 201 : 200);
        } catch (Throwable $error) {
            try {
                $duplicateQuery = DB::table('registry_source_reviews')->where('status', 'open')
                    ->whereRaw('LOWER(purok) = ?', [mb_strtolower($purok, 'UTF-8')]);
                $zone === null ? $duplicateQuery->whereNull('zone') : $duplicateQuery->where('zone', $zone);
                $duplicate = $duplicateQuery->first();
                if ($duplicate) {
                    return response()->json([
                        'review' => [
                            'id' => (string) $duplicate->id,
                            'zone' => $duplicate->zone === null ? null : (int) $duplicate->zone,
                            'purok' => $duplicate->purok,
                            'status' => $duplicate->status,
                            'createdAt' => $this->isoTimestamp($duplicate->created_at),
                        ],
                        'created' => false,
                    ]);
                }
            } catch (Throwable) {
                // Report the original storage failure below.
            }
            report($error);

            return response()->json(['message' => 'Unable to create the source-review warning.'], 500);
        }
    }

    public function resolveSourceReview(Request $request, string $id): JsonResponse
    {
        if (!$this->isUuid($id)) {
            return $this->badRequest('Choose a valid source-review warning.');
        }

        try {
            $review = DB::transaction(function () use ($request, $id): ?object {
                $current = DB::table('registry_source_reviews')->where('id', $id)->where('status', 'open')->lockForUpdate()->first();
                if (!$current) {
                    return null;
                }
                $resolvedAt = $this->timestamp();
                DB::table('registry_source_reviews')->where('id', $id)->update([
                    'status' => 'resolved',
                    'resolved_by' => $this->actor($request)->id,
                    'resolved_at' => $resolvedAt,
                ]);
                DB::table('audit_logs')->insert($this->audit(
                    $this->actor($request),
                    'resident_registry.source_review_resolved',
                    'resident_registry_source_review',
                    $id
                ));

                return (object) ['id' => $id, 'status' => 'resolved', 'resolvedAt' => $resolvedAt];
            });

            if (!$review) {
                return response()->json(['message' => 'Open source-review warning not found.'], 404);
            }

            return response()->json(['review' => [
                'id' => $review->id,
                'status' => $review->status,
                'resolvedAt' => $this->isoTimestamp($review->resolvedAt),
            ]]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to resolve the source-review warning.'], 500);
        }
    }

    public function index(Request $request): JsonResponse
    {
        $search = trim((string) $request->query('search', ''));
        $birthDate = trim((string) $request->query('birthDate', ''));
        $ageRaw = $request->query('age');
        $zoneRaw = $request->query('zone');
        $purok = trim((string) $request->query('purok', ''));
        $verificationStatus = trim((string) $request->query('verificationStatus', ''));
        $excludeVerificationStatus = trim((string) $request->query('excludeVerificationStatus', ''));
        $age = $ageRaw === null || $ageRaw === '' ? null : $this->numberFromJs($ageRaw);
        $zone = $zoneRaw === null || $zoneRaw === '' ? null : $this->numberFromJs($zoneRaw);
        $page = max(1, (int) $request->query('page', 1));
        $pageSizeValue = (int) $request->query('pageSize', 25);
        $pageSize = min(100, max(1, $pageSizeValue ?: 25));
        $today = $this->today();

        if (mb_strlen($search) > 120 || mb_strlen($purok) > 100) {
            return $this->badRequest('Search filters are too long.');
        }
        if ($birthDate !== '' && (!$this->validDateKey($birthDate) || $birthDate > $today)) {
            return $this->badRequest('Enter a valid birthdate that is not in the future.');
        }
        if ($age !== null && (!is_finite($age) || floor($age) !== $age || $age < 0 || $age > 130)) {
            return $this->badRequest('Age must be a whole number from 0 to 130.');
        }
        if ($zone !== null && (!is_finite($zone) || floor($zone) !== $zone || $zone < 1 || $zone > 7)) {
            return $this->badRequest('Choose a valid zone from 1 to 7.');
        }
        if ($verificationStatus !== '' && !in_array($verificationStatus, self::VERIFICATION_STATUSES, true)) {
            return $this->badRequest('Choose a valid resident verification status.');
        }
        if ($excludeVerificationStatus !== '' && !in_array($excludeVerificationStatus, self::VERIFICATION_STATUSES, true)) {
            return $this->badRequest('Choose a valid resident verification status to exclude.');
        }
        if ($verificationStatus !== '' && $verificationStatus === $excludeVerificationStatus) {
            return $this->badRequest('A verification status cannot be both included and excluded.');
        }
        $ageStart = $ageEnd = null;
        if ($age !== null) {
            $ageEnd = CarbonImmutable::createFromFormat('!Y-m-d', $today, 'UTC')->subYearsNoOverflow((int) $age)->format('Y-m-d');
            $ageStart = CarbonImmutable::createFromFormat('!Y-m-d', $today, 'UTC')->subYearsNoOverflow((int) $age + 1)->addDay()->format('Y-m-d');
        }

        try {
            $query = DB::table('resident_registry');
            if ($search !== '') {
                $searchLower = mb_strtolower($search, 'UTF-8');
                $escape = static fn (string $value): string => str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value);
                $query->where(function ($matches) use ($searchLower, $escape): void {
                    $matches->whereRaw("LOWER(first_name || ' ' || last_name) LIKE ? ESCAPE '!'", [$escape($searchLower).'%']);
                    $matches->orWhere(function ($terms) use ($searchLower, $escape): void {
                        foreach (array_filter(preg_split('/\s+/', $searchLower) ?: []) as $term) {
                            $terms->where(function ($parts) use ($term, $escape): void {
                                $parts->whereRaw("LOWER(first_name) LIKE ? ESCAPE '!'", [$escape($term).'%'])
                                    ->orWhereRaw("LOWER(last_name) LIKE ? ESCAPE '!'", [$escape($term).'%']);
                            });
                        }
                    });
                });
            }
            if ($birthDate !== '') {
                $query->where('birth_date', $birthDate);
            }
            if ($ageStart !== null) {
                $query->whereBetween('birth_date', [$ageStart, $ageEnd]);
            }
            if ($zone !== null) {
                $query->where('zone', (int) $zone);
            }
            if ($purok !== '') {
                $query->where('purok', $purok);
            }
            if ($verificationStatus !== '') {
                $query->where('verification_status', $verificationStatus);
            }
            if ($excludeVerificationStatus !== '') {
                $query->where('verification_status', '<>', $excludeVerificationStatus);
            }

            $total = (clone $query)->count();
            $records = $query
                ->orderByRaw('zone IS NULL')
                ->orderByRaw('purok IS NULL')
                ->orderBy('last_name')
                ->orderBy('first_name')
                ->orderBy('id')
                ->forPage($page, $pageSize)
                ->get();
            $residents = $records->map(function ($record) use ($today): array {
                $resident = $this->normalizeResident($record);
                $birthDate = $resident['birthDate'];
                $age = $birthDate === null ? null : ((int) substr($today, 0, 4) - (int) substr($birthDate, 0, 4)
                    - (substr($birthDate, 5) > substr($today, 5) ? 1 : 0));

                return [
                    'id' => $resident['id'],
                    'firstName' => $resident['firstName'],
                    'lastName' => $resident['lastName'],
                    'birthDate' => $birthDate,
                    'age' => $age,
                    'sex' => $resident['sex'],
                    'maritalStatus' => $resident['maritalStatus'],
                    'occupation' => $resident['occupation'],
                    'householdId' => $resident['householdId'],
                    'purok' => $resident['purok'],
                    'zone' => $resident['zone'],
                    'status' => $resident['status'],
                    'verificationStatus' => $resident['verificationStatus'],
                ];
            })->all();

            return response()->json([
                'residents' => $residents,
                'total' => $total,
                'page' => $page,
                'pageSize' => $pageSize,
                'filters' => ['search' => $search, 'birthDate' => $birthDate, 'age' => $age, 'zone' => $zone, 'purok' => $purok],
            ]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to load the resident registry.'], 500);
        }
    }

    public function zones(): JsonResponse
    {
        try {
            $counts = DB::table('resident_registry')->where('verification_status', '<>', 'needs_review')
                ->whereBetween('zone', [1, 7])->select('zone', DB::raw('COUNT(*) AS total'))->groupBy('zone')->pluck('total', 'zone');

            $zones = [];
            for ($zone = 1; $zone <= 7; $zone++) {
                $zones[] = ['zone' => $zone, 'total' => (int) ($counts[$zone] ?? 0)];
            }

            return response()->json(['zones' => $zones]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to load resident zone totals.'], 500);
        }
    }

    public function show(string $id): JsonResponse
    {
        if (!$this->isUuid($id)) {
            return $this->badRequest('Choose a valid resident record.');
        }

        try {
            $resident = DB::table('resident_registry')->where('id', $id)->first();
            if (!$resident) {
                return response()->json(['message' => 'Resident record not found.'], 404);
            }

            $resident = $this->normalizeResident($resident);
            unset($resident['purok']);

            return response()->json(['resident' => $resident]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to load resident information.'], 500);
        }
    }

    public function demographics(Request $request): JsonResponse
    {
        $zoneRaw = $request->query('zone');
        $zone = $zoneRaw === null || $zoneRaw === '' ? null : $this->numberFromJs($zoneRaw);
        $purok = trim((string) $request->query('purok', ''));
        if ($zone !== null && (!is_finite($zone) || floor($zone) !== $zone || $zone < 1 || $zone > 7)) {
            return $this->badRequest('Choose a valid zone from 1 to 7.');
        }
        if (mb_strlen($purok) > 100) {
            return $this->badRequest('Purok filter is too long.');
        }

        try {
            $query = DB::table('resident_registry')->where('record_status', 'active')->where('verification_status', 'verified');
            if ($zone !== null) {
                $query->where('zone', (int) $zone);
            }
            if ($purok !== '') {
                $query->where('purok', $purok);
            }
            $records = $query->get(['zone', 'purok', 'household_id', 'sex']);
            $countRecords = static function ($items): array {
                $households = [];
                foreach ($items as $item) {
                    if (trim((string) $item->household_id) !== '') {
                        $households[(string) ($item->zone ?? '')."\0".(string) ($item->purok ?? '')."\0".trim($item->household_id)] = true;
                    }
                }

                return [
                    'total' => $items->count(),
                    'male' => $items->filter(static fn ($item): bool => mb_strtolower((string) $item->sex, 'UTF-8') === 'male')->count(),
                    'female' => $items->filter(static fn ($item): bool => mb_strtolower((string) $item->sex, 'UTF-8') === 'female')->count(),
                    'unclassified' => $items->filter(static fn ($item): bool => !in_array(mb_strtolower((string) $item->sex, 'UTF-8'), ['male', 'female'], true))->count(),
                    'households' => count($households),
                ];
            };

            $overall = $countRecords($records);
            $byPurok = [];
            $byHousehold = [];
            foreach ($records->groupBy(fn ($item): string => (string) ($item->zone ?? '')."\0".(string) ($item->purok ?? '')) as $groupKey => $items) {
                [$zoneValue, $purokValue] = explode("\0", $groupKey, 2);
                $groupZone = $zoneValue === '' ? null : (int) $zoneValue;
                $groupPurok = $purokValue === '' ? null : $purokValue;
                $counts = $countRecords($items);
                $byPurok[] = [
                    'zone' => $groupZone,
                    'purok' => $groupPurok,
                    'label' => $groupPurok ? $groupPurok.($groupZone ? ' · Zone '.$groupZone : '') : ($groupZone ? 'Zone '.$groupZone : 'Unassigned / needs verification'),
                ] + $counts;

                foreach ($items->filter(static fn ($item): bool => trim((string) $item->household_id) !== '')
                    ->groupBy(static fn ($item): string => (string) $item->household_id) as $householdId => $householdItems) {
                    $householdCounts = $countRecords($householdItems);
                    unset($householdCounts['households']);
                    $byHousehold[] = [
                        'zone' => $groupZone,
                        'purok' => $groupPurok,
                        'householdId' => $householdId,
                    ] + $householdCounts;
                }
            }
            usort($byPurok, static fn (array $left, array $right): int => ($left['zone'] ?? 99) <=> ($right['zone'] ?? 99) ?: strcmp((string) $left['purok'], (string) $right['purok']));
            usort($byHousehold, static fn (array $left, array $right): int => ($left['zone'] ?? 99) <=> ($right['zone'] ?? 99) ?: strcmp((string) $left['purok'], (string) $right['purok']) ?: strcmp($left['householdId'], $right['householdId']));

            return response()->json([
                'eligibility' => 'Active records with verified household/resident status; unclassified sex is reported separately.',
                'overall' => $overall,
                'byPurok' => $byPurok,
                'byHousehold' => $byHousehold,
                'filters' => ['zone' => $zone ? (int) $zone : null, 'purok' => $purok],
            ]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to load demographic totals.'], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        $body = $request->all();
        $firstName = $this->cleanText($body['firstName'] ?? '');
        $lastName = $this->cleanText($body['lastName'] ?? '');
        $birthDate = $body['birthDate'] ?? null;
        $sex = $body['sex'] ?? null;
        if (!$sex) {
            $sex = null;
        }
        $maritalStatus = $this->cleanText($body['maritalStatus'] ?? '');
        $occupation = $this->cleanText($body['occupation'] ?? '');
        $householdId = $this->cleanText($body['householdId'] ?? '');
        $purok = $this->cleanText($body['purok'] ?? '');
        $address = $this->cleanText($body['address'] ?? '');
        $sourceReference = $this->cleanText($body['sourceReference'] ?? '');
        $sourceFilename = $this->cleanText($body['sourceFilename'] ?? '');
        $zoneText = !array_key_exists('zone', $body) || $body['zone'] === null ? '' : $this->jsString($body['zone']);
        $zone = $zoneText === '' ? null : $this->numberFromJs($zoneText);
        $today = $this->today();

        if ($firstName === '' || $lastName === '' || mb_strlen($firstName) > 100 || mb_strlen($lastName) > 100) {
            return $this->badRequest('Enter the resident’s first and last names (up to 100 characters each).');
        }
        if ($birthDate && (!is_string($birthDate) || !$this->validDateKey($birthDate) || $birthDate > $today)) {
            return $this->badRequest('Enter a valid birthdate that is not in the future.');
        }
        if ($sex !== null && !in_array($sex, ['Male', 'Female'], true)) {
            return $this->badRequest('Choose Male or Female, or leave sex blank.');
        }
        if ($maritalStatus !== '' && !in_array($maritalStatus, self::MARITAL_STATUSES, true)) {
            return $this->badRequest('Choose a valid marital status or leave it blank.');
        }
        if (mb_strlen($occupation) > 120) {
            return $this->badRequest('Occupation must be 120 characters or fewer.');
        }
        if ($zone !== null && (!is_finite($zone) || floor($zone) !== $zone || $zone < 1 || $zone > 7)) {
            return $this->badRequest('Choose a valid zone from 1 to 7.');
        }
        if (mb_strlen($householdId) > 100 || mb_strlen($purok) > 100 || mb_strlen($address) > 255
            || mb_strlen($sourceReference) > 255 || mb_strlen($sourceFilename) > 255) {
            return $this->badRequest('One or more resident fields exceed the allowed length.');
        }
        if (array_key_exists('confirmPotentialMatch', $body) && !is_bool($body['confirmPotentialMatch'])) {
            return $this->badRequest('Duplicate confirmation must be true or false.');
        }
        if (array_key_exists('reviewedMatches', $body) && !is_array($body['reviewedMatches'])) {
            return $this->badRequest('Reviewed duplicate matches must be a list.');
        }

        $resident = [
            'id' => (string) Str::uuid(),
            'firstName' => $firstName,
            'lastName' => $lastName,
            'birthDate' => $birthDate ?: null,
            'sex' => $sex,
            'maritalStatus' => $maritalStatus ?: null,
            'occupation' => $occupation ?: null,
            'householdId' => $householdId ?: null,
            'purok' => $purok ?: null,
            'zone' => $zone === null ? null : (int) $zone,
            'address' => $address ?: null,
            'sourceReference' => $sourceReference ?: null,
            'sourceFilename' => $sourceFilename ?: null,
            'createdBy' => $this->actor($request)->id,
            'createdAt' => $this->timestamp(),
            'updatedAt' => $this->timestamp(),
        ];
        $resident['sourceFingerprint'] = $this->fingerprint($resident);
        try {
            $potentialMatches = $this->residentMatchRecords($resident);
            $reviewedMatches = $this->savedMatchSnapshot($potentialMatches === [] ? [] : [['row' => 1, 'records' => $potentialMatches]]);
            $confirm = ($body['confirmPotentialMatch'] ?? false) === true;
            if ($potentialMatches !== [] && (!$confirm || !$this->matchSnapshotsEqual($reviewedMatches, $body['reviewedMatches'] ?? []))) {
                return response()->json([
                    'message' => 'Review the possible matching records before confirming this registration.',
                    'potentialMatches' => $potentialMatches,
                    'reviewedMatches' => $reviewedMatches,
                    'reviewRequired' => true,
                ], 409);
            }

            $outcome = $this->insertResidents(
                [$resident],
                $this->audit($this->actor($request), 'resident_registry.created', 'resident_registry', $resident['id'], [
                    'verificationStatus' => 'pending',
                    'hasSourceReference' => $sourceReference !== '',
                ]),
                $confirm,
                $reviewedMatches,
                1
            );
            if ($outcome['reviewRequired']) {
                return response()->json([
                    'message' => 'The matching records changed. Review them before confirming this registration.',
                    'potentialMatches' => $outcome['potentialMatches'],
                    'reviewedMatches' => $outcome['reviewedMatches'],
                    'reviewRequired' => true,
                ], 409);
            }
            $recordId = $outcome['inserted'][0]['id'] ?? $outcome['existing'][0]['id'] ?? $resident['id'];

            return response()->json([
                'resident' => ['id' => $recordId, 'verificationStatus' => 'pending'],
                'created' => count($outcome['inserted']) > 0,
                'potentialMatches' => $potentialMatches,
                'reviewRequired' => true,
            ], count($outcome['inserted']) > 0 ? 201 : 200);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to save the resident record.'], 500);
        }
    }

    public function import(Request $request): JsonResponse
    {
        $decodedBody = json_decode($request->getContent());
        $body = is_object($decodedBody) ? (array) $decodedBody : $request->all();
        $residents = $body['residents'] ?? null;
        $filename = $body['filename'] ?? null;
        $confirm = $body['confirmPotentialMatches'] ?? false;
        $reviewedMatches = $body['reviewedMatches'] ?? [];
        if (is_array($reviewedMatches)) {
            $reviewedMatches = array_map(
                static fn (mixed $match): mixed => $match instanceof \stdClass ? (array) $match : $match,
                $reviewedMatches
            );
        }
        if (!is_array($residents) || !array_is_list($residents) || count($residents) < 1 || count($residents) > 500) {
            return $this->badRequest('Upload between 1 and 500 resident records.');
        }
        if (!is_string($filename) || trim($filename) === '' || mb_strlen(trim($filename)) > 255) {
            return $this->badRequest('A source filename of up to 255 characters is required.');
        }
        if (array_key_exists('familyBatch', $body) && !is_bool($body['familyBatch'])) {
            return $this->badRequest('Family batch mode must be true or false.');
        }
        if (array_key_exists('confirmPotentialMatches', $body) && !is_bool($confirm)) {
            return $this->badRequest('Duplicate confirmation must be true or false.');
        }
        if (array_key_exists('reviewedMatches', $body) && (!is_array($reviewedMatches) || !array_is_list($reviewedMatches))) {
            return $this->badRequest('Reviewed duplicate matches must be a list.');
        }

        $validationErrors = [];
        $normalized = [];
        foreach ($residents as $index => $record) {
            $row = $index + 2;
            if ($record instanceof \stdClass) {
                $record = (array) $record;
            } elseif (!is_array($record) || array_is_list($record)) {
                $validationErrors[] = ['row' => $row, 'field' => 'record', 'message' => 'Expected a resident record.'];
                continue;
            }
            $values = [];
            foreach (['firstName', 'lastName', 'birthDate', 'sex', 'maritalStatus', 'occupation', 'householdId', 'purok', 'address', 'sourceReference', 'zone'] as $key) {
                $value = $record[$key] ?? '';
                if ($value !== '' && $value !== null && !is_string($value)) {
                    $validationErrors[] = ['row' => $row, 'field' => $key, 'message' => 'Must be text.'];
                    $value = '';
                }
                $values[$key] = $this->cleanText($value);
            }
            $zone = $values['zone'] === '' ? null : $this->numberFromJs($values['zone']);
            if ($values['firstName'] === '' || $values['lastName'] === '' || mb_strlen($values['firstName']) > 100 || mb_strlen($values['lastName']) > 100) {
                $validationErrors[] = ['row' => $row, 'field' => 'name', 'message' => 'First and last names are required and must not exceed 100 characters.'];
            }
            if ($values['birthDate'] !== '' && (!$this->validDateKey($values['birthDate']) || $values['birthDate'] > $this->today())) {
                $validationErrors[] = ['row' => $row, 'field' => 'birthDate', 'message' => 'Birthdate must be a valid date no later than today.'];
            }
            if ($values['sex'] !== '' && !in_array($values['sex'], ['Male', 'Female'], true)) {
                $validationErrors[] = ['row' => $row, 'field' => 'sex', 'message' => 'Use Male or Female, or leave blank.'];
            }
            if ($values['maritalStatus'] !== '' && !in_array($values['maritalStatus'], self::MARITAL_STATUSES, true)) {
                $validationErrors[] = ['row' => $row, 'field' => 'maritalStatus', 'message' => 'Choose a valid marital status or leave it blank.'];
            }
            if (mb_strlen($values['occupation']) > 120) {
                $validationErrors[] = ['row' => $row, 'field' => 'occupation', 'message' => 'Occupation must be 120 characters or fewer.'];
            }
            if ($values['zone'] !== '' && (!is_finite($zone) || floor($zone) !== $zone || $zone < 1 || $zone > 7)) {
                $validationErrors[] = ['row' => $row, 'field' => 'zone', 'message' => 'Zone must be a whole number from 1 to 7.'];
            }
            if (mb_strlen($values['householdId']) > 100 || mb_strlen($values['purok']) > 100
                || mb_strlen($values['address']) > 255 || mb_strlen($values['sourceReference']) > 255) {
                $validationErrors[] = ['row' => $row, 'field' => 'length', 'message' => 'A field exceeds its maximum length.'];
            }
            $normalized[] = [
                'firstName' => $values['firstName'],
                'lastName' => $values['lastName'],
                'birthDate' => $values['birthDate'] ?: null,
                'sex' => $values['sex'] ?: null,
                'maritalStatus' => $values['maritalStatus'] ?: null,
                'occupation' => $values['occupation'] ?: null,
                'householdId' => $values['householdId'] ?: null,
                'purok' => $values['purok'] ?: null,
                'zone' => $zone === null ? null : (is_finite($zone) ? (int) $zone : null),
                'address' => $values['address'] ?: null,
                'sourceReference' => $values['sourceReference'] ?: null,
            ];
        }
        if ($validationErrors !== []) {
            return $this->badRequest('Correct the invalid rows before importing.', ['validationErrors' => $validationErrors]);
        }

        try {
            $existingMatches = [];
            foreach ($normalized as $resident) {
                $existingMatches[] = $this->residentMatchRecords($resident);
            }
            $potentialMatches = $this->matchImportRows($normalized, $existingMatches);
            $snapshot = $this->savedMatchSnapshot($potentialMatches);
            if ($potentialMatches !== [] && ($confirm !== true || !$this->matchSnapshotsEqual($snapshot, $reviewedMatches))) {
                return response()->json([
                    'message' => 'Review every possible duplicate before confirming the import.',
                    'potentialMatches' => $potentialMatches,
                    'reviewedMatches' => $snapshot,
                    'reviewRequired' => true,
                ], 409);
            }

            $createdAt = $this->timestamp();
            $familyBatch = ($body['familyBatch'] ?? false) === true;
            $records = array_map(function (array $resident) use ($request, $filename, $familyBatch, $createdAt): array {
                $record = $resident + [
                    'id' => (string) Str::uuid(),
                    'sourceFilename' => $familyBatch ? null : trim($filename),
                    'createdBy' => $this->actor($request)->id,
                    'createdAt' => $createdAt,
                    'updatedAt' => $createdAt,
                ];
                $record['sourceFingerprint'] = $this->fingerprint($record);

                return $record;
            }, $normalized);
            $audit = $this->audit(
                $this->actor($request),
                $familyBatch ? 'resident_registry.family_added' : 'resident_registry.bulk_imported',
                'resident_registry_batch',
                null,
                [
                    'count' => count($records),
                    'hasFilename' => !$familyBatch && trim($filename) !== '',
                    'potentialMatchCount' => count($potentialMatches),
                ]
            );
            $outcome = $this->insertResidents($records, $audit, $confirm === true, $snapshot);
            if ($outcome['reviewRequired']) {
                return response()->json([
                    'message' => 'The matching records changed. Review them before confirming the import.',
                    'potentialMatches' => $outcome['potentialMatches'],
                    'reviewedMatches' => $outcome['reviewedMatches'],
                    'reviewRequired' => true,
                ], 409);
            }

            return response()->json([
                'imported' => count($outcome['inserted']),
                'skipped' => $outcome['skipped'],
                'verificationStatus' => 'pending',
                'potentialMatches' => $potentialMatches,
            ], 201);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to import resident records.'], 500);
        }
    }

    public function update(Request $request, string $id): JsonResponse
    {
        if (!$this->isUuid($id)) {
            return $this->badRequest('Choose a valid resident record.');
        }
        $body = $request->all();
        $allowed = ['firstName', 'lastName', 'birthDate', 'sex', 'maritalStatus', 'occupation', 'householdId', 'zone', 'address'];
        if (!is_array($body) || array_diff(array_keys($body), $allowed) !== []) {
            return $this->badRequest('The resident information contains unsupported fields.');
        }
        $updates = [];
        foreach (['firstName' => 'first_name', 'lastName' => 'last_name'] as $key => $column) {
            if (!array_key_exists($key, $body)) {
                continue;
            }
            if (!is_string($body[$key]) || $this->cleanText($body[$key]) === '' || mb_strlen($this->cleanText($body[$key])) > 100) {
                return $this->badRequest('First and last names are required and must be 100 characters or fewer.');
            }
            $updates[$column] = $this->cleanText($body[$key]);
        }
        if (array_key_exists('birthDate', $body)) {
            $value = $body['birthDate'];
            if ($value !== null && (!is_string($value) || !$this->validDateKey($value) || $value > $this->today())) {
                return $this->badRequest('Enter a valid birthdate that is not in the future.');
            }
            $updates['birth_date'] = $value;
        }
        if (array_key_exists('sex', $body)) {
            $value = $body['sex'] ?: null;
            if ($value !== null && !in_array($value, ['Male', 'Female'], true)) {
                return $this->badRequest('Choose Male or Female, or leave sex blank.');
            }
            $updates['sex'] = $value;
        }
        if (array_key_exists('maritalStatus', $body)) {
            $value = $this->cleanText($body['maritalStatus'] ?? '');
            if ($value !== '' && !in_array($value, self::MARITAL_STATUSES, true)) {
                return $this->badRequest('Choose a valid marital status or leave it blank.');
            }
            $updates['marital_status'] = $value ?: null;
        }
        if (array_key_exists('occupation', $body)) {
            if (!is_string($body['occupation']) || mb_strlen($this->cleanText($body['occupation'])) > 120) {
                return $this->badRequest('Occupation must be text up to 120 characters.');
            }
            $updates['occupation'] = $this->cleanText($body['occupation']) ?: null;
        }
        foreach (['householdId' => ['household_id', 100], 'address' => ['address', 255]] as $key => [$column, $limit]) {
            if (!array_key_exists($key, $body)) {
                continue;
            }
            if ($body[$key] !== null && !is_string($body[$key])) {
                return $this->badRequest('Household and address fields must be text.');
            }
            $value = $this->cleanText($body[$key] ?? '');
            if (mb_strlen($value) > $limit) {
                return $this->badRequest('A resident field exceeds its maximum length.');
            }
            $updates[$column] = $value ?: null;
        }
        if (array_key_exists('zone', $body)) {
            $value = $body['zone'] === '' || $body['zone'] === null ? null : $this->numberFromJs($body['zone']);
            if ($value !== null && (!is_finite($value) || floor($value) !== $value || $value < 1 || $value > 7)) {
                return $this->badRequest('Choose a valid zone from 1 to 7.');
            }
            $updates['zone'] = $value === null ? null : (int) $value;
        }
        if ($updates === []) {
            return $this->badRequest('Provide at least one resident field to update.');
        }

        try {
            $resident = DB::transaction(function () use ($request, $id, $updates): ?object {
                $exists = DB::table('resident_registry')->where('id', $id)->exists();
                if (!$exists) {
                    return null;
                }
                DB::table('resident_registry')->where('id', $id)->update($updates + ['updated_at' => now('UTC')]);
                DB::table('audit_logs')->insert($this->audit(
                    $this->actor($request),
                    'resident_registry.details_updated',
                    'resident_registry',
                    $id,
                    ['fields' => array_map(static fn (string $field): string => array_search($field, [
                        'first_name' => 'firstName', 'last_name' => 'lastName', 'birth_date' => 'birthDate',
                        'sex' => 'sex', 'marital_status' => 'maritalStatus', 'occupation' => 'occupation',
                        'household_id' => 'householdId', 'zone' => 'zone', 'address' => 'address',
                    ], true), array_keys($updates))]
                ));

                return DB::table('resident_registry')->where('id', $id)->first();
            });
            if (!$resident) {
                return response()->json(['message' => 'Resident record not found.'], 404);
            }
            $output = $this->normalizeResident($resident);
            unset($output['purok'], $output['status'], $output['verificationStatus']);

            return response()->json(['resident' => $output]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to update resident information.'], 500);
        }
    }

    public function verify(Request $request, string $id): JsonResponse
    {
        $verificationStatus = $request->input('verificationStatus');
        if (!in_array($verificationStatus, self::VERIFICATION_STATUSES, true)) {
            return $this->badRequest('Choose pending, verified, or needs_review.');
        }

        try {
            $verifiedAt = $verificationStatus === 'verified' ? $this->timestamp() : null;
            $resident = DB::transaction(function () use ($request, $id, $verificationStatus, $verifiedAt): ?object {
                $current = DB::table('resident_registry')->where('id', $id)->first(['id']);
                if (!$current) {
                    return null;
                }
                DB::table('resident_registry')->where('id', $id)->update([
                    'verification_status' => $verificationStatus,
                    'verified_by' => $verificationStatus === 'verified' ? $this->actor($request)->id : null,
                    'verified_at' => $verifiedAt,
                    'updated_at' => now('UTC'),
                ]);
                DB::table('audit_logs')->insert($this->audit(
                    $this->actor($request),
                    'resident_registry.'.$verificationStatus,
                    'resident_registry',
                    $id
                ));

                return (object) ['id' => $id];
            });
            if (!$resident) {
                return response()->json(['message' => 'Resident record not found.'], 404);
            }

            return response()->json(['resident' => [
                'id' => $id,
                'verificationStatus' => $verificationStatus,
                'verifiedBy' => $verificationStatus === 'verified' ? $this->actor($request)->id : null,
                'verifiedAt' => $verifiedAt,
            ]]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to update resident verification.'], 500);
        }
    }

    public function updateStatus(Request $request, string $id): JsonResponse
    {
        $status = $request->input('status');
        if (!in_array($status, self::RECORD_STATUSES, true)) {
            return $this->badRequest('Choose active, inactive, deceased, or archived.');
        }

        try {
            $updated = DB::transaction(function () use ($request, $id, $status): bool {
                $exists = DB::table('resident_registry')->where('id', $id)->exists();
                if (!$exists) {
                    return false;
                }
                DB::table('resident_registry')->where('id', $id)->update([
                    'record_status' => $status,
                    'updated_at' => now('UTC'),
                ]);
                DB::table('audit_logs')->insert($this->audit(
                    $this->actor($request),
                    'resident_registry.status_changed',
                    'resident_registry',
                    $id,
                    ['status' => $status]
                ));

                return true;
            });
            if (!$updated) {
                return response()->json(['message' => 'Resident record not found.'], 404);
            }

            return response()->json(['resident' => ['id' => $id, 'status' => $status]]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to update resident record status.'], 500);
        }
    }

    public function archiveResidentAccount(Request $request, string $id): JsonResponse
    {
        try {
            $result = DB::transaction(function () use ($request, $id): array {
                $resident = DB::table('users')->where('id', $id)->lockForUpdate()->first();
                if (!$resident) {
                    return ['status' => 'not_found'];
                }
                if ($resident->role !== 'resident') {
                    return ['status' => 'role_conflict'];
                }
                if ($resident->status === 'Disabled') {
                    return ['status' => 'already_archived', 'user' => $resident];
                }
                DB::table('users')->where('id', $id)->update(['status' => 'Disabled']);
                DB::table('audit_logs')->insert($this->audit(
                    $this->actor($request),
                    'resident.archived',
                    'user',
                    $id,
                    ['previousStatus' => $resident->status ?: null]
                ));
                $resident->status = 'Disabled';

                return ['status' => 'archived', 'user' => $resident];
            });

            if ($result['status'] === 'not_found') {
                return response()->json(['message' => 'Resident not found.'], 404);
            }
            if ($result['status'] === 'role_conflict') {
                return response()->json(['message' => 'Only resident accounts can be archived here.'], 400);
            }

            return response()->json([
                'success' => true,
                ...($result['status'] === 'already_archived' ? ['alreadyArchived' => true] : []),
                'user' => ApiIdentity::safeUser($result['user']),
            ]);
        } catch (Throwable $error) {
            report($error);

            return response()->json(['message' => 'Unable to archive resident account.'], 500);
        }
    }
}
