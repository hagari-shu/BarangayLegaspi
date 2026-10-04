<?php

namespace App\Http\Controllers;

use App\Support\ApiIdentity;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class ApiController extends Controller
{
    private const PASSWORD_REQUIREMENTS = 'at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character';

    private const SERVICES = [
        ['icon' => '📄', 'title' => 'Barangay Certificate', 'subtitle' => 'Request and claim', 'tone' => 'green'],
        ['icon' => '🏥', 'title' => 'Health Assistance', 'subtitle' => 'Access public health support', 'tone' => 'blue'],
        ['icon' => '🧾', 'title' => 'Barangay Clearance', 'subtitle' => 'Update and renew', 'tone' => 'amber'],
        ['icon' => '🚨', 'title' => 'Emergency Help', 'subtitle' => 'Call for immediate support', 'tone' => 'red'],
    ];

    private const EVENTS = [
        ['title' => 'Barangay health drive', 'date' => '2026-09-05', 'location' => 'Covered Court'],
        ['title' => 'Tree planting program', 'date' => '2026-09-12', 'location' => 'Barangay Park'],
        ['title' => 'Senior citizen support session', 'date' => '2026-09-18', 'location' => 'Barangay Hall'],
    ];

    private const SAMPLE_ANNOUNCEMENTS = [
        ['tag' => 'green', 'title' => 'Free vaccination schedule', 'date' => 'June 18 • 8:00 AM', 'content' => 'Vaccination drive for all residents. Come to the barangay hall.', 'socialChannels' => ['facebook', 'instagram']],
        ['tag' => 'amber', 'title' => 'Senior citizen ID renewal', 'date' => 'June 20 • 9:00 AM', 'content' => 'Senior citizens are encouraged to renew their IDs.', 'socialChannels' => ['facebook']],
        ['tag' => 'blue', 'title' => 'Clean-up drive reminder', 'date' => 'June 25 • 7:00 AM', 'content' => 'Community clean-up drive scheduled for next Saturday.', 'socialChannels' => ['facebook', 'messenger']],
        ['tag' => 'red', 'title' => 'Emergency hotline now active', 'date' => 'August 29 • 3:30 PM', 'content' => 'Emergency hotline is available 24/7 for all barangay residents.', 'socialChannels' => ['facebook', 'instagram', 'x']],
    ];

    public function health(): JsonResponse
    {
        try {
            DB::select('SELECT 1');

            return response()->json([
                'ok' => true,
                'message' => 'Barangay Legaspi API is running',
                'storage' => DB::connection()->getDriverName(),
            ]);
        } catch (Throwable $error) {
            Log::error('Laravel API health check failed', ['message' => $error->getMessage()]);

            return response()->json(['ok' => false, 'message' => 'Database unavailable.'], 503);
        }
    }

    public function reportClientError(Request $request): JsonResponse
    {
        $type = $request->input('type');
        if (!is_string($type) || !in_array($type, ['render', 'window-error', 'unhandled-rejection'], true)) {
            return response()->json(['message' => 'Unsupported client error type.'], 400);
        }

        $requestedPath = parse_url((string) $request->input('route', '/'), PHP_URL_PATH);
        $segments = explode('/', trim(is_string($requestedPath) ? $requestedPath : '/', '/'));
        $route = ($segments[0] ?? '') === '' ? '/' : '/'.$segments[0];
        $allowedRoutes = ['/', '/register', '/dashboard', '/requests', '/staff', '/admin', '/settings', '/events', '/payments'];

        Log::warning('Client-side error reported', [
            'type' => $type,
            'route' => in_array($route, $allowedRoutes, true) ? $route : '/other',
            'role' => in_array($request->input('role'), ['resident', 'staff', 'admin'], true) ? $request->input('role') : 'unknown',
            'language' => in_array($request->input('language'), ['en', 'fil'], true) ? $request->input('language') : 'unknown',
        ]);

        return response()->json(['received' => true], 202);
    }

    public function register(Request $request): JsonResponse
    {
        $firstName = $this->clean($request->input('firstName'));
        $lastName = $this->clean($request->input('lastName'));
        $mobile = $this->clean($request->input('mobile'));
        $email = strtolower($this->clean($request->input('email')));
        $password = trim((string) $request->input('password', ''));
        $address = $this->clean($request->input('address', 'Barangay Legaspi, Tayug, Pangasinan'));
        $zone = $request->input('zone', 1);
        $zone = filter_var($zone, FILTER_VALIDATE_INT);
        $householdMembers = collect($request->input('householdMembers', []))
            ->take(12)
            ->map(fn ($member) => [
                'name' => $this->clean($member['name'] ?? ''),
                'relationship' => in_array($member['relationship'] ?? '', ['Parent', 'Sibling', 'Relative', 'Spouse', 'Child', 'Other'], true)
                    ? $member['relationship']
                    : 'Other',
            ])
            ->filter(fn ($member) => $member['name'] !== '')
            ->values()
            ->all();

        if (!$firstName || !$lastName || !$mobile || !$email || !$password) {
            return response()->json(['message' => 'Please complete all required fields.'], 400);
        }
        if (!preg_match('/^09\d{9}$/', $mobile) || !filter_var($email, FILTER_VALIDATE_EMAIL) || !$this->validPassword($password)) {
            return response()->json(['message' => 'Please enter a valid mobile number, email, and password with '.self::PASSWORD_REQUIREMENTS.'.'], 400);
        }
        if (!$address || $zone === false || $zone < 1 || $zone > 7) {
            return response()->json(['message' => 'Please provide a valid address and a zone from 1 to 7.'], 400);
        }
        if (DB::table('users')->where('mobile', $mobile)->exists()) {
            return response()->json(['message' => 'A resident with this mobile number already exists.'], 409);
        }
        if (DB::table('users')->whereRaw('LOWER(email) = ?', [$email])->exists()) {
            return response()->json(['message' => 'A resident with this email already exists.'], 409);
        }

        $id = (string) Str::uuid();
        $createdAt = now();
        DB::table('users')->insert([
            'id' => $id,
            'first_name' => $firstName,
            'last_name' => $lastName,
            'mobile' => $mobile,
            'email' => $email,
            'password_hash' => password_hash($password, PASSWORD_BCRYPT),
            'role' => 'resident',
            'household_id' => '2024-'.substr((string) floor(microtime(true) * 1000), -4),
            'family_members' => 4,
            'household_members' => json_encode($householdMembers),
            'status' => 'Pending Verification',
            'address' => $address,
            'zone' => $zone,
            'created_at' => $createdAt,
        ]);

        $user = DB::table('users')->where('id', $id)->first();
        $this->writeAudit(null, 'user.registered', 'user', $id, ['status' => 'Pending Verification']);
        $delivery = $this->sendDelivery([
            'event' => 'resident_registered',
            'recipient' => $email,
            'token' => null,
            'expiresAt' => null,
            'user' => $user,
            'title' => 'Account registered',
            'message' => 'Your account has been created and is waiting administrator approval.',
            'metadata' => ['status' => 'Pending Verification'],
        ]);

        return response()->json([
            'message' => 'Account created and is awaiting administrator approval.',
            'requiresApproval' => true,
            'user' => $this->publicUser($user),
            'deliveryStatus' => $delivery['deliveryStatus'],
        ], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $identifier = $this->clean($request->input('identifier'));
        $password = trim((string) $request->input('password', ''));
        if (!$identifier || !$password) {
            return response()->json(['message' => 'Identifier and password are required.'], 400);
        }

        $this->seedBootstrapAdmin($identifier);
        $user = $this->findUser($identifier);
        if (!$user || !password_verify($password, $user->password_hash)) {
            return response()->json(['message' => 'Invalid credentials.'], 401);
        }

        $role = strtolower((string) ($user->role ?: 'resident'));
        $approved = in_array($role, ['admin', 'staff'], true)
            || in_array($user->status, ['Administrator', 'On Duty', 'Active Resident'], true);
        if ($role === 'resident' && !$approved) {
            return response()->json(['message' => 'Your account is awaiting administrator approval before you can access the web app.'], 403);
        }

        if ((bool) $user->mfa_enabled && $user->mfa_secret) {
            $challenge = bin2hex(random_bytes(32));
            DB::table('mfa_challenges')->updateOrInsert(
                ['token_hash' => hash('sha256', $challenge)],
                ['user_id' => $user->id, 'expires_at' => now()->addMinutes(5), 'created_at' => now()]
            );

            return response()->json(['message' => 'Authenticator verification required.', 'requiresMfa' => true, 'challengeToken' => $challenge]);
        }

        return response()->json([
            'message' => 'Login successful',
            'token' => $this->createToken($user->id),
            'user' => $this->publicUser($user),
        ]);
    }

    public function loginMfa(Request $request): JsonResponse
    {
        $challengeToken = (string) $request->input('challengeToken', '');
        $code = trim((string) $request->input('code', ''));
        if ($challengeToken === '' || !preg_match('/^\d{6}$/', $code)) {
            return response()->json(['message' => 'A valid 6-digit authenticator code is required.'], 400);
        }

        $challenge = DB::table('mfa_challenges')
            ->where('token_hash', hash('sha256', $challengeToken))
            ->where('expires_at', '>', now())
            ->first();
        if (!$challenge) {
            return response()->json(['message' => 'MFA challenge is invalid or expired. Please sign in again.'], 401);
        }

        $user = DB::table('users')->where('id', $challenge->user_id)->first();
        if (!$user || !(bool) $user->mfa_enabled || !$user->mfa_secret || in_array($user->status, ['Suspended', 'Disabled'], true)) {
            return response()->json(['message' => 'MFA challenge is no longer valid.'], 401);
        }
        $secret = $this->decryptTotpSecret($user->mfa_secret);
        $step = $this->verifyTotp($secret, $code);
        if ($step === null || $step <= (int) $user->mfa_last_step) {
            return response()->json(['message' => 'The authenticator code is invalid or has already been used.'], 401);
        }

        DB::table('users')->where('id', $user->id)->update(['mfa_last_step' => $step]);
        DB::table('mfa_challenges')->where('token_hash', hash('sha256', $challengeToken))->delete();

        return response()->json([
            'message' => 'Login successful',
            'token' => $this->createToken($user->id),
            'user' => $this->publicUser($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $authorization = (string) $request->header('Authorization', '');
        $token = str_starts_with($authorization, 'Bearer ') ? substr($authorization, 7) : '';
        if ($token !== '') {
            DB::table('api_tokens')->where('token_hash', hash('sha256', $token))->delete();
        }

        return response()->json(['success' => true]);
    }

    public function profile(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->publicUser($request->attributes->get('actor'))]);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $firstName = $this->clean($request->input('firstName', $actor->firstName));
        $lastName = $this->clean($request->input('lastName', $actor->lastName));
        $email = strtolower($this->clean($request->input('email', $actor->email)));
        $mobile = $this->clean($request->input('mobile', $actor->mobile));
        $address = $this->clean($request->input('address', $actor->address));
        $householdId = $this->clean($request->input('householdId', $actor->householdId ?? '')) ?: null;
        $familyMembers = $request->input('familyMembers', $actor->familyMembers ?? 4);

        if (!$firstName || !$lastName) {
            return response()->json(['message' => 'First name and last name are required.'], 400);
        }
        if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['message' => 'Please enter a valid email.'], 400);
        }
        if ($mobile && !preg_match('/^09\d{9}$/', $mobile)) {
            return response()->json(['message' => 'Please enter a valid mobile number.'], 400);
        }
        if (DB::table('users')->whereRaw('LOWER(email) = ?', [$email])->where('id', '!=', $actor->id)->exists()) {
            return response()->json(['message' => 'A user with this email already exists.'], 409);
        }
        if (DB::table('users')->where('mobile', $mobile)->where('id', '!=', $actor->id)->exists()) {
            return response()->json(['message' => 'A user with this mobile number already exists.'], 409);
        }

        DB::table('users')->where('id', $actor->id)->update([
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $email,
            'mobile' => $mobile,
            'address' => $address,
            'household_id' => $householdId,
            'family_members' => max(0, (int) $familyMembers),
        ]);

        $user = DB::table('users')->where('id', $actor->id)->first();
        $this->writeAudit($actor, 'profile.updated', 'user', $actor->id);

        return response()->json(['user' => $this->publicUser($user)]);
    }

    public function dashboard(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $requests = $actor->role === 'resident'
            ? $this->requestsForUser($actor->id)
            : $this->allRequests();
        $announcements = $this->announcementList();

        return response()->json([
            'services' => self::SERVICES,
            'announcements' => $announcements,
            'events' => self::EVENTS,
            'payments' => $this->paymentList(),
            'summary' => [
                'totalRequests' => count($requests),
                'pending' => count(array_filter($requests, fn ($item) => $item['status'] !== 'Approved')),
                'activeCases' => count(array_filter($requests, fn ($item) => $item['status'] === 'Pending')),
                'nextEvent' => self::EVENTS[0],
            ],
            'user' => $this->publicUser($actor),
        ]);
    }

    public function services(): JsonResponse
    {
        return response()->json(['services' => self::SERVICES]);
    }

    public function events(): JsonResponse
    {
        return response()->json(['events' => self::EVENTS]);
    }

    public function announcements(): JsonResponse
    {
        return response()->json(['announcements' => $this->announcementList()]);
    }

    public function createAnnouncement(Request $request): JsonResponse
    {
        $title = $this->clean($request->input('title'));
        $content = $this->clean($request->input('content'));
        if (!$title || !$content) {
            return response()->json(['message' => 'Title and message are required.'], 400);
        }
        $channels = collect($request->input('socialChannels', []))
            ->filter(fn ($channel) => is_string($channel) && in_array($channel, ['facebook', 'instagram', 'x', 'messenger'], true))
            ->unique()
            ->values()
            ->all();
        $id = (string) Str::uuid();
        $createdAt = now();
        DB::table('announcements')->insert([
            'id' => $id,
            'tag' => $this->clean($request->input('tag', 'green')) ?: 'green',
            'title' => $title,
            'content' => $content,
            'date' => $this->clean($request->input('date')) ?: now()->format('n/j/Y'),
            'social_channels' => json_encode($channels),
            'created_at' => $createdAt,
        ]);
        $announcement = DB::table('announcements')->where('id', $id)->first();
        $this->writeAudit($request->attributes->get('actor'), 'announcement.created', 'announcement', $id);

        return response()->json(['announcement' => $this->announcementData($announcement)], 201);
    }

    public function deleteAnnouncement(Request $request, string $id): JsonResponse
    {
        $deleted = DB::table('announcements')->where('id', $id)->delete();
        if (!$deleted) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }
        $this->writeAudit($request->attributes->get('actor'), 'announcement.deleted', 'announcement', $id);

        return response()->json(['success' => true, 'removedId' => $id]);
    }

    public function payments(Request $request): JsonResponse
    {
        return response()->json(['payments' => $this->paymentList()]);
    }

    public function updatePayment(Request $request, string $id): JsonResponse
    {
        $status = $this->clean($request->input('status'));
        if (!$status) {
            return response()->json(['message' => 'Payment ID and status are required.'], 400);
        }
        $payment = DB::table('payments')->where('id', $id)->first();
        if (!$payment) {
            return response()->json(['message' => 'Payment record not found.'], 404);
        }
        DB::table('payments')->where('id', $id)->update(['status' => $status]);
        $this->writeAudit($request->attributes->get('actor'), 'payment.updated', 'payment', $id, ['status' => $status]);
        $payment->status = $status;

        return response()->json(['payment' => (array) $payment, 'message' => 'Payment status updated successfully.']);
    }

    public function createRequest(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        if ($actor->role === 'resident' && $actor->status !== 'Active Resident') {
            return response()->json(['message' => 'Your account is pending barangay verification. You can submit requests after an administrator approves your account.'], 403);
        }
        $type = $this->clean($request->input('type'));
        $purpose = $this->clean($request->input('purpose'));
        $deliveryMethod = strtolower($this->clean($request->input('deliveryMethod', 'online')));
        $deliveryNote = $this->clean($request->input('deliveryNote', ''));
        if (!$type || !$purpose) {
            return response()->json(['message' => 'Request type and purpose are required.'], 400);
        }
        if (!in_array($deliveryMethod, ['online', 'physical'], true)) {
            return response()->json(['message' => 'Delivery method must be online or physical.'], 400);
        }
        if (mb_strlen($deliveryNote) > 500) {
            return response()->json(['message' => 'Delivery note must be 500 characters or fewer.'], 400);
        }

        $id = (string) Str::uuid();
        $createdAt = now();
        DB::table('requests')->insert([
            'id' => $id,
            'user_id' => $actor->id,
            'type' => $type,
            'purpose' => $purpose,
            'notes' => $this->clean($request->input('notes', '')),
            'status' => 'Pending',
            'delivery_method' => $deliveryMethod,
            'delivery_note' => $deliveryNote,
            'follow_ups' => json_encode([]),
            'created_at' => $createdAt,
        ]);
        $saved = DB::table('requests')->where('id', $id)->first();
        $this->writeAudit($actor, 'request.created', 'request', $id);

        return response()->json(['request' => $this->requestData($saved, $actor)], 201);
    }

    public function requests(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');

        return response()->json(['requests' => $actor->role === 'resident' ? $this->requestsForUser($actor->id) : $this->allRequests()]);
    }

    public function staffRequests(): JsonResponse
    {
        return response()->json(['requests' => $this->allRequests()]);
    }

    public function updateRequestStatus(Request $request, string $id): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $status = $this->clean($request->input('status'));
        $allowed = ['Pending' => ['In Review', 'Approved', 'Rejected'], 'In Review' => ['Approved', 'Rejected'], 'Approved' => [], 'Rejected' => []];
        if (!in_array($status, ['Pending', 'Approved', 'Rejected', 'In Review'], true)) {
            return response()->json(['message' => 'Invalid status value.'], 400);
        }

        return DB::transaction(function () use ($actor, $id, $status, $allowed) {
            $existing = DB::table('requests')->where('id', $id)->lockForUpdate()->first();
            if (!$existing) {
                return response()->json(['message' => 'Request not found.'], 404);
            }
            if (!in_array($status, $allowed[$existing->status] ?? [], true)) {
                return response()->json(['message' => "Cannot change a {$existing->status} request to {$status}."], 409);
            }
            if ($status === 'Approved' && DB::table('approvals')->where('request_id', $id)->exists()) {
                return response()->json(['message' => 'This request has already been approved.'], 409);
            }
            DB::table('requests')->where('id', $id)->update(['status' => $status, 'updated_at' => now()]);
            $updated = DB::table('requests')->where('id', $id)->first();
            $user = DB::table('users')->where('id', $updated->user_id)->first();
            $requestData = $this->requestData($updated, $user);
            $this->writeAudit($actor, 'request.'.strtolower(str_replace(' ', '-', $status)), 'request', $id, ['previousStatus' => $existing->status]);

            if ($status !== 'Approved') {
                return response()->json(['request' => $requestData]);
            }
            $approval = [
                'id' => 'APP-'.substr((string) (int) (microtime(true) * 1000), -8),
                'requestId' => $id,
                'approvedBy' => $actor->id,
                'approvedByRole' => $actor->role,
                'dateApproved' => now()->toISOString(),
                'requestSnapshot' => $requestData,
            ];
            DB::table('approvals')->insert([
                'id' => $approval['id'],
                'request_id' => $id,
                'approved_by' => $actor->id,
                'approved_by_role' => $actor->role,
                'date_approved' => now(),
                'request_snapshot' => json_encode($requestData),
            ]);
            $archived = $this->archiveApprovalsBefore(7);

            return response()->json(['request' => $requestData, 'approval' => $approval, 'archive' => $archived]);
        });
    }

    public function createReminder(Request $request, string $id): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        if ($actor->role !== 'resident') {
            return response()->json(['message' => 'Resident account access is required.'], 403);
        }
        $owned = DB::table('requests')->where('id', $id)->where('user_id', $actor->id)->exists();
        if (!$owned) {
            return response()->json(['message' => 'Request not found.'], 404);
        }
        $scheduledAt = $request->input('scheduledAt');
        try {
            $scheduled = $scheduledAt ? \Illuminate\Support\Carbon::parse($scheduledAt) : null;
        } catch (Throwable) {
            $scheduled = null;
        }
        if (!$scheduled || $scheduled->isPast()) {
            return response()->json(['message' => 'Choose a future date and time for the reminder.'], 400);
        }
        $reminder = [
            'id' => (string) Str::uuid(),
            'requestId' => $id,
            'userId' => $actor->id,
            'scheduledAt' => $scheduled->toISOString(),
            'notified' => false,
            'createdAt' => now()->toISOString(),
        ];
        DB::table('reminders')->insert([
            'id' => $reminder['id'],
            'request_id' => $id,
            'user_id' => $actor->id,
            'scheduled_at' => $scheduled,
            'created_at' => now(),
        ]);

        return response()->json(['reminder' => $reminder], 201);
    }

    public function reminders(Request $request): JsonResponse
    {
        $dueOnly = strtolower((string) $request->query('due', '')) === 'true';
        $query = DB::table('reminders')->where('user_id', $request->attributes->get('actor')->id);
        if ($dueOnly) {
            $query->where('scheduled_at', '<=', now());
        }
        $rows = $query->orderBy('scheduled_at')->get();
        $reminders = $rows->map(fn ($row) => [
            'id' => $row->id,
            'requestId' => $row->request_id,
            'userId' => $row->user_id,
            'scheduledAt' => \Illuminate\Support\Carbon::parse($row->scheduled_at)->toISOString(),
            'notified' => false,
            'createdAt' => \Illuminate\Support\Carbon::parse($row->created_at)->toISOString(),
            'isDue' => $dueOnly,
        ])->all();

        return response()->json(['reminders' => $reminders]);
    }

    public function createFollowUp(Request $request, string $id): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $message = $this->clean($request->input('message'));
        if (!$message || mb_strlen($message) > 1000) {
            return response()->json(['message' => 'A follow-up message of 1 to 1000 characters is required.'], 400);
        }
        $item = DB::table('requests')->where('id', $id)->first();
        if (!$item) {
            return response()->json(['message' => 'Request not found.'], 404);
        }
        if ($actor->role === 'resident' && $item->user_id !== $actor->id) {
            return response()->json(['message' => 'Request not found.'], 404);
        }
        $followUps = ApiIdentity::decodeJson($item->follow_ups);
        $followUp = ['id' => (string) Str::uuid(), 'message' => $message, 'createdAt' => now()->toISOString()];
        $followUps[] = $followUp;
        DB::table('requests')->where('id', $id)->update(['follow_ups' => json_encode($followUps), 'updated_at' => now()]);
        $this->writeAudit($actor, 'request.follow_up', 'request', $id);

        return response()->json(['followUp' => $followUp, 'request' => $this->requestData(DB::table('requests')->where('id', $id)->first())], 201);
    }

    public function adminUsers(): JsonResponse
    {
        $users = DB::table('users')->orderBy('created_at')->get()
            ->filter(fn ($user) => !$this->isSyntheticUser($user))
            ->map(fn ($user) => $this->publicUser($user))
            ->values();

        return response()->json(['users' => $users]);
    }

    public function adminSummary(): JsonResponse
    {
        $users = DB::table('users')->get();

        return response()->json(['summary' => [
            'totalResidents' => $users->where('role', 'resident')->count(),
            'totalStaff' => $users->where('role', 'staff')->count(),
            'totalAdmins' => $users->where('role', 'admin')->count(),
            'totalRequests' => DB::table('requests')->count(),
            'pendingRequests' => DB::table('requests')->where('status', 'Pending')->count(),
        ]]);
    }

    public function auditLogs(Request $request): JsonResponse
    {
        $limit = min(500, max(1, (int) $request->query('limit', 100)));
        $logs = DB::table('audit_logs')->orderByDesc('created_at')->limit($limit)->get()->map(fn ($entry) => [
            'id' => $entry->id,
            'actorId' => $entry->actor_id,
            'actorRole' => $entry->actor_role,
            'action' => $entry->action,
            'targetType' => $entry->target_type,
            'targetId' => $entry->target_id,
            'metadata' => ApiIdentity::decodeJson($entry->metadata),
            'createdAt' => $entry->created_at,
        ]);

        return response()->json(['logs' => $logs]);
    }

    public function staffMembers(): JsonResponse
    {
        $staffMembers = DB::table('users')->where('role', 'staff')->orderBy('created_at')->get()->map(fn ($user) => [
            'id' => $user->id,
            'firstName' => $user->first_name,
            'lastName' => $user->last_name,
            'position' => $user->position ?: 'Staff',
            'availability' => $user->availability ?: 'Available',
            'email' => $user->email,
            'mobile' => $user->mobile,
            'status' => $user->status,
        ]);

        return response()->json(['staffMembers' => $staffMembers]);
    }

    public function createStaff(Request $request): JsonResponse
    {
        $firstName = $this->clean($request->input('firstName'));
        $lastName = $this->clean($request->input('lastName'));
        $email = strtolower($this->clean($request->input('email')));
        $mobile = $this->clean($request->input('mobile'));
        $password = trim((string) $request->input('password', ''));
        $position = $this->clean($request->input('position', 'Staff')) ?: 'Staff';
        $availability = $this->clean($request->input('availability', 'Available')) ?: 'Available';
        if (!$firstName || !$lastName || !$email || !$mobile || !$password) {
            return response()->json(['message' => 'Please complete all staff member fields.'], 400);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^09\d{9}$/', $mobile) || !$this->validPassword($password)) {
            return response()->json(['message' => 'Please enter a valid email, mobile number, and password with '.self::PASSWORD_REQUIREMENTS.'.'], 400);
        }
        if ($this->findUser($email) || $this->findUser($mobile)) {
            return response()->json(['message' => 'A staff member with this email or mobile already exists.'], 409);
        }

        $id = $this->insertUser([
            'firstName' => $firstName,
            'lastName' => $lastName,
            'email' => $email,
            'mobile' => $mobile,
            'password' => $password,
            'role' => 'staff',
            'status' => $this->clean($request->input('status', 'On Duty')) ?: 'On Duty',
            'position' => $position,
            'availability' => $availability,
            'householdId' => '2024-'.substr((string) floor(microtime(true) * 1000), -4),
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 0,
            'familyMembers' => 1,
        ]);
        $staff = DB::table('users')->where('id', $id)->first();
        $this->writeAudit($request->attributes->get('actor'), 'staff.created', 'user', $id, ['email' => $email]);

        return response()->json(['staffMember' => $this->publicUser($staff)], 201);
    }

    public function createAdmin(Request $request): JsonResponse
    {
        $firstName = $this->clean($request->input('firstName'));
        $lastName = $this->clean($request->input('lastName'));
        $email = strtolower($this->clean($request->input('email')));
        $mobile = $this->clean($request->input('mobile'));
        $password = trim((string) $request->input('password', ''));
        if (!$firstName || !$lastName || !$email || !$mobile || !$password) {
            return response()->json(['message' => 'First name, last name, email, mobile, and password are required.'], 400);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^09\d{9}$/', $mobile) || !$this->validPassword($password)) {
            return response()->json(['message' => 'Please provide valid account details and a password with '.self::PASSWORD_REQUIREMENTS.'.'], 400);
        }
        if ($this->findUser($email) || $this->findUser($mobile)) {
            return response()->json(['message' => 'A user with this email or mobile already exists.'], 409);
        }
        $id = $this->insertUser([
            'firstName' => $firstName,
            'lastName' => $lastName,
            'email' => $email,
            'mobile' => $mobile,
            'password' => $password,
            'role' => 'admin',
            'status' => 'Administrator',
            'position' => 'Administrator',
            'householdId' => '2024-'.substr((string) floor(microtime(true) * 1000), -4),
            'address' => 'Barangay Hall, Legaspi',
            'zone' => 0,
            'familyMembers' => 1,
        ]);
        $this->writeAudit($request->attributes->get('actor'), 'admin.created', 'user', $id, ['email' => $email]);

        return response()->json(['user' => $this->publicUser(DB::table('users')->where('id', $id)->first())], 201);
    }

    public function updateUser(Request $request, string $id): JsonResponse
    {
        $existing = DB::table('users')->where('id', $id)->first();
        if (!$existing) {
            return response()->json(['message' => 'User not found.'], 404);
        }
        $role = strtolower($this->clean($request->input('role', $existing->role ?: 'resident')));
        $firstName = $this->clean($request->input('firstName', $existing->first_name));
        $lastName = $this->clean($request->input('lastName', $existing->last_name));
        $email = strtolower($this->clean($request->input('email', $existing->email)));
        $mobile = $this->clean($request->input('mobile', $existing->mobile));
        $status = $this->clean($request->input('status', $existing->status ?: 'Active Resident'));
        $zone = $request->input('zone', $existing->zone);
        $position = $request->input('position', $existing->position);
        $availability = $request->input('availability', $existing->availability ?: 'Available');
        $address = $this->clean($request->input('address', $existing->address));
        $householdId = $this->clean($request->input('householdId', $existing->household_id ?? '')) ?: null;
        $familyMembers = $request->input('familyMembers', $existing->family_members ?? 4);

        if (!in_array($role, ['resident', 'staff', 'admin'], true)) {
            return response()->json(['message' => 'Invalid role.'], 400);
        }
        if (!$firstName || !$lastName) {
            return response()->json(['message' => 'First name and last name are required.'], 400);
        }
        if ($email && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['message' => 'Please enter a valid email.'], 400);
        }
        if ($mobile && !preg_match('/^09\d{9}$/', $mobile)) {
            return response()->json(['message' => 'Please enter a valid mobile number.'], 400);
        }
        if ($role === 'resident' && (!filter_var($zone, FILTER_VALIDATE_INT) || $zone < 1 || $zone > 7)) {
            return response()->json(['message' => 'Resident zone must be a number from 1 to 7.'], 400);
        }
        if (DB::table('users')->whereRaw('LOWER(email) = ?', [$email])->where('id', '!=', $id)->exists()) {
            return response()->json(['message' => 'A user with this email already exists.'], 409);
        }
        if (DB::table('users')->where('mobile', $mobile)->where('id', '!=', $id)->exists()) {
            return response()->json(['message' => 'A user with this mobile number already exists.'], 409);
        }

        DB::table('users')->where('id', $id)->update([
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $email,
            'mobile' => $mobile,
            'role' => $role,
            'status' => $status,
            'zone' => $zone === null ? null : (int) $zone,
            'position' => $position === null ? null : $this->clean($position),
            'availability' => $this->clean($availability),
            'address' => $address,
            'household_id' => $householdId,
            'family_members' => max(0, (int) $familyMembers),
        ]);
        $updated = DB::table('users')->where('id', $id)->first();
        $this->sendDelivery([
            'event' => 'account_status_updated',
            'recipient' => $updated->email,
            'token' => null,
            'expiresAt' => null,
            'user' => $updated,
            'title' => 'Account status updated',
            'message' => "Your barangay account status changed to {$updated->status}.",
            'metadata' => ['status' => $updated->status, 'role' => $updated->role],
        ]);
        $this->writeAudit($request->attributes->get('actor'), 'user.updated', 'user', $id, ['status' => $status, 'role' => $role]);

        return response()->json(['user' => $this->publicUser($updated)]);
    }

    public function deleteStaff(Request $request, string $id): JsonResponse
    {
        $target = DB::table('users')->where('id', $id)->first();
        if (!$target) {
            return response()->json(['message' => 'Staff member not found.'], 404);
        }
        if ($target->role === 'admin') {
            return response()->json(['message' => 'Administrators cannot be deleted from staff management.'], 403);
        }
        if ($target->role !== 'staff') {
            return response()->json(['message' => 'Only staff members can be deleted here.'], 400);
        }
        DB::table('users')->where('id', $id)->delete();
        $this->writeAudit($request->attributes->get('actor'), 'staff.deleted', 'user', $id);

        return response()->json(['success' => true, 'removedId' => $id]);
    }

    public function residentsByZone(): JsonResponse
    {
        $residents = DB::table('users')->where('role', 'resident')->orderBy('zone')->orderBy('last_name')->get()
            ->filter(fn ($user) => !$this->isSyntheticUser($user))
            ->map(fn ($user) => [
                'id' => $user->id,
                'firstName' => $user->first_name,
                'lastName' => $user->last_name,
                'email' => $user->email,
                'mobile' => $user->mobile,
                'zone' => $user->zone ?: 1,
                'householdId' => $user->household_id,
                'familyMembers' => $user->family_members,
                'status' => $user->status,
                'address' => $user->address,
            ])->values();

        return response()->json(['residents' => $residents]);
    }

    public function accessUsers(): JsonResponse
    {
        $users = DB::table('users')->orderBy('created_at')->get()
            ->filter(fn ($user) => !$this->isSyntheticUser($user))
            ->map(fn ($user) => [
                'id' => $user->id,
                'firstName' => $user->first_name,
                'lastName' => $user->last_name,
                'zone' => $user->zone,
                'createdAt' => $user->created_at,
            ])->values();

        return response()->json(['users' => $users]);
    }

    public function accessUser(string $id): JsonResponse
    {
        $user = DB::table('users')->where('id', $id)->first();
        if (!$user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        return response()->json(['user' => $this->publicUser($user)]);
    }

    public function reports(): JsonResponse
    {
        if (DB::table('reports')->count() === 0) {
            foreach ([
                ['RPT-001', 'Emergency', 'Fire Incident', 'Minor house fire reported in Zone 3', 'High', 3, 'Resolved', '2026-08-28 10:30:00'],
                ['RPT-002', 'Health', 'Medical Assistance Request', 'Senior citizen assisted with first aid', 'Medium', 1, 'Completed', '2026-08-27 14:15:00'],
            ] as [$id, $type, $title, $description, $severity, $zone, $status, $date]) {
                DB::table('reports')->insertOrIgnore([
                    'id' => $id,
                    'type' => $type,
                    'title' => $title,
                    'description' => $description,
                    'severity' => $severity,
                    'zone' => $zone,
                    'status' => $status,
                    'report_date' => $date,
                ]);
            }
        }
        $rows = DB::table('reports')->orderByDesc('report_date')->get()->map(fn ($report) => [
            'id' => $report->id,
            'type' => $report->type,
            'title' => $report->title,
            'description' => $report->description,
            'severity' => $report->severity,
            'zone' => $report->zone,
            'status' => $report->status,
            'date' => $report->report_date,
        ]);

        return response()->json(['reports' => $rows]);
    }

    public function createReport(Request $request): JsonResponse
    {
        $type = $this->clean($request->input('type'));
        $title = $this->clean($request->input('title'));
        if (!$type || !$title) {
            return response()->json(['message' => 'Type and title are required.'], 400);
        }
        $id = 'RPT-'.substr((string) (int) (microtime(true) * 1000), -6);
        $date = now();
        $report = [
            'id' => $id,
            'type' => $type,
            'title' => $title,
            'description' => $this->clean($request->input('description', '')),
            'severity' => $this->clean($request->input('severity', '')),
            'zone' => max(1, (int) $request->input('zone', 1)),
            'status' => 'Open',
            'date' => $date->toISOString(),
        ];
        DB::table('reports')->insert([
            'id' => $id,
            'type' => $type,
            'title' => $title,
            'description' => $report['description'],
            'severity' => $report['severity'],
            'zone' => $report['zone'],
            'status' => 'Open',
            'report_date' => $date,
        ]);
        $this->writeAudit($request->attributes->get('actor'), 'report.created', 'report', $id);

        return response()->json(['report' => $report], 201);
    }

    public function requestPasswordReset(Request $request): JsonResponse
    {
        $identifier = $this->clean($request->input('identifier'));
        if (!$identifier) {
            return response()->json(['message' => 'Account identifier is required.'], 400);
        }
        $user = $this->findUser($identifier);
        $genericMessage = 'If the account exists, reset instructions have been sent.';
        if (!$user) {
            return response()->json(['message' => $genericMessage]);
        }
        $token = bin2hex(random_bytes(32));
        $expiresAt = now()->addMinutes(15);
        DB::table('password_reset_tokens')->updateOrInsert(
            ['token_hash' => hash('sha256', $token)],
            ['user_id' => $user->id, 'expires_at' => $expiresAt, 'created_at' => now()]
        );
        $delivery = $this->sendDelivery([
            'event' => 'password_reset',
            'recipient' => $user->email,
            'token' => $token,
            'expiresAt' => $expiresAt->toISOString(),
            'user' => $user,
            'title' => 'Password reset requested',
            'message' => 'Use the reset code below to continue resetting your password.',
            'metadata' => ['expiresInMinutes' => 15],
        ]);
        if ($delivery['queued']) {
            return response()->json(['message' => $genericMessage, 'deliveryStatus' => 'queued']);
        }
        if (app()->environment('production')) {
            return response()->json(['message' => 'Password reset delivery is not configured. Please contact the barangay office.'], 503);
        }

        return response()->json([
            'message' => 'Development reset token generated.',
            'resetToken' => $token,
            'deliveryStatus' => $delivery['deliveryStatus'],
        ]);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $token = $this->clean($request->input('token'));
        $newPassword = trim((string) $request->input('newPassword', ''));
        if (!$token || !$this->validPassword($newPassword)) {
            return response()->json(['message' => 'A valid reset token and password with '.self::PASSWORD_REQUIREMENTS.' are required.'], 400);
        }
        $tokenHash = hash('sha256', $token);
        $reset = DB::table('password_reset_tokens')->where('token_hash', $tokenHash)->where('expires_at', '>', now())->first();
        if (!$reset) {
            DB::table('password_reset_tokens')->where('token_hash', $tokenHash)->delete();

            return response()->json(['message' => 'This reset token is invalid or expired.'], 400);
        }
        DB::transaction(function () use ($reset, $tokenHash, $newPassword) {
            DB::table('users')->where('id', $reset->user_id)->update(['password_hash' => password_hash($newPassword, PASSWORD_BCRYPT)]);
            DB::table('api_tokens')->where('user_id', $reset->user_id)->delete();
            DB::table('password_reset_tokens')->where('token_hash', $tokenHash)->delete();
        });
        $this->writeAudit(null, 'password.reset', 'user', $reset->user_id);

        return response()->json(['message' => 'Password reset successful. You can now log in.']);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $currentPassword = (string) $request->input('currentPassword', '');
        $newPassword = trim((string) $request->input('newPassword', ''));
        $user = DB::table('users')->where('id', $actor->id)->first();
        if (!$currentPassword || !$this->validPassword($newPassword)) {
            return response()->json(['message' => 'A current password and new password with '.self::PASSWORD_REQUIREMENTS.' are required.'], 400);
        }
        if ($currentPassword === $newPassword) {
            return response()->json(['message' => 'The new password must be different from the current password.'], 400);
        }
        if (!$user || !password_verify($currentPassword, $user->password_hash)) {
            return response()->json(['message' => 'Current password is incorrect.'], 401);
        }
        DB::table('users')->where('id', $actor->id)->update(['password_hash' => password_hash($newPassword, PASSWORD_BCRYPT)]);
        $this->writeAudit($actor, 'password.changed', 'user', $actor->id);

        return response()->json(['message' => 'Password changed successfully.']);
    }

    public function mfaSetup(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        if ($actor->mfaEnabled) {
            return response()->json(['message' => 'Authenticator MFA is already enabled.'], 409);
        }
        $secret = $this->encodeBase32(random_bytes(20));
        DB::table('users')->where('id', $actor->id)->update([
            'mfa_secret' => $this->encryptTotpSecret($secret),
            'mfa_last_step' => 0,
        ]);
        $label = rawurlencode('Barangay Legaspi:'.$actor->email);
        $uri = 'otpauth://totp/'.$label.'?'.http_build_query([
            'secret' => $secret,
            'issuer' => 'Barangay Legaspi',
            'algorithm' => 'SHA1',
            'digits' => '6',
            'period' => '30',
        ]);
        $this->writeAudit($actor, 'mfa.setup_started', 'user', $actor->id);

        return response()->json(['secret' => $secret, 'otpauthUrl' => $uri]);
    }

    public function mfaEnable(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $code = trim((string) $request->input('code', ''));
        if (!preg_match('/^\d{6}$/', $code)) {
            return response()->json(['message' => 'A valid 6-digit authenticator code is required.'], 400);
        }
        $user = DB::table('users')->where('id', $actor->id)->first();
        if (!$user || !$user->mfa_secret) {
            return response()->json(['message' => 'Start authenticator setup before enabling MFA.'], 400);
        }
        $step = $this->verifyTotp($this->decryptTotpSecret($user->mfa_secret), $code);
        if ($step === null) {
            return response()->json(['message' => 'The MFA code is invalid. Please try again.'], 400);
        }
        DB::table('users')->where('id', $actor->id)->update(['mfa_enabled' => true, 'mfa_last_step' => $step]);
        $this->writeAudit($actor, 'mfa.enabled', 'user', $actor->id);

        return response()->json(['message' => 'Authenticator MFA is enabled for this account.']);
    }

    public function mfaDisable(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $currentPassword = (string) $request->input('currentPassword', '');
        $code = trim((string) $request->input('code', ''));
        $user = DB::table('users')->where('id', $actor->id)->first();
        if (!$user || !password_verify($currentPassword, $user->password_hash)) {
            return response()->json(['message' => 'Current password is incorrect.'], 401);
        }
        if (!$user->mfa_enabled || !$user->mfa_secret || !$this->verifyTotp($this->decryptTotpSecret($user->mfa_secret), $code)) {
            return response()->json(['message' => 'The MFA code is invalid. Please try again.'], 400);
        }
        DB::table('users')->where('id', $actor->id)->update(['mfa_enabled' => false, 'mfa_secret' => null, 'mfa_last_step' => 0]);
        $this->writeAudit($actor, 'mfa.disabled', 'user', $actor->id);

        return response()->json(['message' => 'Authenticator MFA is disabled.']);
    }

    public function archiveUsersByZone(Request $request): JsonResponse
    {
        $users = DB::table('users')->orderBy('zone')->get();
        $groups = $users->filter(fn ($user) => $user->zone !== null && (int) $user->zone >= 1 && (int) $user->zone <= 7)
            ->groupBy(fn ($user) => (int) $user->zone);
        $archives = [];
        foreach ($groups as $zone => $zoneUsers) {
            $filename = "zone-{$zone}-users.json";
            $content = [
                'archivedAt' => now()->toISOString(),
                'zone' => (int) $zone,
                'total' => $zoneUsers->count(),
                'users' => $zoneUsers->map(fn ($user) => $this->publicUser($user))->values()->all(),
            ];
            $this->saveArchive($filename, 'zone-users', $content);
            $archives[] = ['zone' => (int) $zone, 'filename' => $filename, 'count' => $zoneUsers->count(), 'archivedAt' => $content['archivedAt']];
        }
        $this->writeAudit($request->attributes->get('actor'), 'users.archived_by_zone', 'archive', null, ['zones' => count($archives)]);

        return response()->json(['ok' => true, 'archives' => $archives]);
    }

    public function archiveApprovals(Request $request): JsonResponse
    {
        $days = max(0, (int) $request->input('days', 7));
        $result = $this->archiveApprovalsBefore($days);
        $this->writeAudit($request->attributes->get('actor'), 'approvals.archived', 'archive', $result['filename'], ['count' => $result['count']]);

        return response()->json(['archive' => $result]);
    }

    public function approvals(): JsonResponse
    {
        $approvals = DB::table('approvals')->whereNull('archived_at')->orderByDesc('date_approved')->get()->map(fn ($approval) => [
            'id' => $approval->id,
            'requestId' => $approval->request_id,
            'approvedBy' => $approval->approved_by,
            'approvedByRole' => $approval->approved_by_role,
            'dateApproved' => $approval->date_approved,
            'requestSnapshot' => ApiIdentity::decodeJson($approval->request_snapshot),
        ]);

        return response()->json(['approvals' => $approvals]);
    }

    public function archiveRequests(Request $request): JsonResponse
    {
        $days = max(0, (int) $request->input('days', 1));
        $cutoff = now()->subDays($days);
        $query = DB::table('requests')->whereIn('status', ['Approved', 'Rejected']);
        if ($days > 0) {
            $query->whereRaw('COALESCE(updated_at, created_at) <= ?', [$cutoff]);
        }
        $rows = $query->orderBy('created_at')->get();
        if ($rows->isEmpty()) {
            return response()->json(['archive' => ['count' => 0, 'filename' => null, 'archivedAt' => null]]);
        }
        $records = $rows->map(fn ($row) => $this->requestData($row))->values()->all();
        $filename = 'queue-approvals-'.now()->format('Y-m-d').'.json';
        $payload = ['archivedAt' => now()->toISOString(), 'archivedFor' => $days === 0 ? 'manual' : "{$days} day(s)", 'total' => count($records), 'records' => $records];
        $this->saveArchive($filename, 'queue-approvals', $payload);
        DB::table('requests')->whereIn('id', $rows->pluck('id'))->delete();
        $this->writeAudit($request->attributes->get('actor'), 'requests.archived', 'archive', $filename, ['count' => count($records)]);

        return response()->json(['archive' => ['count' => count($records), 'filename' => $filename, 'archivedAt' => $payload['archivedAt']]]);
    }

    public function staffArchives(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $query = DB::table('archives');
        if ($actor->role !== 'admin') {
            $query->where('category', 'queue-approvals');
        }
        $archives = $query->orderByDesc('created_at')->get()->map(fn ($archive) => [
            'name' => $archive->name,
            'size' => strlen(json_encode(ApiIdentity::decodeJson($archive->contents))),
            'mtime' => $archive->created_at,
        ]);

        return response()->json(['archives' => $archives]);
    }

    public function adminArchives(): JsonResponse
    {
        return $this->staffArchives(request());
    }

    public function staffArchiveFile(Request $request): JsonResponse|\Illuminate\Http\Response
    {
        $name = $this->archiveName($request->query('name'));
        if ($name instanceof JsonResponse) {
            return $name;
        }
        $actor = $request->attributes->get('actor');
        if ($actor->role !== 'admin' && !str_starts_with($name, 'queue-approvals-')) {
            return response()->json(['message' => 'This archive is not available to staff.'], 403);
        }

        return $this->downloadArchive($name);
    }

    public function adminArchiveFile(Request $request): JsonResponse|\Illuminate\Http\Response
    {
        $name = $this->archiveName($request->query('name'));
        if ($name instanceof JsonResponse) {
            return $name;
        }

        return $this->downloadArchive($name);
    }

    public function deleteStaffArchive(Request $request): JsonResponse
    {
        return $this->deleteArchive($request->query('name'));
    }

    public function deleteAdminArchive(Request $request): JsonResponse
    {
        return $this->deleteArchive($request->query('name'));
    }

    public function clearData(Request $request): JsonResponse
    {
        $keepAdmins = $request->input('keepAdmins', true) !== false;
        DB::transaction(function () use ($keepAdmins) {
            if ($keepAdmins) {
                DB::table('users')->whereNotIn('role', ['admin', 'staff'])->delete();
                DB::table('requests')->delete();
                DB::table('reminders')->delete();
            } else {
                DB::table('users')->delete();
            }
            DB::table('reports')->delete();
            DB::table('approvals')->delete();
        });
        $this->writeAudit($request->attributes->get('actor'), 'system.data_cleared', 'system', null, ['keepAdmins' => $keepAdmins]);

        return response()->json(['ok' => true]);
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

    private function findUser(string $identifier): ?object
    {
        return DB::table('users')
            ->where('mobile', $identifier)
            ->orWhereRaw('LOWER(email) = ?', [strtolower($identifier)])
            ->first();
    }

    private function insertUser(array $data): string
    {
        $id = (string) Str::uuid();
        DB::table('users')->insert([
            'id' => $id,
            'first_name' => $data['firstName'],
            'last_name' => $data['lastName'],
            'email' => $data['email'],
            'mobile' => $data['mobile'],
            'password_hash' => password_hash($data['password'], PASSWORD_BCRYPT),
            'role' => $data['role'],
            'household_id' => $data['householdId'] ?? null,
            'family_members' => $data['familyMembers'] ?? 1,
            'household_members' => json_encode([]),
            'status' => $data['status'] ?? 'Administrator',
            'address' => $data['address'] ?? 'Barangay Hall, Legaspi',
            'zone' => $data['zone'] ?? 0,
            'position' => $data['position'] ?? null,
            'availability' => $data['availability'] ?? 'Available',
            'created_at' => now(),
        ]);

        return $id;
    }

    private function seedBootstrapAdmin(string $identifier): void
    {
        $email = strtolower((string) env('ADMIN_EMAIL', 'admin@barangay.gov.ph'));
        $mobile = (string) env('ADMIN_MOBILE', '09999999999');
        if (!in_array(strtolower($identifier), [$email, strtolower($mobile)], true) || $this->findUser($email)) {
            return;
        }
        $password = (string) env('ADMIN_PASSWORD', app()->environment('local') ? 'AdminPass123' : '');
        if ($password === '') {
            return;
        }
        $this->insertUser([
            'firstName' => (string) env('ADMIN_FIRST_NAME', 'Carmen'),
            'lastName' => (string) env('ADMIN_LAST_NAME', 'Santos'),
            'email' => $email,
            'mobile' => $mobile,
            'password' => $password,
            'role' => 'admin',
            'status' => 'Administrator',
            'position' => 'Administrator',
            'householdId' => (string) env('ADMIN_HOUSEHOLD_ID', '2024-ADMIN'),
            'familyMembers' => (int) env('ADMIN_FAMILY_MEMBERS', 1),
            'address' => (string) env('ADMIN_ADDRESS', 'Barangay Hall, Legaspi'),
            'zone' => (int) env('ADMIN_ZONE', 0),
        ]);
    }

    private function createToken(string $userId): string
    {
        $token = bin2hex(random_bytes(32));
        DB::table('api_tokens')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(30),
            'created_at' => now(),
        ]);

        return $token;
    }

    private function publicUser(?object $user): ?array
    {
        if (!$user) {
            return null;
        }

        $safe = ApiIdentity::safeUser($user);
        unset($safe['password_hash'], $safe['passwordHash'], $safe['mfa_secret'], $safe['mfaSecret'], $safe['mfa_last_step']);

        return $safe;
    }

    private function isSyntheticUser(object $user): bool
    {
        $email = strtolower((string) ($user->email ?? ''));
        $searchable = strtolower(implode(' ', [
            $user->email ?? '',
            $user->first_name ?? '',
            $user->last_name ?? '',
            $user->mobile ?? '',
            $user->household_id ?? '',
            $user->status ?? '',
        ]));

        return (bool) ($user->is_test_account ?? false)
            || (bool) ($user->is_demo ?? false)
            || preg_match('/@test\./', $email)
            || preg_match('/generated|dummy|demo\b|test account|2024-test|household.*test/', $searchable);
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

    private function sendDelivery(array $payload): array
    {
        $url = (string) (env('RESET_DELIVERY_URL') ?: env('NOTIFICATION_WEBHOOK_URL') ?: '');
        if ($url === '') {
            return ['queued' => false, 'deliveryStatus' => 'disabled'];
        }
        try {
            $response = Http::timeout(10)->acceptJson()->post($url, [
                ...$payload,
                'userId' => $payload['user']->id ?? null,
                'email' => $payload['user']->email ?? null,
                'mobile' => $payload['user']->mobile ?? null,
                'sentAt' => now()->toISOString(),
            ]);
            if (!$response->successful()) {
                Log::warning('Delivery webhook returned an error response', ['status' => $response->status()]);

                return ['queued' => false, 'deliveryStatus' => 'failed'];
            }

            return ['queued' => true, 'deliveryStatus' => 'queued'];
        } catch (Throwable $error) {
            Log::error('Delivery webhook request failed', ['message' => $error->getMessage()]);

            return ['queued' => false, 'deliveryStatus' => 'failed'];
        }
    }

    private function requestData(?object $row, ?object $user = null): ?array
    {
        if (!$row) {
            return null;
        }
        $followUps = ApiIdentity::decodeJson($row->follow_ups ?? []);
        $data = [
            'id' => $row->id,
            'userId' => $row->user_id,
            'user_id' => $row->user_id,
            'type' => $row->type,
            'purpose' => $row->purpose,
            'notes' => $row->notes,
            'status' => $row->status,
            'deliveryMethod' => $row->delivery_method ?? 'online',
            'deliveryNote' => $row->delivery_note ?? '',
            'followUps' => $followUps,
            'date' => $row->created_at,
            'createdAt' => $row->created_at,
            'updatedAt' => $row->updated_at,
        ];
        if ($user) {
            $data['firstName'] = $user->first_name ?? '';
            $data['lastName'] = $user->last_name ?? '';
            $data['first_name'] = $user->first_name ?? '';
            $data['last_name'] = $user->last_name ?? '';
            $data['mobile'] = $user->mobile ?? '';
            $data['email'] = $user->email ?? '';
            $data['zone'] = $user->zone ?? null;
        }

        return $data;
    }

    private function requestsForUser(string $userId): array
    {
        return DB::table('requests')->where('user_id', $userId)->orderByDesc('created_at')->get()
            ->map(fn ($row) => $this->requestData($row))
            ->all();
    }

    private function allRequests(): array
    {
        return DB::table('requests')
            ->leftJoin('users', 'users.id', '=', 'requests.user_id')
            ->select('requests.*', 'users.first_name', 'users.last_name', 'users.mobile', 'users.email', 'users.zone')
            ->orderByDesc('requests.created_at')
            ->get()
            ->map(fn ($row) => $this->requestData($row, $row))
            ->all();
    }

    private function announcementData(?object $row): ?array
    {
        if (!$row) {
            return null;
        }

        return [
            'id' => $row->id,
            'tag' => $row->tag,
            'title' => $row->title,
            'content' => $row->content,
            'date' => $row->date,
            'socialChannels' => ApiIdentity::decodeJson($row->social_channels ?? $row->socialChannels ?? []),
            'createdAt' => $row->created_at ?? $row->createdAt ?? null,
        ];
    }

    private function announcementList(): array
    {
        if (DB::table('announcements')->count() === 0) {
            foreach (self::SAMPLE_ANNOUNCEMENTS as $index => $item) {
                DB::table('announcements')->insertOrIgnore([
                    'id' => (string) Str::uuid(),
                    'tag' => $item['tag'],
                    'title' => $item['title'],
                    'content' => $item['content'],
                    'date' => $item['date'],
                    'social_channels' => json_encode($item['socialChannels']),
                    'created_at' => now()->subSeconds($index),
                ]);
            }
        }

        return DB::table('announcements')->orderByDesc('created_at')->get()
            ->map(fn ($row) => $this->announcementData($row))
            ->all();
    }

    private function paymentList(): array
    {
        return DB::table('payments')->orderBy('id')->get()->map(fn ($payment) => [
            'id' => $payment->id,
            'label' => $payment->label,
            'status' => $payment->status ?: 'Pending',
            'amount' => $payment->amount,
        ])->all();
    }

    private function saveArchive(string $name, string $category, array $contents): void
    {
        DB::table('archives')->updateOrInsert(
            ['name' => $name],
            ['id' => (string) Str::uuid(), 'category' => $category, 'contents' => json_encode($contents), 'created_at' => now()]
        );
    }

    private function archiveName(mixed $value): string|JsonResponse
    {
        $name = is_string($value) ? $value : '';
        if ($name === '' || str_contains($name, '..') || !preg_match('/^[\w\-.]+$/', $name)) {
            return response()->json(['message' => 'Invalid file name.'], 400);
        }
        if (!DB::table('archives')->where('name', $name)->exists()) {
            return response()->json(['message' => 'File not found.'], 404);
        }

        return $name;
    }

    private function downloadArchive(string $name): \Illuminate\Http\Response
    {
        $archive = DB::table('archives')->where('name', $name)->first();

        return response(json_encode(ApiIdentity::decodeJson($archive->contents), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 200, [
            'Content-Type' => 'application/json',
            'Content-Disposition' => 'attachment; filename="'.$name.'"',
        ]);
    }

    private function deleteArchive(mixed $value): JsonResponse
    {
        $name = $this->archiveName($value);
        if ($name instanceof JsonResponse) {
            return $name;
        }
        DB::table('archives')->where('name', $name)->delete();

        return response()->json(['ok' => true, 'deleted' => $name]);
    }

    private function archiveApprovalsBefore(int $days): array
    {
        $query = DB::table('approvals')->whereNull('archived_at');
        if ($days > 0) {
            $query->where('date_approved', '<=', now()->subDays($days));
        }
        $old = $query->orderBy('date_approved')->get();
        if ($old->isEmpty()) {
            return ['count' => 0, 'filename' => null];
        }
        $records = $old->map(fn ($item) => [
            'id' => $item->id,
            'requestId' => $item->request_id,
            'approvedBy' => $item->approved_by,
            'approvedByRole' => $item->approved_by_role,
            'dateApproved' => $item->date_approved,
            'requestSnapshot' => ApiIdentity::decodeJson($item->request_snapshot),
        ])->all();
        $dates = $old->map(fn ($item) => \Illuminate\Support\Carbon::parse($item->date_approved));
        $filename = 'approvals-'.$dates->min()->format('Y-m-d').'_to_'.$dates->max()->format('Y-m-d').'.json';
        $this->saveArchive($filename, 'approvals', $records);
        DB::table('approvals')->whereIn('id', $old->pluck('id'))->update(['archived_at' => now()]);

        return ['count' => count($records), 'filename' => $filename];
    }

    private function encodeBase32(string $value): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $buffer = 0;
        $bits = 0;
        $output = '';
        foreach (unpack('C*', $value) as $byte) {
            $buffer = ($buffer << 8) | $byte;
            $bits += 8;
            while ($bits >= 5) {
                $output .= $alphabet[($buffer >> ($bits - 5)) & 31];
                $bits -= 5;
            }
        }
        if ($bits > 0) {
            $output .= $alphabet[($buffer << (5 - $bits)) & 31];
        }

        return $output;
    }

    private function decodeBase32(string $value): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $buffer = 0;
        $bits = 0;
        $output = '';
        foreach (str_split(strtoupper(rtrim($value, '='))) as $character) {
            $digit = strpos($alphabet, $character);
            if ($digit === false) {
                throw new \RuntimeException('Invalid Base32 secret.');
            }
            $buffer = (($buffer << 5) | $digit) & 0xffff;
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $output .= chr(($buffer >> $bits) & 0xff);
            }
        }

        return $output;
    }

    private function encryptTotpSecret(string $secret): string
    {
        $configuredKey = (string) config('app.mfa_encryption_key');
        $version = $configuredKey === '' ? 'v1' : 'v2';
        $key = hash('sha256', $configuredKey !== '' ? $configuredKey : (string) config('app.jwt_secret'), true);
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($secret, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($ciphertext === false) {
            throw new \RuntimeException('Unable to protect authenticator secret.');
        }

        return $version.'.'.rtrim(strtr(base64_encode($iv), '+/', '-_'), '=').'.'.rtrim(strtr(base64_encode($tag), '+/', '-_'), '=').'.'.rtrim(strtr(base64_encode($ciphertext), '+/', '-_'), '=');
    }

    private function decryptTotpSecret(string $value): string
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
        $encryptionSecret = $parts[0] === 'v1'
            ? (string) config('app.jwt_secret')
            : (string) config('app.mfa_encryption_key');
        if ($encryptionSecret === '') {
            throw new \RuntimeException('MFA encryption key is not configured.');
        }
        $secret = openssl_decrypt($ciphertext, 'aes-256-gcm', hash('sha256', $encryptionSecret, true), OPENSSL_RAW_DATA, $iv, $tag);
        $previousKeys = array_filter(array_map(
            'trim',
            explode(',', (string) config('app.mfa_encryption_key_previous'))
        ));
        if ($secret === false && $parts[0] === 'v2') {
            foreach ($previousKeys as $previousKey) {
                if (hash_equals($encryptionSecret, $previousKey)) {
                    continue;
                }
                $secret = openssl_decrypt($ciphertext, 'aes-256-gcm', hash('sha256', $previousKey, true), OPENSSL_RAW_DATA, $iv, $tag);
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
        if (!preg_match('/^\d{6}$/', $code)) {
            return null;
        }
        $key = $this->decodeBase32($secret);
        $current = (int) floor(time() / 30);
        foreach ([$current - 1, $current, $current + 1] as $step) {
            $counter = pack('N2', ($step >> 32) & 0xffffffff, $step & 0xffffffff);
            $digest = hash_hmac('sha1', $counter, $key, true);
            $offset = ord($digest[strlen($digest) - 1]) & 0x0f;
            $binary = ((ord($digest[$offset]) & 0x7f) << 24)
                | ((ord($digest[$offset + 1]) & 0xff) << 16)
                | ((ord($digest[$offset + 2]) & 0xff) << 8)
                | (ord($digest[$offset + 3]) & 0xff);
            $expected = str_pad((string) ($binary % 1_000_000), 6, '0', STR_PAD_LEFT);
            if (hash_equals($expected, $code)) {
                return $step;
            }
        }

        return null;
    }
}
