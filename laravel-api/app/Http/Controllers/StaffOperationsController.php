<?php

namespace App\Http\Controllers;

use App\Support\ApiIdentity;
use App\Services\MetaIntegration;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class StaffOperationsController extends Controller
{
    private const PASSWORD_REQUIREMENTS = 'at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character';
    private const REPORT_STATUSES = ['Pending', 'In Review', 'Needs Information', 'Approved', 'Rejected'];

    public function createInvitation(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        if (!in_array($actor->role, ['admin', 'staff'], true)) {
            return response()->json([
                'message' => 'Only Admin and Staff accounts can create permitted accounts.',
            ], 403);
        }
        $role = strtolower(trim((string) $request->input('role', 'staff')));
        if (
            !in_array($role, ['admin', 'staff'], true)
            || ($role === 'admin' && $actor->role !== 'admin')
        ) {
            return response()->json([
                'message' => 'Staff can create Staff accounts only. Only an Admin can create Admin accounts.',
            ], 403);
        }

        return response()->json([
            'message' => 'Portal invitations are no longer issued. Create the account directly from the portal.',
        ], 410);
    }

    public function validateInvitation(Request $request): JsonResponse
    {
        $token = (string) $request->input('token', '');
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) {
            return $this->invalidInvitation();
        }

        try {
            $invitation = DB::table('staff_invitations')
                ->where('token_hash', hash('sha256', $token))
                ->first();
            if (!$this->invitationIsValid($invitation)) {
                return $this->invalidInvitation();
            }

            return response()->json([
                'email' => $invitation->email,
                'role' => $invitation->role === 'admin' ? 'admin' : 'staff',
                'expiresAt' => $invitation->expires_at,
            ])->header('Cache-Control', 'no-store');
        } catch (Throwable $error) {
            Log::error('Staff invitation lookup failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to verify this staff invitation.'], 500)
                ->header('Cache-Control', 'no-store');
        }
    }

    public function acceptInvitation(Request $request): JsonResponse
    {
        $token = (string) $request->input('token', '');
        $firstName = $this->clean($request->input('firstName'));
        $lastName = $this->clean($request->input('lastName'));
        $mobile = $this->clean($request->input('mobile'));
        $password = $this->clean($request->input('password'));
        if (!preg_match('/^[A-Za-z0-9_-]{43}$/', $token)) {
            return $this->invalidInvitation();
        }
        if (
            !$firstName || mb_strlen($firstName) > 100
            || !$lastName || mb_strlen($lastName) > 100
            || !preg_match('/^09\d{9}$/', $mobile)
            || !$this->validPassword($password)
        ) {
            return response()->json([
                'message' => 'Please provide a first and last name, a valid mobile number, and a password with '.self::PASSWORD_REQUIREMENTS.'.',
            ], 400)->header('Cache-Control', 'no-store');
        }

        $tokenHash = hash('sha256', $token);
        $acceptedAt = now();
        try {
            $result = DB::transaction(function () use ($tokenHash, $firstName, $lastName, $mobile, $password, $acceptedAt) {
                $invitation = DB::table('staff_invitations')
                    ->where('token_hash', $tokenHash)
                    ->lockForUpdate()
                    ->first();
                if (!$this->invitationIsValid($invitation)) {
                    return ['status' => 'invalid_invitation'];
                }
                if (DB::table('users')
                    ->where(function ($query) use ($invitation, $mobile) {
                        $query->whereRaw('LOWER(email) = ?', [strtolower($invitation->email)])
                            ->orWhere('mobile', $mobile);
                    })
                    ->lockForUpdate()
                    ->exists()) {
                    return ['status' => 'account_exists'];
                }

                $role = $invitation->role === 'admin' ? 'admin' : 'staff';
                $userId = (string) Str::uuid();
                DB::table('users')->insert([
                    'id' => $userId,
                    'first_name' => $firstName,
                    'last_name' => $lastName,
                    'mobile' => $mobile,
                    'email' => strtolower($invitation->email),
                    'password_hash' => password_hash($password, PASSWORD_BCRYPT),
                    'role' => $role,
                    'household_id' => 'STAFF-'.substr(str_replace('-', '', (string) Str::uuid()), 0, 12),
                    'family_members' => 1,
                    'household_members' => json_encode([]),
                    'status' => $role === 'admin' ? 'Administrator' : 'On Duty',
                    'address' => 'Barangay Hall, Legaspi',
                    'zone' => 0,
                    'position' => $role === 'admin' ? 'Administrator' : ($invitation->position ?: 'Staff'),
                    'availability' => 'Available',
                    'created_at' => $acceptedAt,
                ]);
                DB::table('staff_invitations')->where('id', $invitation->id)->update(['accepted_at' => $acceptedAt]);
                $this->writeAudit(
                    (object) ['id' => $userId, 'role' => $role],
                    "{$role}.invitation.accepted",
                    'user',
                    $userId,
                    ['invitationId' => $invitation->id],
                );

                return ['status' => 'created', 'role' => $role];
            });
        } catch (Throwable $error) {
            Log::error('Staff invitation acceptance failed', ['exception' => $error::class]);
            if ($this->isUniqueViolation($error)) {
                return response()->json([
                    'message' => 'An account already uses these details. Contact the barangay office.',
                ], 409)->header('Cache-Control', 'no-store');
            }

            return response()->json(['message' => 'Unable to create the staff account.'], 500)
                ->header('Cache-Control', 'no-store');
        }

        if ($result['status'] === 'invalid_invitation') {
            return $this->invalidInvitation();
        }
        if ($result['status'] === 'account_exists') {
            return response()->json([
                'message' => 'An account already uses these details. Contact the barangay office.',
            ], 409)->header('Cache-Control', 'no-store');
        }

        $label = $result['role'] === 'admin' ? 'Administrator' : 'Staff';

        return response()->json([
            'message' => "{$label} account created. You can now sign in.",
            'role' => $result['role'],
        ], 201)->header('Cache-Control', 'no-store');
    }

    public function redeemTemporaryAccess(Request $request): JsonResponse
    {
        $accessToken = (string) $request->input('token', '');
        if (!preg_match('/^[0-9a-f]{64}$/i', $accessToken)) {
            return response()->json(['message' => 'A valid temporary access link is required.'], 400);
        }

        $tokenHash = hash('sha256', $accessToken);
        try {
            $grant = DB::transaction(function () use ($tokenHash) {
                $record = DB::table('staff_temporary_access_grants as grants')
                    ->join('users', 'users.id', '=', 'grants.user_id')
                    ->where('grants.token_hash', $tokenHash)
                    ->whereNull('grants.used_at')
                    ->whereNull('grants.revoked_at')
                    ->where('grants.expires_at', '>', now())
                    ->where('users.role', 'staff')
                    ->whereNotIn('users.status', ['Suspended', 'Disabled'])
                    ->select('grants.id as grant_id', 'grants.expires_at as grant_expires_at', 'users.*')
                    ->lockForUpdate()
                    ->first();
                if (!$record) {
                    return null;
                }
                DB::table('staff_temporary_access_grants')->where('id', $record->grant_id)->update(['used_at' => now()]);

                return $record;
            });
            if (!$grant) {
                return response()->json([
                    'message' => 'This temporary access link is invalid, expired, or already used.',
                ], 401);
            }

            $user = ApiIdentity::normalizeUser(clone $grant);
            $this->writeAudit($user, 'staff.temporary_access.redeemed', 'user', $user->id);
            $mfaEnabled = (bool) ($user->mfa_enabled ?? false);
            $mfaSecret = (string) ($user->mfa_secret ?? '');
            if ($mfaEnabled && $mfaSecret === '') {
                $this->writeAudit($user, 'staff.temporary_access.mfa_unavailable', 'user', $user->id);

                return response()->json([
                    'message' => 'Authenticator verification is unavailable. Ask an administrator to issue a new link.',
                ], 503);
            }

            if ($mfaEnabled) {
                $challenge = bin2hex(random_bytes(32));
                $expiresAt = min(now()->addMinutes(5), \Illuminate\Support\Carbon::parse($grant->grant_expires_at));
                DB::table('mfa_challenges')->insert([
                    'token_hash' => hash('sha256', $challenge),
                    'user_id' => $user->id,
                    'expires_at' => $expiresAt,
                    'created_at' => now(),
                    'temporary_access' => true,
                    'session_expires_at' => $grant->grant_expires_at,
                ]);

                return response()->json(['requiresMfa' => true, 'challengeToken' => $challenge]);
            }

            $expiresAt = \Illuminate\Support\Carbon::parse($grant->grant_expires_at);
            $token = $this->createToken($user->id, $expiresAt);

            return response()->json(['token' => $token, 'user' => $this->publicUser($user)]);
        } catch (Throwable $error) {
            Log::error('Staff temporary access redemption failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to redeem this temporary access link.'], 500);
        }
    }

    public function completeMfa(Request $request): JsonResponse
    {
        $challengeToken = (string) $request->input('challengeToken', '');
        $code = trim((string) $request->input('code', ''));
        if ($challengeToken === '' || !preg_match('/^\d{6}$/', $code)) {
            return response()->json(['message' => 'A valid 6-digit authenticator code is required.'], 400);
        }

        try {
            $tokenHash = hash('sha256', $challengeToken);
            $result = DB::transaction(function () use ($tokenHash, $code) {
                $challenge = DB::table('mfa_challenges')
                    ->where('token_hash', $tokenHash)
                    ->where('expires_at', '>', now())
                    ->lockForUpdate()
                    ->first();
                if (!$challenge) {
                    return ['error' => 'MFA challenge is invalid or expired. Please sign in again.', 'status' => 401];
                }
                $user = DB::table('users')->where('id', $challenge->user_id)->first();
                if (!$user || !(bool) $user->mfa_enabled || !$user->mfa_secret || in_array($user->status, ['Suspended', 'Disabled'], true)) {
                    return ['error' => 'MFA challenge is no longer valid.', 'status' => 401];
                }
                $step = $this->verifyTotp($this->decodeTotpSecret($user->mfa_secret), $code);
                if ($step === null || $step <= (int) $user->mfa_last_step) {
                    return ['error' => 'The authenticator code is invalid or has already been used.', 'status' => 401];
                }
                if ($challenge->temporary_access && (!$challenge->session_expires_at || now()->gte($challenge->session_expires_at))) {
                    return ['error' => 'MFA challenge is no longer valid.', 'status' => 401];
                }

                DB::table('users')->where('id', $user->id)->update(['mfa_last_step' => $step]);
                DB::table('mfa_challenges')->where('token_hash', $tokenHash)->delete();
                $expiresAt = $challenge->temporary_access ? $challenge->session_expires_at : now()->addDays(30);

                return ['user' => $user, 'expires_at' => $expiresAt];
            });
            if (isset($result['error'])) {
                return response()->json(['message' => $result['error']], $result['status']);
            }

            return response()->json([
                'message' => 'Login successful',
                'token' => $this->createToken($result['user']->id, $result['expires_at']),
                'user' => $this->publicUser($result['user']),
            ]);
        } catch (Throwable $error) {
            Log::error('MFA verification failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to verify authenticator code.'], 500);
        }
    }

    public function retractAnnouncement(Request $request, string $id): JsonResponse
    {
        if (!$this->isStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff access required.'], 403);
        }
        $content = $this->clean($request->input('content'));
        if ($content === '') {
            return response()->json(['message' => 'A correction message is required.'], 400);
        }
        try {
            $original = DB::table('announcements')->where('id', $id)->first();
            if (!$original) {
                return response()->json(['message' => 'Announcement not found.'], 404);
            }
            if ($original->retraction_announcement_id) {
                return response()->json([
                    'message' => 'A retraction has already been published for this announcement.',
                ], 409);
            }

            $delivery = ApiIdentity::decodeJson($original->social_delivery ?? []);
            $publishedChannels = [];
            if (!empty($original->facebook_post_id)) {
                $publishedChannels[] = 'facebook';
            }
            if ((int) ($delivery['messenger']['sent'] ?? 0) > 0) {
                $publishedChannels[] = 'messenger';
            }
            $publishedChannels = array_values(array_unique($publishedChannels));
            $integrationStatus = app(MetaIntegration::class)->status();
            $unavailable = array_values(array_filter($publishedChannels, fn ($channel) => empty($integrationStatus[$channel])));
            if ($unavailable) {
                $channel = $unavailable[0];

                return response()->json([
                    'message' => ($channel === 'facebook' ? 'Facebook' : 'Messenger').
                        ' is not connected. The retraction was not created.',
                ], 503);
            }

            $retractionId = (string) Str::uuid();
            $date = now()->format('n/j/Y');
            $title = mb_substr('Retraction: '.$original->title, 0, 200);
            DB::transaction(function () use ($id, $retractionId, $title, $content, $date, $publishedChannels) {
                $locked = DB::table('announcements')->where('id', $id)->lockForUpdate()->first();
                if (!$locked || $locked->retraction_announcement_id) {
                    throw new \RuntimeException('retraction_conflict');
                }
                DB::table('announcements')->insert([
                    'id' => $retractionId,
                    'tag' => 'red',
                    'title' => $title,
                    'content' => $content,
                    'date' => $date,
                    'social_channels' => json_encode($publishedChannels),
                    'social_delivery' => json_encode([]),
                    'related_announcement_id' => $id,
                    'created_at' => now(),
                ]);
                DB::table('announcements')->where('id', $id)->update(['retraction_announcement_id' => $retractionId]);
            });
            $announcement = [
                'id' => $retractionId,
                'tag' => 'red',
                'title' => $title,
                'content' => $content,
                'date' => $date,
                'socialChannels' => $publishedChannels,
                'socialDelivery' => [],
                'relatedAnnouncementId' => $id,
                'createdAt' => now()->toISOString(),
            ];
            $socialDelivery = [];
            $facebookPostId = null;
            if (in_array('facebook', $publishedChannels, true)) {
                try {
                    $facebookPostId = $this->publishFacebookPost($announcement);
                    $socialDelivery['facebook'] = ['status' => 'published', 'postId' => $facebookPostId];
                } catch (Throwable $error) {
                    Log::warning('Facebook announcement retraction delivery failed', ['exception' => $error::class]);
                    $socialDelivery['facebook'] = ['status' => 'failed', 'message' => $error->getMessage()];
                }
            }
            if (in_array('messenger', $publishedChannels, true)) {
                $socialDelivery['messenger'] = $this->deliverMessengerRetraction($announcement, $id);
            }
            if ($socialDelivery) {
                DB::table('announcements')->where('id', $retractionId)->update([
                    'social_delivery' => json_encode($socialDelivery),
                    'facebook_post_id' => $facebookPostId,
                ]);
                $announcement['socialDelivery'] = $socialDelivery;
                if ($facebookPostId !== null) {
                    $announcement['facebookPostId'] = $facebookPostId;
                }
            }

            return response()->json(['announcement' => $announcement, 'socialDelivery' => $socialDelivery], 201);
        } catch (\RuntimeException $error) {
            if ($error->getMessage() === 'retraction_conflict') {
                return response()->json([
                    'message' => 'A retraction has already been published for this announcement.',
                ], 409);
            }
            Log::error('Announcement retraction failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to publish the retraction.'], 500);
        } catch (Throwable $error) {
            Log::error('Announcement retraction failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to publish the retraction.'], 500);
        }
    }

    public function dashboardRequests(Request $request): JsonResponse
    {
        if (!$this->isStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff access required.'], 403);
        }
        $search = (string) $request->query('search', '');
        $status = (string) $request->query('status', 'active');
        $type = (string) $request->query('type', '');
        $zone = (string) $request->query('zone', '');
        $from = (string) $request->query('from', '');
        $to = (string) $request->query('to', '');
        $sort = (string) $request->query('sort', 'date');
        $direction = (string) $request->query('direction', 'desc');
        $page = filter_var($request->query('page', 1), FILTER_VALIDATE_INT);
        $pageSize = filter_var($request->query('pageSize', 10), FILTER_VALIDATE_INT);
        if (mb_strlen($search) > 120 || mb_strlen($type) > 100) {
            return response()->json(['message' => 'Search text or document type is too long.'], 400);
        }
        if ($zone !== '' && !in_array($zone, ['1', '2', '3', '4', '5', '6', '7'], true)) {
            return response()->json(['message' => 'Invalid request zone filter.'], 400);
        }
        if (!in_array($status, ['active', 'all', ...self::REPORT_STATUSES], true)) {
            return response()->json(['message' => 'Invalid request status filter.'], 400);
        }
        if (!in_array($sort, ['date', 'status'], true)) {
            return response()->json(['message' => 'Invalid request sort field.'], 400);
        }
        if (!in_array($direction, ['asc', 'desc'], true)) {
            return response()->json(['message' => 'Invalid sort direction.'], 400);
        }
        if (($from !== '' && !$this->validDate($from)) || ($to !== '' && !$this->validDate($to)) || ($from !== '' && $to !== '' && $from > $to)) {
            return response()->json(['message' => 'Invalid request date range.'], 400);
        }
        if (!$page || $page < 1 || $page > 100000 || !$pageSize || $pageSize < 1 || $pageSize > 50) {
            return response()->json(['message' => 'Invalid pagination values.'], 400);
        }

        try {
            $query = DB::table('requests as r')
                ->join('users as u', 'u.id', '=', 'r.user_id');
            if ($search !== '') {
                $pattern = '%'.mb_strtolower(trim($search)).'%';
                $query->where(function ($builder) use ($pattern) {
                    $builder->whereRaw('LOWER(CAST(r.id AS TEXT)) LIKE ?', [$pattern])
                        ->orWhereRaw('LOWER(r.type) LIKE ?', [$pattern])
                        ->orWhereRaw('LOWER(r.purpose) LIKE ?', [$pattern])
                        ->orWhereRaw('LOWER(u.first_name) LIKE ?', [$pattern])
                        ->orWhereRaw('LOWER(u.last_name) LIKE ?', [$pattern]);
                });
            }
            if ($status === 'active') {
                $query->whereNotIn('r.status', ['Approved', 'Rejected']);
            } elseif ($status !== 'all') {
                $query->where('r.status', $status);
            }
            if ($type !== '') {
                $query->where('r.type', $type);
            }
            if ($zone !== '') {
                $query->where('u.zone', (int) $zone);
            }
            if ($from !== '') {
                $query->whereRaw(
                    DB::getDriverName() === 'pgsql'
                        ? "(r.created_at AT TIME ZONE 'Asia/Manila')::date >= ?::date"
                        : 'DATE(r.created_at) >= DATE(?)',
                    [$from]
                );
            }
            if ($to !== '') {
                $query->whereRaw(
                    DB::getDriverName() === 'pgsql'
                        ? "(r.created_at AT TIME ZONE 'Asia/Manila')::date <= ?::date"
                        : 'DATE(r.created_at) <= DATE(?)',
                    [$to]
                );
            }

            $total = (clone $query)->count();
            $rows = $query
                ->select('r.*', 'u.first_name', 'u.last_name')
                ->orderBy($sort === 'status' ? 'r.status' : 'r.created_at', $direction)
                ->orderBy('r.id')
                ->offset(($page - 1) * $pageSize)
                ->limit($pageSize)
                ->get();
            $summary = DB::table('requests')
                ->selectRaw("COUNT(*) as total, SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status = 'In Review' THEN 1 ELSE 0 END) as \"inReview\", SUM(CASE WHEN status = 'Needs Information' THEN 1 ELSE 0 END) as \"needsInformation\", SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) as approved, SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejected")
                ->first();
            $documentTypes = DB::table('requests')->whereNotNull('type')->distinct()->orderBy('type')->pluck('type')->all();

            return response()->json([
                'requests' => $rows->map(fn ($row) => $this->requestRecord($row))->all(),
                'total' => (int) $total,
                'page' => $page,
                'pageSize' => $pageSize,
                'documentTypes' => $documentTypes,
                'summary' => [
                    'total' => (int) $summary->total,
                    'pending' => (int) $summary->pending,
                    'inReview' => (int) $summary->inReview,
                    'needsInformation' => (int) $summary->needsInformation,
                    'approved' => (int) $summary->approved,
                    'rejected' => (int) $summary->rejected,
                    'deadlineTracking' => false,
                    'releaseTracking' => false,
                ],
            ]);
        } catch (Throwable $error) {
            Log::error('Staff dashboard requests query failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to load staff request dashboard.'], 500);
        }
    }

    public function reports(Request $request): JsonResponse
    {
        if (!$this->isStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff access required.'], 403);
        }
        $filters = $this->reportFilters($request);
        if ($filters instanceof JsonResponse) {
            return $filters;
        }
        try {
            $requests = DB::table('requests')->orderByDesc('created_at')->get()->map(fn ($row) => [
                'id' => $row->id,
                'type' => $row->type,
                'status' => $row->status,
                'date' => $row->created_at,
                'statusHistory' => ApiIdentity::decodeJson($row->status_history ?? []),
            ])->all();

            return response()->json($this->buildRequestReport($requests, $filters));
        } catch (Throwable $error) {
            Log::error('Staff reports query failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to load service reports.'], 500);
        }
    }

    public function exportReports(Request $request)
    {
        if (!$this->isStaffOrAdmin($request)) {
            return response()->json(['message' => 'Staff access required.'], 403);
        }
        $filters = $this->reportFilters($request);
        if ($filters instanceof JsonResponse) {
            return $filters;
        }
        try {
            $requests = DB::table('requests')->orderByDesc('created_at')->get()->map(fn ($row) => [
                'id' => $row->id,
                'type' => $row->type,
                'status' => $row->status,
                'date' => $row->created_at,
                'statusHistory' => ApiIdentity::decodeJson($row->status_history ?? []),
            ])->all();
            $filtered = $this->filterReportRequests($requests, $filters);
            $csv = $this->createReportCsv($filtered);
            $range = $filters['from'] && $filters['to']
                ? "{$filters['from']}-to-{$filters['to']}"
                : ($filters['from'] ?: ($filters['to'] ?: 'all-time'));

            return response("\xEF\xBB\xBF".$csv, 200, [
                'Content-Type' => 'text/csv; charset=utf-8',
                'Content-Disposition' => 'attachment; filename="service-requests-'.$range.'.csv"',
            ]);
        } catch (Throwable $error) {
            Log::error('Staff reports CSV export failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to export service reports.'], 500);
        }
    }

    public function createReport(Request $request): JsonResponse
    {
        $type = $this->clean($request->input('type'));
        $title = $this->clean($request->input('title'));
        $description = $this->clean($request->input('description'));
        $severity = $this->clean($request->input('severity'));
        $zone = (int) $request->input('zone', 0) ?: 1;
        if (!$type || !$title) {
            return response()->json(['message' => 'Type and title are required.'], 400);
        }

        $report = [
            'id' => 'RPT-'.substr((string) now()->valueOf(), -6),
            'type' => $type,
            'title' => $title,
            'description' => $description,
            'severity' => $severity ?: null,
            'zone' => $zone,
            'status' => 'Open',
            'date' => now()->toISOString(),
        ];
        try {
            DB::table('reports')->insert([
                'id' => $report['id'],
                'type' => $report['type'],
                'title' => $report['title'],
                'description' => $report['description'],
                'severity' => $report['severity'],
                'zone' => $zone,
                'status' => 'Open',
                'report_date' => $report['date'],
            ]);

            return response()->json(['report' => $report], 201);
        } catch (Throwable $error) {
            Log::error('Staff report creation failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to create report.'], 500);
        }
    }

    public function updatePresence(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        try {
            $lastSeen = now()->toISOString();
            $updated = DB::table('users')->where('id', $actor->id)->where('role', 'staff')->update(['last_seen' => $lastSeen]);
            if (!$updated) {
                return response()->json(['message' => 'Staff account not found.'], 404);
            }

            return response()->json(['ok' => true, 'lastSeen' => $lastSeen]);
        } catch (Throwable $error) {
            Log::error('Staff presence update failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to update staff presence.'], 500);
        }
    }

    public function staffPresence(): JsonResponse
    {
        try {
            $staff = DB::table('users')->where('role', 'staff')->get()->map(fn ($user) => [
                'id' => $user->id,
                'firstName' => $user->first_name,
                'lastName' => $user->last_name,
                'position' => $user->position ?: 'Staff',
                'email' => $user->email,
                'mobile' => $user->mobile,
                'status' => $user->status,
                'lastSeen' => $user->last_seen,
            ])->all();

            return response()->json(['staff' => $staff]);
        } catch (Throwable $error) {
            Log::error('Staff presence query failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to load staff presence.'], 500);
        }
    }

    public function resetStaffPassword(Request $request, string $id): JsonResponse
    {
        $password = trim((string) $request->input('password', ''));
        if (!$this->validPassword($password)) {
            return response()->json(['message' => 'Password must have '.self::PASSWORD_REQUIREMENTS.'.'], 400);
        }
        try {
            $target = DB::table('users')->where('id', $id)->where('role', 'staff')->first();
            if (!$target) {
                return response()->json(['message' => 'Staff member not found.'], 404);
            }
            DB::transaction(function () use ($request, $target, $password) {
                DB::table('users')->where('id', $target->id)->update([
                    'password_hash' => password_hash($password, PASSWORD_BCRYPT),
                    'tokens_valid_after' => time(),
                ]);
                DB::table('api_tokens')->where('user_id', $target->id)->delete();
                $this->writeAudit($request->attributes->get('actor'), 'staff.password_reset', 'user', $target->id, ['email' => $target->email]);
            });

            return response()->json(['ok' => true]);
        } catch (Throwable $error) {
            Log::error('Staff password reset failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to reset staff password.'], 500);
        }
    }

    public function issueTemporaryAccess(Request $request, string $id): JsonResponse
    {
        if ($request->attributes->get('actor')->role !== 'admin') {
            return response()->json(['message' => 'Admin access required.'], 403);
        }
        $deliveryUrl = (string) (env('RESET_DELIVERY_URL') ?: env('NOTIFICATION_WEBHOOK_URL') ?: '');
        if ($deliveryUrl === '') {
            return response()->json(['message' => 'Temporary access email delivery is not configured.'], 503);
        }
        $portalUrl = (string) (env('PUBLIC_APP_URL') ?: 'https://barangay-legaspi.vercel.app');
        $parsed = parse_url($portalUrl);
        if (
            !is_array($parsed) || ($parsed['scheme'] ?? '') !== 'https'
            || empty($parsed['host']) || isset($parsed['user']) || isset($parsed['pass'])
            || ($parsed['path'] ?? '/') !== '/' || isset($parsed['query']) || isset($parsed['fragment'])
        ) {
            return response()->json(['message' => 'The official portal URL is not configured correctly.'], 503);
        }
        $publicAppUrl = 'https://'.$parsed['host'].(isset($parsed['port']) ? ':'.$parsed['port'] : '');

        try {
            $target = DB::table('users')->where('id', $id)->where('role', 'staff')->first();
        } catch (Throwable $error) {
            Log::error('Staff temporary access target lookup failed', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to load the staff account.'], 500);
        }
        if (!$target || in_array($target->status, ['Suspended', 'Disabled'], true)) {
            return response()->json(['message' => 'Active staff account not found.'], 404);
        }
        if (!filter_var($target->email, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['message' => 'The staff account does not have a valid email address.'], 409);
        }

        $accessToken = bin2hex(random_bytes(32));
        $deliveryToken = (string) env('RESET_DELIVERY_TOKEN', '');
        if (app()->environment('production') && (!str_starts_with($deliveryUrl, 'https://') || $deliveryToken === '')) {
            return response()->json(['message' => 'Temporary access email delivery is not configured.'], 503);
        }
        $grantId = (string) Str::uuid();
        $issuedAt = now();
        $expiresAt = $issuedAt->copy()->addMinutes(15);
        $created = false;
        try {
            $status = DB::transaction(function () use ($target, $grantId, $accessToken, $request, $issuedAt, $expiresAt) {
                $locked = DB::table('users')->where('id', $target->id)->where('role', 'staff')->whereNotIn('status', ['Suspended', 'Disabled'])->lockForUpdate()->first();
                if (!$locked || !$locked->email) {
                    return false;
                }
                DB::table('staff_temporary_access_grants')
                    ->where('user_id', $target->id)
                    ->whereNull('used_at')
                    ->whereNull('revoked_at')
                    ->where('expires_at', '>', $issuedAt)
                    ->update(['revoked_at' => $issuedAt]);
                DB::table('staff_temporary_access_grants')->insert([
                    'id' => $grantId,
                    'user_id' => $target->id,
                    'token_hash' => hash('sha256', $accessToken),
                    'issued_by' => $request->attributes->get('actor')->id,
                    'issued_at' => $issuedAt,
                    'expires_at' => $expiresAt,
                ]);

                return true;
            });
            if (!$status) {
                return response()->json(['message' => 'The staff account is no longer eligible for temporary access.'], 409);
            }
            $created = true;
            $metadata = [
                'actionUrl' => $publicAppUrl.'/staff-access#'.$accessToken,
                'expiresInMinutes' => 15,
            ];
            $client = Http::timeout(10)->acceptJson();
            if ($deliveryToken !== '') {
                $client = $client->withToken($deliveryToken);
            }
            $response = $client->post($deliveryUrl, [
                'event' => 'staff_temporary_access',
                'recipient' => $target->email,
                'token' => $accessToken,
                'expiresAt' => $expiresAt->toISOString(),
                'userId' => $target->id,
                'email' => $target->email,
                'mobile' => $target->mobile,
                'title' => 'Temporary staff portal access',
                'message' => 'Use the secure link to sign in to the staff portal. It can be used once and expires in 15 minutes.',
                'metadata' => $metadata,
                'sentAt' => now()->toISOString(),
            ]);
            if (!$response->successful()) {
                DB::table('staff_temporary_access_grants')->where('id', $grantId)->whereNull('used_at')->whereNull('revoked_at')->update(['revoked_at' => now()]);
                $created = false;

                return response()->json(['message' => 'Temporary access email delivery is unavailable.'], 503);
            }
            $this->writeAudit($request->attributes->get('actor'), 'staff.temporary_access.issued', 'user', $target->id, [
                'recipient' => $target->email,
                'expiresAt' => $expiresAt->toISOString(),
                'deliveryStatus' => 'queued',
            ]);

            return response()->json(['message' => 'Temporary access email queued.', 'expiresAt' => $expiresAt->toISOString()], 202);
        } catch (Throwable $error) {
            if ($created) {
                try {
                    DB::table('staff_temporary_access_grants')->where('id', $grantId)->whereNull('used_at')->whereNull('revoked_at')->update(['revoked_at' => now()]);
                } catch (Throwable $revokeError) {
                    Log::error('Failed to revoke undelivered staff temporary access', ['exception' => $revokeError::class]);
                }
            }
            Log::error('Staff temporary access delivery failed', ['exception' => $error::class]);

            return response()->json([
                'message' => 'Unable to deliver temporary access. No access link was activated.',
            ], 502);
        }
    }

    private function invalidInvitation(): JsonResponse
    {
        return response()->json([
            'message' => 'This staff invitation is invalid, expired, or already used.',
        ], 410)->header('Cache-Control', 'no-store');
    }

    private function invitationIsValid(?object $invitation): bool
    {
        return $invitation
            && !$invitation->accepted_at
            && !$invitation->revoked_at
            && \Illuminate\Support\Carbon::parse($invitation->expires_at)->isFuture()
            && in_array($invitation->role, ['admin', 'staff'], true);
    }

    private function clean(mixed $value): string
    {
        return trim(str_replace(['<', '>'], '', (string) ($value ?? '')));
    }

    private function validPassword(string $password): bool
    {
        return mb_strlen($password) >= 8
            && preg_match('/[a-z]/', $password)
            && preg_match('/[A-Z]/', $password)
            && preg_match('/\d/', $password)
            && preg_match('/[^A-Za-z0-9\s]/', $password);
    }

    private function writeAudit(?object $actor, string $action, ?string $targetType, ?string $targetId, array $metadata = []): void
    {
        DB::table('audit_logs')->insert([
            'id' => (string) Str::uuid(),
            'actor_id' => $actor->id ?? null,
            'actor_role' => $actor->role ?? null,
            'action' => $action,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'metadata' => json_encode($metadata),
            'created_at' => now(),
        ]);
    }

    private function isUniqueViolation(Throwable $error): bool
    {
        $previous = $error->getPrevious();
        $code = $previous?->getCode() ?? $error->getCode();
        if (in_array((string) $code, ['23000', '23505'], true)) {
            return true;
        }
        $errorInfo = $previous?->errorInfo ?? null;

        return is_array($errorInfo) && in_array((string) ($errorInfo[0] ?? ''), ['23000', '23505'], true);
    }

    private function createToken(string $userId, mixed $expiresAt): string
    {
        $token = bin2hex(random_bytes(32));
        DB::table('api_tokens')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token),
            'expires_at' => $expiresAt,
            'created_at' => now(),
        ]);

        return $token;
    }

    private function publicUser(object $user): array
    {
        return ApiIdentity::safeUser($user);
    }

    private function isStaffOrAdmin(Request $request): bool
    {
        return in_array($request->attributes->get('actor')->role, ['staff', 'admin', 'super_admin'], true);
    }

    private function reportFilters(Request $request): array|JsonResponse
    {
        $from = (string) $request->query('from', '');
        $to = (string) $request->query('to', '');
        $type = (string) $request->query('type', '');
        $status = (string) $request->query('status', '');
        if (($from && !$this->validDate($from)) || ($to && !$this->validDate($to)) || ($from && $to && $from > $to)) {
            return response()->json(['message' => 'Invalid report date range.'], 400);
        }
        if (mb_strlen($type) > 100 || ($status && !in_array($status, self::REPORT_STATUSES, true))) {
            return response()->json(['message' => 'Invalid report filter.'], 400);
        }

        return compact('from', 'to', 'type', 'status');
    }

    private function validDate(string $value): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)
            && checkdate((int) substr($value, 5, 2), (int) substr($value, 8, 2), (int) substr($value, 0, 4));
    }

    private function requestRecord(object $row): array
    {
        $data = (array) $row;
        $data['userId'] = $row->user_id;
        $data['date'] = $row->created_at;
        $data['createdAt'] = $row->created_at;
        $data['updatedAt'] = $row->updated_at;
        $data['deliveryMethod'] = $row->delivery_method ?? 'online';
        $data['deliveryNote'] = $row->delivery_note ?? '';
        $data['followUps'] = ApiIdentity::decodeJson($row->follow_ups ?? []);
        $data['statusHistory'] = ApiIdentity::decodeJson($row->status_history ?? []);
        $data['firstName'] = $row->first_name ?? '';
        $data['lastName'] = $row->last_name ?? '';
        $data['zone'] = $row->zone ?? null;

        return $data;
    }

    private function filterReportRequests(array $requests, array $filters): array
    {
        $from = $filters['from'] ? strtotime($filters['from'].' 00:00:00 Asia/Manila') : null;
        $to = $filters['to'] ? strtotime($filters['to'].' 00:00:00 Asia/Manila') + 86400 : null;

        return array_values(array_filter($requests, function ($request) use ($filters, $from, $to) {
            $timestamp = strtotime((string) ($request['date'] ?? ''));

            return $timestamp !== false
                && ($from === null || $timestamp >= $from)
                && ($to === null || $timestamp < $to)
                && (!$filters['type'] || $request['type'] === $filters['type'])
                && (!$filters['status'] || $request['status'] === $filters['status']);
        }));
    }

    private function lastDecision(array $request): ?array
    {
        $history = $request['statusHistory'] ?? $request['status_history'] ?? [];
        $decisions = [];
        foreach (is_array($history) ? $history : [] as $entry) {
            if (!in_array($entry['status'] ?? null, ['Approved', 'Rejected'], true)) {
                continue;
            }
            $timestamp = strtotime((string) ($entry['createdAt'] ?? $entry['created_at'] ?? ''));
            if ($timestamp !== false) {
                $decisions[] = ['status' => $entry['status'], 'timestamp' => $timestamp];
            }
        }
        usort($decisions, fn ($left, $right) => $left['timestamp'] <=> $right['timestamp']);

        return $decisions ? $decisions[count($decisions) - 1] : null;
    }

    private function createReportCsv(array $requests): string
    {
        $rows = [['Request reference', 'Request type', 'Submitted at', 'Current status', 'Decision status', 'Decision date']];
        foreach ($requests as $request) {
            $decision = $this->lastDecision($request);
            $rows[] = [
                $request['id'] ?? '',
                $request['type'] ?? '',
                $request['date'] ?? '',
                $request['status'] ?? '',
                $decision['status'] ?? '',
                $decision ? gmdate('Y-m-d\TH:i:s\Z', $decision['timestamp']) : '',
            ];
        }
        return implode("\r\n", array_map(function ($row) {
            return implode(',', array_map(function ($value) {
                $text = (string) ($value ?? '');
                if (preg_match('/^[\s\x00-\x1f]*[=+\-@]/', $text)) {
                    $text = "'".$text;
                }

                return '"'.str_replace('"', '""', $text).'"';
            }, $row));
        }, $rows));
    }

    private function buildRequestReport(array $requests, array $filters): array
    {
        $from = $filters['from'] ? strtotime($filters['from'].' 00:00:00 Asia/Manila') : null;
        $to = $filters['to'] ? strtotime($filters['to'].' 00:00:00 Asia/Manila') + 86400 : null;
        $all = $requests;
        $requestTypes = array_values(array_unique(array_filter(
            array_column($all, 'type'),
            fn ($value) => $value !== null && $value !== '',
        )));
        $statuses = array_values(array_unique(array_filter(
            array_column($all, 'status'),
            fn ($value) => $value !== null && $value !== '',
        )));
        sort($requestTypes, SORT_STRING);
        sort($statuses, SORT_STRING);
        $selected = $this->filterReportRequests($all, $filters);
        $decisions = [];
        foreach ($all as $request) {
            if (($filters['type'] && $request['type'] !== $filters['type']) || ($filters['status'] && $request['status'] !== $filters['status'])) {
                continue;
            }
            $decision = $this->lastDecision($request);
            if ($decision && ($from === null || $decision['timestamp'] >= $from) && ($to === null || $decision['timestamp'] < $to)) {
                $decisions[] = ['request' => $request, 'id' => $request['id'], 'type' => $request['type'], ...$decision];
            }
        }
        $approved = count(array_filter($decisions, fn ($decision) => $decision['status'] === 'Approved'));
        $rejected = count(array_filter($decisions, fn ($decision) => $decision['status'] === 'Rejected'));
        $counts = [];
        $typeCounts = [];
        foreach ($selected as $request) {
            $counts[$request['status']] = ($counts[$request['status']] ?? 0) + 1;
            $typeCounts[$request['type']] = ($typeCounts[$request['type']] ?? 0) + 1;
        }
        $active = count(array_filter($selected, fn ($request) => !in_array($request['status'], ['Approved', 'Rejected'], true)));
        $durations = [];
        foreach ($decisions as $decision) {
            $created = strtotime((string) $decision['request']['date']);
            if ($created !== false && $decision['timestamp'] >= $created) {
                $durations[] = ($decision['timestamp'] - $created) / 3600;
            }
        }

        $submissionTimes = array_values(array_filter(array_map(fn ($request) => strtotime((string) ($request['date'] ?? '')), $selected), fn ($time) => $time !== false));
        $days = $from !== null && $to !== null
            ? (int) ceil(($to - $from) / 86400)
            : (count($submissionTimes) >= 2 ? (int) ((max($submissionTimes) - min($submissionTimes)) / 86400) : null);
        $unit = $days === null ? 'month' : ($days <= 31 ? 'day' : ($days <= 120 ? 'week' : 'month'));
        $activity = [];
        foreach ($selected as $request) {
            $timestamp = strtotime((string) ($request['date'] ?? ''));
            if ($timestamp !== false && ($from === null || $timestamp >= $from) && ($to === null || $timestamp < $to)) {
                $period = $this->bucketPeriod($timestamp, $unit);
                $activity[$period] ??= ['period' => $period, 'received' => 0, 'decisions' => 0, 'unit' => $unit];
                $activity[$period]['received']++;
            }
        }
        foreach ($decisions as $decision) {
            $period = $this->bucketPeriod($decision['timestamp'], $unit);
            $activity[$period] ??= ['period' => $period, 'received' => 0, 'decisions' => 0, 'unit' => $unit];
            $activity[$period]['decisions']++;
        }
        ksort($activity, SORT_STRING);
        usort($decisions, fn ($left, $right) => $right['timestamp'] <=> $left['timestamp']);
        $recent = array_slice($decisions, 0, 10);

        return [
            'summary' => [
                'received' => count($selected),
                'pendingReview' => $counts['Pending'] ?? 0,
                'inProcessing' => $counts['In Review'] ?? 0,
                'needsInformation' => $counts['Needs Information'] ?? 0,
                'approved' => $counts['Approved'] ?? 0,
                'rejected' => $counts['Rejected'] ?? 0,
                'active' => $active,
                'approvedDecisions' => $approved,
                'rejectedDecisions' => $rejected,
                'decisionCount' => $approved + $rejected,
                'approvalRate' => $approved + $rejected ? (int) round($approved * 100 / ($approved + $rejected)) : null,
                'pendingRate' => count($selected) ? (int) round($active * 100 / count($selected)) : null,
                'averageDecisionHours' => $durations ? (int) round(array_sum($durations) / count($durations)) : null,
                'deadlineTracking' => false,
                'releaseTracking' => false,
                'missingSubmissionDates' => count(array_filter($all, fn ($request) => strtotime((string) ($request['date'] ?? '')) === false)),
            ],
            'requestTypes' => $requestTypes,
            'statuses' => $statuses,
            'statusDistribution' => array_map(fn ($name, $count) => ['name' => $name, 'count' => $count], array_keys($counts), array_values($counts)),
            'typeBreakdown' => array_map(fn ($name, $count) => ['name' => $name, 'count' => $count], array_keys($typeCounts), array_values($typeCounts)),
            'activity' => array_values($activity),
            'recentDecisions' => array_map(fn ($decision) => [
                'id' => $decision['id'],
                'type' => $decision['type'],
                'status' => $decision['status'],
                'date' => gmdate('Y-m-d\TH:i:s\Z', $decision['timestamp']),
            ], $recent),
            'generatedAt' => now()->toISOString(),
        ];
    }

    private function bucketPeriod(int $timestamp, string $unit): string
    {
        $local = new \DateTimeImmutable('@'.$timestamp);
        $local = $local->setTimezone(new \DateTimeZone('Asia/Manila'));
        if ($unit === 'day') {
            return $local->format('Y-m-d');
        }
        if ($unit === 'week') {
            return $local->modify('monday this week')->format('Y-m-d');
        }

        return $local->format('Y-m');
    }

    private function publishFacebookPost(array $announcement): string
    {
        $version = (string) config('services.meta.graph_api_version');
        $pageId = (string) config('services.meta.page_id');
        $response = Http::asForm()->timeout(10)->post(
            'https://graph.facebook.com/'.$version.'/'.rawurlencode($pageId).'/feed',
            [
                'message' => $announcement['title']."\n\n".$announcement['content'],
                'access_token' => config('services.meta.page_access_token'),
            ],
        );
        $postId = $response->json('id');
        if (!$response->successful() || !is_string($postId) || $postId === '') {
            $message = $response->json('error.message') ?: 'Meta did not return a Facebook post ID.';
            throw new \RuntimeException($message);
        }

        return $postId;
    }

    private function deliverMessengerRetraction(array $announcement, string $originalId): array
    {
        $now = now();
        $subscribers = DB::table('announcement_messenger_deliveries as deliveries')
            ->join('messenger_subscribers as subscribers', 'subscribers.psid', '=', 'deliveries.psid')
            ->where('deliveries.announcement_id', $originalId)
            ->where('subscribers.opted_in', true)
            ->whereBetween('subscribers.last_message_at', [$now->copy()->subHours(24), $now])
            ->select('deliveries.psid')
            ->get();
        $outcomes = ['status' => 'sent', 'eligible' => $subscribers->count(), 'sent' => 0, 'failed' => 0];
        if ($subscribers->isEmpty()) {
            return [
                ...$outcomes,
                'status' => 'skipped',
                'reason' => 'No opted-in subscribers have an open 24-hour messaging window.',
            ];
        }

        $version = (string) config('services.meta.graph_api_version');
        $pageId = (string) config('services.meta.page_id');
        foreach ($subscribers as $subscriber) {
            try {
                $response = Http::asForm()->timeout(10)->post(
                    'https://graph.facebook.com/'.$version.'/'.rawurlencode($pageId).'/messages',
                    [
                        'access_token' => config('services.meta.page_access_token'),
                        'recipient' => json_encode(['id' => $subscriber->psid], JSON_THROW_ON_ERROR),
                        'messaging_type' => 'RESPONSE',
                        'message' => json_encode([
                            'text' => $announcement['title']."\n\n".$announcement['content'],
                        ], JSON_THROW_ON_ERROR),
                    ],
                );
                $messageId = $response->json('message_id');
                if (!$response->successful() || !is_string($messageId) || $messageId === '') {
                    throw new \RuntimeException('Meta did not confirm the Messenger message.');
                }
                DB::table('announcement_messenger_deliveries')->insertOrIgnore([
                    'announcement_id' => $announcement['id'],
                    'psid' => $subscriber->psid,
                    'sent_at' => $now,
                ]);
                $outcomes['sent']++;
            } catch (Throwable $error) {
                Log::warning('Messenger announcement retraction delivery failed', ['exception' => $error::class]);
                $outcomes['failed']++;
            }
        }
        if ($outcomes['failed'] > 0) {
            $outcomes['status'] = $outcomes['sent'] > 0 ? 'partial' : 'failed';
        }

        return $outcomes;
    }

    private function decodeTotpSecret(string $value): string
    {
        $parts = explode('.', $value);
        if (count($parts) !== 4 || !in_array($parts[0], ['v1', 'v2'], true)) {
            throw new \RuntimeException('Invalid encrypted MFA secret.');
        }
        $decode = fn ($part) => base64_decode(strtr($part, '-_', '+/').str_repeat('=', (4 - strlen($part) % 4) % 4), true);
        $iv = $decode($parts[1]);
        $tag = $decode($parts[2]);
        $ciphertext = $decode($parts[3]);
        if ($iv === false || $tag === false || $ciphertext === false) {
            throw new \RuntimeException('Invalid encrypted MFA secret.');
        }
        $key = $parts[0] === 'v1' ? (string) config('app.jwt_secret') : (string) config('app.mfa_encryption_key');
        $secret = $key === '' ? false : openssl_decrypt($ciphertext, 'aes-256-gcm', hash('sha256', $key, true), OPENSSL_RAW_DATA, $iv, $tag);
        if ($secret === false && $parts[0] === 'v2') {
            foreach (array_filter(array_map('trim', explode(',', (string) config('app.mfa_encryption_key_previous')))) as $previous) {
                $secret = openssl_decrypt($ciphertext, 'aes-256-gcm', hash('sha256', $previous, true), OPENSSL_RAW_DATA, $iv, $tag);
                if ($secret !== false) {
                    break;
                }
            }
        }
        if ($secret === false) {
            throw new \RuntimeException('Unable to decrypt authenticator secret.');
        }

        return $secret;
    }

    private function verifyTotp(string $secret, string $code): ?int
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $buffer = 0;
        $bits = 0;
        $key = '';
        foreach (str_split(strtoupper(rtrim($secret, '='))) as $character) {
            $digit = strpos($alphabet, $character);
            if ($digit === false) {
                return null;
            }
            $buffer = (($buffer << 5) | $digit) & 0xffff;
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $key .= chr(($buffer >> $bits) & 0xff);
            }
        }
        $current = (int) floor(time() / 30);
        foreach ([$current - 1, $current, $current + 1] as $step) {
            $counter = pack('N2', ($step >> 32) & 0xffffffff, $step & 0xffffffff);
            $digest = hash_hmac('sha1', $counter, $key, true);
            $offset = ord($digest[strlen($digest) - 1]) & 0x0f;
            $binary = ((ord($digest[$offset]) & 0x7f) << 24)
                | ((ord($digest[$offset + 1]) & 0xff) << 16)
                | ((ord($digest[$offset + 2]) & 0xff) << 8)
                | (ord($digest[$offset + 3]) & 0xff);
            if (hash_equals(str_pad((string) ($binary % 1000000), 6, '0', STR_PAD_LEFT), $code)) {
                return $step;
            }
        }

        return null;
    }
}
