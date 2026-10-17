<?php

namespace App\Http\Controllers;

use App\Support\ApiIdentity;
use App\Support\ResidentRegistryData;
use Aws\S3\PostObjectV4;
use Aws\S3\S3Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\RedirectResponse;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Collection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Str;
use Throwable;

class ApiController extends Controller
{
    private const PASSWORD_REQUIREMENTS = 'at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special character';
    private const REGISTRY_MARITAL_STATUSES = ['Single', 'Married', 'Widowed', 'Live-in', 'Divorced', 'Annulled', 'Separate'];
    private const CAPTAIN_PHOTO_KEY = 'official/captain-portrait';
    private const CAPTAIN_PHOTO_PENDING_PREFIX = 'official/captain-portrait/pending/';
    private const CAPTAIN_PHOTO_MAX_BYTES = 5242880;
    private const CAPTAIN_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    private const SERVICES = [
        ['icon' => '📄', 'title' => 'Barangay Certificate', 'subtitle' => 'Request and claim', 'tone' => 'green'],
        ['icon' => '🏥', 'title' => 'Health Assistance', 'subtitle' => 'Access public health support', 'tone' => 'blue'],
        ['icon' => '🧾', 'title' => 'Barangay Clearance', 'subtitle' => 'Update and renew', 'tone' => 'amber'],
        ['icon' => '🚨', 'title' => 'Emergency Help', 'subtitle' => 'Call for immediate support', 'tone' => 'red'],
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
            'message' => 'Your account has been created and is waiting for barangay Staff review.',
            'metadata' => ['status' => 'Pending Verification'],
        ]);

        return response()->json([
            'message' => 'Account created and is awaiting barangay Staff review.',
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
        if (in_array($user->status, ['Suspended', 'Disabled'], true)) {
            return response()->json(['message' => 'Your account is disabled. Please contact the barangay office for assistance.'], 403);
        }
        $approved = in_array($role, ['admin', 'staff'], true)
            || in_array($user->status, ['Administrator', 'On Duty', 'Active Resident'], true);
        if ($role === 'resident' && !$approved) {
            return response()->json(['message' => 'Your account is awaiting barangay Staff review before you can access the web app.'], 403);
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

        $result = DB::transaction(function () use ($challengeToken, $code) {
            $challengeHash = hash('sha256', $challengeToken);
            $challenge = DB::table('mfa_challenges')
                ->where('token_hash', $challengeHash)
                ->where('expires_at', '>', now())
                ->lockForUpdate()
                ->first();
            if (!$challenge) {
                return response()->json(['message' => 'MFA challenge is invalid or expired. Please sign in again.'], 401);
            }

            $user = DB::table('users')->where('id', $challenge->user_id)->lockForUpdate()->first();
            if (!$user || !(bool) $user->mfa_enabled || !$user->mfa_secret || in_array($user->status, ['Suspended', 'Disabled'], true)) {
                return response()->json(['message' => 'MFA challenge is no longer valid.'], 401);
            }
            $step = $this->verifyTotp($this->decryptTotpSecret($user->mfa_secret), $code);
            if ($step === null || $step <= (int) $user->mfa_last_step) {
                return response()->json(['message' => 'The authenticator code is invalid or has already been used.'], 401);
            }

            DB::table('users')->where('id', $user->id)->update(['mfa_last_step' => $step]);
            DB::table('mfa_challenges')->where('token_hash', $challengeHash)->delete();

            return $user;
        });
        if ($result instanceof JsonResponse) {
            return $result;
        }

        return response()->json([
            'message' => 'Login successful',
            'token' => $this->createToken($result->id),
            'user' => $this->publicUser($result),
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
        $events = [];

        return response()->json([
            'services' => self::SERVICES,
            'announcements' => $announcements,
            'events' => $events,
            'payments' => $this->paymentList(),
            'summary' => [
                'totalRequests' => count($requests),
                'pending' => count(array_filter($requests, fn ($item) => $item['status'] !== 'Approved')),
                'activeCases' => count(array_filter($requests, fn ($item) => $item['status'] === 'Pending')),
                'nextEvent' => $events[0] ?? null,
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
        return response()->json(['events' => []]);
    }

    public function captainPhoto(): RedirectResponse|\Illuminate\Http\Response|JsonResponse
    {
        if (!$this->captainPhotoStorageConfigured()) {
            return response('', 404)
                ->header('Cross-Origin-Resource-Policy', 'cross-origin')
                ->header('Cache-Control', 'no-store');
        }
        try {
            $disk = Storage::disk('s3');
            if (!$disk->exists(self::CAPTAIN_PHOTO_KEY)) {
                return response('', 404)
                    ->header('Cross-Origin-Resource-Policy', 'cross-origin')
                    ->header('Cache-Control', 'no-store');
            }

            return redirect()->away($disk->temporaryUrl(self::CAPTAIN_PHOTO_KEY, now()->addMinutes(15)))
                ->header('Cross-Origin-Resource-Policy', 'cross-origin')
                ->header('Cache-Control', 'no-store');
        } catch (Throwable $error) {
            Log::error('Captain photo could not be loaded from object storage', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to load the captain photo.'], 502)
                ->header('Cross-Origin-Resource-Policy', 'cross-origin')
                ->header('Cache-Control', 'no-store');
        }
    }

    public function captainPhotoUploadUrl(Request $request): JsonResponse
    {
        $contentType = $request->input('contentType');
        if (!in_array($contentType, self::CAPTAIN_PHOTO_CONTENT_TYPES, true)) {
            return response()->json(['message' => 'Choose a JPEG, PNG, or WebP image.'], 400);
        }
        if (!$this->captainPhotoStorageConfigured()) {
            return response()->json(['message' => 'Image storage is not configured for this API.'], 503);
        }
        try {
            $bucket = (string) config('filesystems.disks.s3.bucket');
            $key = self::CAPTAIN_PHOTO_PENDING_PREFIX.Str::uuid();
            $client = new S3Client([
                'version' => 'latest',
                'region' => config('filesystems.disks.s3.region'),
                'endpoint' => config('filesystems.disks.s3.endpoint') ?: null,
                'use_path_style_endpoint' => (bool) config('filesystems.disks.s3.use_path_style_endpoint'),
                'credentials' => [
                    'key' => config('filesystems.disks.s3.key'),
                    'secret' => config('filesystems.disks.s3.secret'),
                ],
            ]);
            $post = new PostObjectV4($client, $bucket, [
                'key' => $key,
                'Content-Type' => $contentType,
                'success_action_status' => '201',
            ], [
                ['bucket' => $bucket],
                ['eq', '$key', $key],
                ['eq', '$Content-Type', $contentType],
                ['eq', '$success_action_status', '201'],
                ['content-length-range', 1, self::CAPTAIN_PHOTO_MAX_BYTES],
            ], '+5 minutes');

            return response()->json([
                'url' => $post->getFormAttributes()['action'],
                'fields' => $post->getFormInputs(),
                'key' => $key,
            ]);
        } catch (Throwable $error) {
            Log::error('Captain photo upload URL could not be created', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to prepare the image upload.'], 502);
        }
    }

    public function finalizeCaptainPhoto(Request $request): JsonResponse
    {
        if (!$this->captainPhotoStorageConfigured()) {
            return response()->json(['message' => 'Image storage is not configured for this API.'], 503);
        }
        $key = $request->input('key');
        if (!is_string($key) || !preg_match(
            '#^'.preg_quote(self::CAPTAIN_PHOTO_PENDING_PREFIX, '#').'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$#i',
            $key
        )) {
            return response()->json(['message' => 'Invalid image upload.'], 400);
        }

        try {
            $disk = Storage::disk('s3');
            if (!$disk->exists($key)) {
                return response()->json(['message' => 'Uploaded image was not found.'], 400);
            }
            $contentType = $disk->mimeType($key);
            $size = $disk->size($key);
            if (!in_array($contentType, self::CAPTAIN_PHOTO_CONTENT_TYPES, true)
                || $size < 1 || $size > self::CAPTAIN_PHOTO_MAX_BYTES) {
                $disk->delete($key);

                return response()->json(['message' => 'Upload must be a supported image of 5 MB or smaller.'], 400);
            }
            $stream = $disk->readStream($key);
            if (!is_resource($stream)) {
                throw new \RuntimeException('Unable to read uploaded image bytes.');
            }
            try {
                $signature = fread($stream, 12);
            } finally {
                fclose($stream);
            }
            if (!$this->hasCaptainPhotoSignature($signature, $contentType)) {
                $disk->delete($key);

                return response()->json(['message' => 'Uploaded file is not a valid supported image.'], 400);
            }
            $disk->move($key, self::CAPTAIN_PHOTO_KEY);
            $this->writeAudit($request->attributes->get('actor'), 'captain-photo.updated', 'image', self::CAPTAIN_PHOTO_KEY);
        } catch (Throwable $error) {
            Log::error('Captain photo upload could not be verified', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to verify the uploaded image.'], 502);
        }

        return response()->json(['ok' => true]);
    }

    public function deleteCaptainPhoto(Request $request): JsonResponse
    {
        if (!$this->captainPhotoStorageConfigured()) {
            return response()->json(['message' => 'Image storage is not configured for this API.'], 503);
        }
        try {
            Storage::disk('s3')->delete(self::CAPTAIN_PHOTO_KEY);
            $this->writeAudit($request->attributes->get('actor'), 'captain-photo.deleted', 'image', self::CAPTAIN_PHOTO_KEY);
        } catch (Throwable $error) {
            Log::error('Captain photo could not be deleted from object storage', ['exception' => $error::class]);

            return response()->json(['message' => 'Unable to delete the captain photo.'], 502);
        }

        return response()->json(['ok' => true]);
    }

    public function announcements(): JsonResponse
    {
        return response()->json(['announcements' => $this->announcementList()]);
    }

    public function createAnnouncement(Request $request): JsonResponse
    {
        $title = $this->clean($request->input('title'));
        $content = $this->clean($request->input('content'));
        $tag = $this->clean($request->input('tag', 'green')) ?: 'green';
        $date = $this->clean($request->input('date')) ?: now()->toDateString();
        $channels = $request->input('socialChannels', []);

        if (!$title || !$content || mb_strlen($title) > 200 || mb_strlen($content) > 10000
            || mb_strlen($tag) > 30 || mb_strlen($date) > 100 || !is_array($channels)
            || count($channels) > 20) {
            return response()->json(['message' => 'A valid title, message, and announcement details are required.'], 400);
        }
        foreach ($channels as $channel) {
            if (!is_string($channel) || mb_strlen($channel) > 80) {
                return response()->json(['message' => 'Invalid social channel.'], 400);
            }
        }

        $id = (string) Str::uuid();
        $createdAt = now();
        DB::transaction(function () use ($id, $title, $content, $tag, $date, $channels, $createdAt, $request) {
            DB::table('announcements')->insert([
                'id' => $id,
                'tag' => $tag,
                'title' => $title,
                'content' => $content,
                'date' => $date,
                'social_channels' => json_encode(array_values($channels)),
                'created_at' => $createdAt,
            ]);
            $this->writeAudit($request->attributes->get('actor'), 'announcement.created', 'announcement', $id);
        });

        return response()->json([
            'announcement' => $this->announcementData(DB::table('announcements')->where('id', $id)->first()),
        ], 201);
    }

    public function deleteAnnouncement(Request $request, string $id): JsonResponse
    {
        $deleted = DB::transaction(function () use ($request, $id) {
            $announcement = DB::table('announcements')->where('id', $id)->lockForUpdate()->first();
            if (!$announcement) {
                return false;
            }
            DB::table('announcements')->where('id', $id)->delete();
            $this->writeAudit($request->attributes->get('actor'), 'announcement.deleted', 'announcement', $id);

            return true;
        });
        if (!$deleted) {
            return response()->json(['message' => 'Announcement not found.'], 404);
        }

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
            return response()->json(['message' => 'Your account is pending barangay verification. You can submit requests after Staff approves your account.'], 403);
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
            'status_history' => json_encode([[
                'id' => (string) Str::uuid(),
                'kind' => 'status',
                'status' => 'Pending',
                'note' => '',
                'createdAt' => $createdAt->toISOString(),
                'actorRole' => $actor->role,
                'actorName' => trim($actor->firstName.' '.$actor->lastName),
            ]]),
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

    public function staffDashboardRequests(Request $request): JsonResponse
    {
        $search = $request->query('search', '');
        $status = $request->query('status', 'active');
        $type = $request->query('type', '');
        $zone = $request->query('zone', '');
        $from = $request->query('from', '');
        $to = $request->query('to', '');
        $sort = $request->query('sort', 'date');
        $direction = $request->query('direction', 'desc');
        $pageInput = $request->query('page', 1);
        $pageSizeInput = $request->query('pageSize', 10);
        $page = is_string($pageInput) || is_int($pageInput) ? filter_var($pageInput, FILTER_VALIDATE_INT) : false;
        $pageSize = is_string($pageSizeInput) || is_int($pageSizeInput) ? filter_var($pageSizeInput, FILTER_VALIDATE_INT) : false;

        if (!is_string($search) || !is_string($status) || !is_string($type) || !is_string($zone)
            || !is_string($from) || !is_string($to) || !is_string($sort) || !is_string($direction)) {
            return response()->json(['message' => 'Invalid request filters.'], 400);
        }
        if (mb_strlen($search) > 120 || mb_strlen($type) > 100) {
            return response()->json(['message' => 'Search text or document type is too long.'], 400);
        }
        if ($zone !== '' && !in_array($zone, ['1', '2', '3', '4', '5', '6', '7'], true)) {
            return response()->json(['message' => 'Invalid request zone filter.'], 400);
        }
        if (!in_array($status, ['active', 'all', 'Pending', 'In Review', 'Needs Information', 'Approved', 'Rejected'], true)) {
            return response()->json(['message' => 'Invalid request status filter.'], 400);
        }
        if (!in_array($sort, ['date', 'status'], true) || !in_array($direction, ['asc', 'desc'], true)) {
            return response()->json(['message' => 'Invalid request sort field or direction.'], 400);
        }
        if (($from !== '' && !$this->isValidReportDate($from))
            || ($to !== '' && !$this->isValidReportDate($to))
            || ($from !== '' && $to !== '' && $from > $to)) {
            return response()->json(['message' => 'Invalid request date range.'], 400);
        }
        if ($page === false || $page < 1 || $page > 100000
            || $pageSize === false || $pageSize < 1 || $pageSize > 50) {
            return response()->json(['message' => 'Invalid pagination values.'], 400);
        }

        $query = DB::table('requests')
            ->join('users', 'users.id', '=', 'requests.user_id');
        if ($search !== '') {
            $needle = '%'.mb_strtolower(trim($search)).'%';
            $query->where(function ($query) use ($needle) {
                foreach (['CAST(requests.id AS TEXT)', 'requests.type', 'requests.purpose', 'users.first_name', 'users.last_name'] as $column) {
                    $query->orWhereRaw("LOWER({$column}) LIKE ?", [$needle]);
                }
            });
        }
        if ($status === 'active') {
            $query->whereNotIn('requests.status', ['Approved', 'Rejected']);
        } elseif ($status !== 'all') {
            $query->where('requests.status', $status);
        }
        if ($type !== '') {
            $query->where('requests.type', $type);
        }
        if ($zone !== '') {
            $query->where('users.zone', (int) $zone);
        }
        $this->applyManilaDateFilter($query, 'requests.created_at', $from, $to);

        $total = (int) (clone $query)->count('requests.id');
        $rows = (clone $query)
            ->select('requests.*', 'users.first_name', 'users.last_name', 'users.mobile', 'users.email', 'users.zone')
            ->orderBy($sort === 'status' ? 'requests.status' : 'requests.created_at', $direction)
            ->orderBy('requests.id')
            ->offset(($page - 1) * $pageSize)
            ->limit($pageSize)
            ->get()
            ->map(fn ($row) => $this->requestData($row, $row))
            ->all();

        $summary = DB::table('requests')->selectRaw(
            "COUNT(*) AS total,
            SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'In Review' THEN 1 ELSE 0 END) AS in_review,
            SUM(CASE WHEN status = 'Needs Information' THEN 1 ELSE 0 END) AS needs_information,
            SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected"
        )->first();

        return response()->json([
            'requests' => $rows,
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'documentTypes' => DB::table('requests')->whereNotNull('type')->distinct()->orderBy('type')->pluck('type'),
            'summary' => [
                'total' => (int) $summary->total,
                'pending' => (int) $summary->pending,
                'inReview' => (int) $summary->in_review,
                'needsInformation' => (int) $summary->needs_information,
                'approved' => (int) $summary->approved,
                'rejected' => (int) $summary->rejected,
                'deadlineTracking' => false,
                'releaseTracking' => false,
            ],
        ]);
    }

    public function staffReports(Request $request): JsonResponse
    {
        $filters = $this->staffReportFilters($request);
        if ($filters instanceof JsonResponse) {
            return $filters;
        }
        $requests = $this->staffReportRequests();

        return response()->json($this->staffRequestReport($requests, $filters));
    }

    public function exportStaffReports(Request $request): \Illuminate\Http\Response|JsonResponse
    {
        $filters = $this->staffReportFilters($request);
        if ($filters instanceof JsonResponse) {
            return $filters;
        }
        $requests = $this->filterStaffReportRequests($this->staffReportRequests(), $filters);
        $headers = ['Request reference', 'Request type', 'Submitted at', 'Current status', 'Decision status', 'Decision date'];
        $rows = array_map(function ($item) {
            $decision = $this->lastRequestDecision($item['statusHistory']);
            return [
                $item['id'],
                $item['type'],
                $item['date'],
                $item['status'],
                $decision['status'] ?? '',
                isset($decision['timestamp']) ? \Illuminate\Support\Carbon::createFromTimestampUTC($decision['timestamp'])->toISOString() : '',
            ];
        }, $requests);
        $csv = implode("\r\n", array_map(
            fn ($row) => implode(',', array_map(fn ($value) => $this->escapeCsvCell($value), $row)),
            [$headers, ...$rows]
        ));
        $range = $filters['from'] !== '' && $filters['to'] !== ''
            ? "{$filters['from']}-to-{$filters['to']}"
            : ($filters['from'] ?: ($filters['to'] ?: 'all-time'));

        return response("\xEF\xBB\xBF".$csv, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="service-requests-'.$range.'.csv"',
        ]);
    }

    public function updateRequestStatus(Request $request, string $id): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $status = $this->clean($request->input('status'));
        $allowed = ['Pending' => ['In Review', 'Approved', 'Rejected'], 'In Review' => ['Approved', 'Rejected'], 'Approved' => [], 'Rejected' => []];
        if (!in_array($status, ['Pending', 'Approved', 'Rejected', 'In Review'], true)) {
            return response()->json(['message' => 'Invalid status value.'], 400);
        }

        return DB::transaction(function () use ($actor, $id, $status, $allowed, $request) {
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
            $history = ApiIdentity::decodeJson($existing->status_history ?? []);
            if ($history === []) {
                $history[] = [
                    'id' => (string) Str::uuid(),
                    'kind' => 'status',
                    'status' => $existing->status,
                    'note' => '',
                    'createdAt' => $existing->created_at,
                    'actorRole' => 'system',
                ];
            }
            $history[] = [
                'id' => (string) Str::uuid(),
                'kind' => 'status',
                'status' => $status,
                'note' => $this->clean($request->input('note', '')),
                'createdAt' => now()->toISOString(),
                'actorRole' => $actor->role,
                'actorName' => trim($actor->firstName.' '.$actor->lastName),
            ];
            DB::table('requests')->where('id', $id)->update([
                'status' => $status,
                'status_history' => json_encode($history),
                'updated_at' => now(),
            ]);
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

            return response()->json(['request' => $requestData, 'approval' => $approval]);
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
        $result = DB::transaction(function () use ($actor, $id, $message) {
            $item = DB::table('requests')->where('id', $id)->lockForUpdate()->first();
            if (!$item || ($actor->role === 'resident' && $item->user_id !== $actor->id)) {
                return response()->json(['message' => 'Request not found.'], 404);
            }
            $followUps = ApiIdentity::decodeJson($item->follow_ups);
            $followUp = ['id' => (string) Str::uuid(), 'message' => $message, 'createdAt' => now()->toISOString()];
            $followUps[] = $followUp;
            $history = ApiIdentity::decodeJson($item->status_history ?? []);
            $history[] = $followUp + ['kind' => 'follow-up', 'actorRole' => $actor->role];
            $updates = [
                'follow_ups' => json_encode($followUps),
                'status_history' => json_encode($history),
                'updated_at' => now(),
            ];
            if ($item->status === 'Needs Information' && $actor->role === 'resident') {
                $updates['status'] = 'In Review';
                $history[] = [
                    'id' => (string) Str::uuid(),
                    'kind' => 'status',
                    'status' => 'In Review',
                    'note' => 'Resident provided a follow-up.',
                    'createdAt' => $followUp['createdAt'],
                    'actorRole' => 'system',
                ];
                $updates['status_history'] = json_encode($history);
            }
            DB::table('requests')->where('id', $id)->update($updates);

            return [
                'followUp' => $followUp,
                'request' => $this->requestData(DB::table('requests')->where('id', $id)->first()),
            ];
        });
        if ($result instanceof JsonResponse) {
            return $result;
        }
        $this->writeAudit($actor, 'request.follow_up', 'request', $id);

        return response()->json($result, 201);
    }

    public function staffResidents(Request $request): JsonResponse
    {
        $search = trim((string) $request->query('search', ''));
        $birthDate = trim((string) $request->query('birthDate', ''));
        $ageValue = $request->query('age');
        $zoneValue = $request->query('zone');
        $purok = trim((string) $request->query('purok', ''));
        $maritalStatus = trim((string) $request->query('maritalStatus', ''));
        $occupation = trim((string) $request->query('occupation', ''));
        $page = max(1, (int) $request->query('page', 1));
        $pageSize = min(100, max(1, (int) $request->query('pageSize', 25)));

        if (mb_strlen($search) > 120 || mb_strlen($purok) > 100
            || mb_strlen($maritalStatus) > 100 || mb_strlen($occupation) > 255) {
            return response()->json(['message' => 'Search filters are too long.'], 400);
        }
        if ($birthDate !== '' && (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthDate)
            || !checkdate((int) substr($birthDate, 5, 2), (int) substr($birthDate, 8, 2), (int) substr($birthDate, 0, 4)))) {
            return response()->json(['message' => 'Enter a valid birthdate in YYYY-MM-DD format.'], 400);
        }
        if ($ageValue !== null && $ageValue !== '' && (!filter_var($ageValue, FILTER_VALIDATE_INT) || (int) $ageValue < 0 || (int) $ageValue > 130)) {
            return response()->json(['message' => 'Age must be a whole number from 0 to 130.'], 400);
        }
        if ($zoneValue !== null && $zoneValue !== '' && (!filter_var($zoneValue, FILTER_VALIDATE_INT) || (int) $zoneValue < 1 || (int) $zoneValue > 7)) {
            return response()->json(['message' => 'Choose a valid zone from 1 to 7.'], 400);
        }

        $query = DB::table('resident_registry');
        if ($zoneValue !== null && $zoneValue !== '') {
            $query->where('zone', (int) $zoneValue);
        }
        if ($purok !== '') {
            $query->where('purok', $purok);
        }

        $terms = $search === '' ? [] : preg_split('/\s+/', mb_strtolower($search));
        $filtered = $query->get()
            ->map(fn ($resident) => ['row' => $resident, 'private' => ResidentRegistryData::decrypt($resident)])
            ->filter(function ($entry) use ($terms, $birthDate, $ageValue, $maritalStatus, $occupation) {
                $private = $entry['private'];
                if ($terms !== []) {
                    $firstName = mb_strtolower($private['firstName']);
                    $lastName = mb_strtolower($private['lastName']);
                    foreach ($terms as $term) {
                        if (!str_contains($firstName, $term) && !str_contains($lastName, $term)) {
                            return false;
                        }
                    }
                }
                if ($birthDate !== '' && $private['birthDate'] !== $birthDate) {
                    return false;
                }
                if ($ageValue !== null && $ageValue !== '') {
                    $actualAge = $private['birthDate']
                        ? \Illuminate\Support\Carbon::parse($private['birthDate'], 'Asia/Manila')->age
                        : null;
                    if ($actualAge !== (int) $ageValue) {
                        return false;
                    }
                }
                if ($maritalStatus !== '' && mb_strtolower(trim((string) ($private['maritalStatus'] ?? ''))) !== mb_strtolower($maritalStatus)) {
                    return false;
                }
                if ($occupation !== '' && mb_strtolower(trim((string) ($private['occupation'] ?? ''))) !== mb_strtolower($occupation)) {
                    return false;
                }

                return true;
            })
            ->sort(function ($left, $right) {
                $zoneOrder = ($left['row']->zone ?? -1) <=> ($right['row']->zone ?? -1);
                if ($zoneOrder !== 0) {
                    return $zoneOrder;
                }
                foreach ([
                    [$left['row']->purok ?? '', $right['row']->purok ?? ''],
                    [mb_strtolower((string) $left['private']['lastName']), mb_strtolower((string) $right['private']['lastName'])],
                    [mb_strtolower((string) $left['private']['firstName']), mb_strtolower((string) $right['private']['firstName'])],
                ] as [$leftValue, $rightValue]) {
                    $comparison = strcmp((string) $leftValue, (string) $rightValue);
                    if ($comparison !== 0) {
                        return $comparison;
                    }
                }

                return 0;
            })
            ->values();

        $total = $filtered->count();
        $residents = $filtered->slice(($page - 1) * $pageSize, $pageSize)
            ->map(fn ($entry) => [
                'id' => $entry['row']->id,
                'firstName' => $entry['private']['firstName'],
                'lastName' => $entry['private']['lastName'],
                'birthDate' => $entry['private']['birthDate'],
                'age' => $entry['private']['birthDate']
                    ? \Illuminate\Support\Carbon::parse($entry['private']['birthDate'], 'Asia/Manila')->age
                    : null,
                'sex' => $entry['private']['sex'],
                'household' => $entry['private']['householdId'],
                'householdId' => $entry['private']['householdId'],
                'maritalStatus' => $entry['private']['maritalStatus'],
                'occupation' => $entry['private']['occupation'],
                'purok' => $entry['row']->purok,
                'zone' => $entry['row']->zone,
                'address' => $entry['private']['address'],
                'status' => $entry['row']->record_status,
                'verificationStatus' => $entry['row']->verification_status,
                'sourceReference' => $entry['private']['sourceReference'],
                'sourceFilename' => $entry['private']['sourceFilename'],
            ])->values();

        $this->writeAudit($request->attributes->get('actor'), 'resident_registry.read', 'resident_registry', null, [
            'resultCount' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'filters' => [
                'zone' => $zoneValue === null || $zoneValue === '' ? null : (int) $zoneValue,
                'hasPurokFilter' => $purok !== '',
                'hasMaritalStatusFilter' => $maritalStatus !== '',
                'hasOccupationFilter' => $occupation !== '',
                'hasSearch' => $search !== '',
                'hasBirthDate' => $birthDate !== '',
                'hasAge' => $ageValue !== null && $ageValue !== '',
            ],
        ]);

        return response()->json([
            'residents' => $residents,
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'filters' => [
                'search' => $search,
                'birthDate' => $birthDate,
                'age' => $ageValue === null || $ageValue === '' ? null : (int) $ageValue,
                'zone' => $zoneValue === null || $zoneValue === '' ? null : (int) $zoneValue,
                'purok' => $purok,
                'maritalStatus' => $maritalStatus,
                'occupation' => $occupation,
            ],
        ]);
    }

    public function staffDemographics(Request $request): JsonResponse
    {
        $zoneValue = $request->query('zone');
        $purok = trim((string) $request->query('purok', ''));
        if ($zoneValue !== null && $zoneValue !== '' && (!filter_var($zoneValue, FILTER_VALIDATE_INT) || (int) $zoneValue < 1 || (int) $zoneValue > 7)) {
            return response()->json(['message' => 'Choose a valid zone from 1 to 7.'], 400);
        }
        if (mb_strlen($purok) > 100) {
            return response()->json(['message' => 'Purok filter is too long.'], 400);
        }

        $base = DB::table('resident_registry')
            ->where('record_status', 'active')
            ->where('verification_status', 'verified');
        if ($zoneValue !== null && $zoneValue !== '') {
            $base->where('zone', (int) $zoneValue);
        }
        if ($purok !== '') {
            $base->where('purok', $purok);
        }

        $overall = ['total' => 0, 'male' => 0, 'female' => 0, 'households' => []];
        $purokGroups = [];
        $householdGroups = [];
        $records = $base->get();
        $increment = static function (array &$counts, ?string $sex, ?string $householdId): void {
            $counts['total']++;
            if (mb_strtolower((string) $sex) === 'male') {
                $counts['male']++;
            } elseif (mb_strtolower((string) $sex) === 'female') {
                $counts['female']++;
            }
            if ($householdId !== null && trim($householdId) !== '') {
                $counts['households'][$householdId] = true;
            }
        };

        foreach ($records as $resident) {
            $private = ResidentRegistryData::decrypt($resident);
            $purokKey = json_encode([$resident->zone, $resident->purok], JSON_THROW_ON_ERROR);
            $householdId = $private['householdId'];
            if (!isset($purokGroups[$purokKey])) {
                $purokGroups[$purokKey] = [
                    'zone' => $resident->zone,
                    'purok' => $resident->purok,
                    'counts' => ['total' => 0, 'male' => 0, 'female' => 0, 'households' => []],
                ];
            }
            $increment($overall, $private['sex'], $householdId);
            $increment($purokGroups[$purokKey]['counts'], $private['sex'], $householdId);

            if ($householdId !== null && trim($householdId) !== '') {
                $householdKey = json_encode([$resident->zone, $resident->purok, $householdId], JSON_THROW_ON_ERROR);
                if (!isset($householdGroups[$householdKey])) {
                    $householdGroups[$householdKey] = [
                        'zone' => $resident->zone,
                        'purok' => $resident->purok,
                        'householdId' => $householdId,
                        'counts' => ['total' => 0, 'male' => 0, 'female' => 0, 'households' => []],
                    ];
                }
                $increment($householdGroups[$householdKey]['counts'], $private['sex'], null);
            }
        }

        $countValues = static function (array $counts): array {
            return [
                'total' => $counts['total'],
                'male' => $counts['male'],
                'female' => $counts['female'],
                'households' => count($counts['households']),
            ];
        };
        $overall = $countValues($overall);
        $byPurok = collect($purokGroups)
            ->sort(fn ($left, $right) => (($left['zone'] ?? -1) <=> ($right['zone'] ?? -1))
                ?: strcmp((string) ($left['purok'] ?? ''), (string) ($right['purok'] ?? '')))
            ->map(fn ($group) => [
                'zone' => $group['zone'] === null ? null : (int) $group['zone'],
                'purok' => $group['purok'],
                'label' => $group['purok'] ?: ($group['zone'] ? 'Zone '.$group['zone'] : 'Unassigned / needs verification'),
                ...$countValues($group['counts']),
            ])->values();
        $byHousehold = collect($householdGroups)
            ->sort(fn ($left, $right) => (($left['zone'] ?? -1) <=> ($right['zone'] ?? -1))
                ?: strcmp((string) ($left['purok'] ?? ''), (string) ($right['purok'] ?? ''))
                ?: strcmp((string) $left['householdId'], (string) $right['householdId']))
            ->map(fn ($group) => [
                'zone' => $group['zone'] === null ? null : (int) $group['zone'],
                'purok' => $group['purok'],
                'householdId' => $group['householdId'],
                'total' => $group['counts']['total'],
                'male' => $group['counts']['male'],
                'female' => $group['counts']['female'],
            ])->values();

        $this->writeAudit($request->attributes->get('actor'), 'resident_registry.demographics_read', 'resident_registry', null, [
            'resultCount' => $records->count(),
            'filters' => [
                'zone' => $zoneValue === null || $zoneValue === '' ? null : (int) $zoneValue,
                'hasPurokFilter' => $purok !== '',
            ],
        ]);

        return response()->json([
            'eligibility' => 'Active records with verified household/resident status.',
            'overall' => $overall,
            'byPurok' => $byPurok,
            'byHousehold' => $byHousehold,
            'filters' => ['zone' => $zoneValue === null || $zoneValue === '' ? null : (int) $zoneValue, 'purok' => $purok],
        ]);
    }

    public function adminDemographics(Request $request): JsonResponse
    {
        $response = $this->staffDemographics($request);
        if ($response->getStatusCode() !== 200) {
            return $response;
        }
        $summary = $response->getData(true);
        unset($summary['byHousehold']);

        return response()->json($summary);
    }

    public function createRegistryResident(Request $request): JsonResponse
    {
        $firstName = $this->clean($request->input('firstName'));
        $lastName = $this->clean($request->input('lastName'));
        $birthDate = $request->input('birthDate');
        $sex = $request->input('sex');
        $householdId = $this->clean($request->input('household', $request->input('householdId', '')));
        $maritalStatus = $this->clean($request->input('maritalStatus', ''));
        $occupation = $this->clean($request->input('occupation', ''));
        $zone = $request->input('zone');
        $sourceReference = $this->clean($request->input('sourceReference', ''));
        $sourceFilename = $this->clean($request->input('sourceFilename', ''));
        $actor = $request->attributes->get('actor');

        if ($firstName === '' || $lastName === '' || mb_strlen($firstName) > 100 || mb_strlen($lastName) > 100) {
            return response()->json(['message' => 'Enter the resident’s first and last names (up to 100 characters each).'], 400);
        }
        if ($birthDate !== null && $birthDate !== '' && (!is_string($birthDate)
            || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthDate)
            || !checkdate((int) substr($birthDate, 5, 2), (int) substr($birthDate, 8, 2), (int) substr($birthDate, 0, 4))
            || $birthDate > now('Asia/Manila')->toDateString())) {
            return response()->json(['message' => 'Enter a valid birthdate that is not in the future.'], 400);
        }
        if (!in_array($sex, ['Male', 'Female'], true)) {
            return response()->json(['message' => 'Choose Male or Female for sex.'], 400);
        }
        if ($maritalStatus !== '' && !in_array($maritalStatus, self::REGISTRY_MARITAL_STATUSES, true)) {
            return response()->json(['message' => 'Choose a valid marital status.'], 400);
        }
        if ($zone !== null && $zone !== '' && (!filter_var($zone, FILTER_VALIDATE_INT) || (int) $zone < 1 || (int) $zone > 7)) {
            return response()->json(['message' => 'Choose a valid zone from 1 to 7.'], 400);
        }
        if (mb_strlen($householdId) > 100 || mb_strlen($maritalStatus) > 100 || mb_strlen($occupation) > 255
            || mb_strlen($sourceReference) > 255 || mb_strlen($sourceFilename) > 255) {
            return response()->json(['message' => 'One or more resident fields exceed the allowed length.'], 400);
        }

        $possibleMatches = $this->findRegistryPotentialMatches($firstName, $lastName, $birthDate);

        if ($possibleMatches->isNotEmpty() && !$request->boolean('confirmPotentialMatch')) {
            return response()->json([
                'message' => 'Review the possible matching records before confirming this registration.',
                'potentialMatches' => $possibleMatches,
                'reviewRequired' => true,
            ], 409);
        }

        $id = (string) Str::uuid();
        DB::table('resident_registry')->insert([
            'id' => $id,
            'first_name' => '',
            'last_name' => '',
            'birth_date' => null,
            'sex' => null,
            'household_id' => null,
            'purok' => null,
            'zone' => $zone === null || $zone === '' ? null : (int) $zone,
            'address' => null,
            'record_status' => 'active',
            'verification_status' => 'pending',
            'source_reference' => null,
            'source_filename' => null,
            'encrypted_data' => ResidentRegistryData::encrypt([
                'firstName' => $firstName,
                'lastName' => $lastName,
                'birthDate' => $birthDate ?: null,
                'sex' => $sex ?: null,
                'householdId' => $householdId ?: null,
                'maritalStatus' => $maritalStatus ?: null,
                'occupation' => $occupation ?: null,
                'address' => null,
                'sourceReference' => $sourceReference ?: null,
                'sourceFilename' => $sourceFilename ?: null,
            ], $id),
            'created_by' => $actor->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->writeAudit($actor, 'resident_registry.created', 'resident_registry', $id, [
            'verificationStatus' => 'pending',
            'hasSourceReference' => $sourceReference !== '',
        ]);

        return response()->json([
            'resident' => [
                'id' => $id,
                'firstName' => $firstName,
                'lastName' => $lastName,
                'birthDate' => $birthDate ?: null,
                'age' => $birthDate ? \Illuminate\Support\Carbon::parse($birthDate, 'Asia/Manila')->age : null,
                'sex' => $sex,
                'household' => $householdId ?: null,
                'householdId' => $householdId ?: null,
                'maritalStatus' => $maritalStatus ?: null,
                'occupation' => $occupation ?: null,
                'purok' => null,
                'zone' => $zone === null || $zone === '' ? null : (int) $zone,
                'address' => null,
                'status' => 'active',
                'verificationStatus' => 'pending',
                'sourceReference' => $sourceReference ?: null,
                'sourceFilename' => $sourceFilename ?: null,
            ],
            'potentialMatches' => $possibleMatches,
            'reviewRequired' => true,
        ], 201);
    }

    public function importRegistryResidents(Request $request): JsonResponse
    {
        $residents = $request->input('residents');
        $filename = $request->input('filename');
        if (!is_array($residents) || count($residents) < 1 || count($residents) > 500) {
            return response()->json(['message' => 'Upload between 1 and 500 resident records.'], 400);
        }
        if (!is_string($filename) || trim($filename) === '' || mb_strlen(trim($filename)) > 255) {
            return response()->json(['message' => 'A source filename of up to 255 characters is required.'], 400);
        }
        if ($request->has('confirmPotentialMatches') && !is_bool($request->input('confirmPotentialMatches'))) {
            return response()->json(['message' => 'Duplicate confirmation must be true or false.'], 400);
        }

        $today = now('Asia/Manila')->toDateString();
        $normalized = [];
        $validationErrors = [];
        foreach (array_values($residents) as $index => $resident) {
            $row = $index + 2;
            if (!is_array($resident)) {
                $validationErrors[] = ['row' => $row, 'field' => 'record', 'message' => 'Expected a resident record.'];
                continue;
            }
            $fields = [];
            $fieldInputs = [
                'firstName' => $resident['firstName'] ?? '',
                'lastName' => $resident['lastName'] ?? '',
                'birthDate' => $resident['birthDate'] ?? '',
                'sex' => $resident['sex'] ?? '',
                'household' => $resident['household'] ?? $resident['householdId'] ?? '',
                'zone' => $resident['zone'] ?? '',
                'maritalStatus' => $resident['maritalStatus'] ?? '',
                'occupation' => $resident['occupation'] ?? '',
                'sourceReference' => $resident['sourceReference'] ?? '',
                'legacyPurok' => $resident['legacyPurok'] ?? $resident['purok'] ?? '',
                'legacyAddress' => $resident['legacyAddress'] ?? $resident['address'] ?? '',
            ];
            foreach ($fieldInputs as $field => $value) {
                if (!is_string($value) && !is_int($value)) {
                    $validationErrors[] = ['row' => $row, 'field' => $field, 'message' => 'Must be text.'];
                    $fields[$field] = '';
                    continue;
                }
                $fields[$field] = $this->clean((string) $value);
            }
            $firstName = $fields['firstName'];
            $lastName = $fields['lastName'];
            $birthDate = $fields['birthDate'];
            $sex = $fields['sex'];
            $zoneText = $fields['zone'];
            $zone = $zoneText === '' ? null : filter_var($zoneText, FILTER_VALIDATE_INT);

            if ($firstName === '' || $lastName === '' || mb_strlen($firstName) > 100 || mb_strlen($lastName) > 100) {
                $validationErrors[] = ['row' => $row, 'field' => 'name', 'message' => 'First and last names are required and must not exceed 100 characters.'];
            }
            if ($birthDate !== '' && (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthDate)
                || !checkdate((int) substr($birthDate, 5, 2), (int) substr($birthDate, 8, 2), (int) substr($birthDate, 0, 4))
                || $birthDate > $today)) {
                $validationErrors[] = ['row' => $row, 'field' => 'birthDate', 'message' => 'Birthdate must be a valid date no later than today.'];
            }
            if (!in_array($sex, ['Male', 'Female'], true)) {
                $validationErrors[] = ['row' => $row, 'field' => 'sex', 'message' => 'Use Male or Female.'];
            }
            if ($fields['maritalStatus'] !== '' && !in_array($fields['maritalStatus'], self::REGISTRY_MARITAL_STATUSES, true)) {
                $validationErrors[] = ['row' => $row, 'field' => 'maritalStatus', 'message' => 'Use Single, Married, Widowed, Live-in, Divorced, Annulled, or Separate.'];
            }
            if ($zoneText !== '' && ($zone === false || $zone < 1 || $zone > 7)) {
                $validationErrors[] = ['row' => $row, 'field' => 'zone', 'message' => 'Zone must be a whole number from 1 to 7.'];
            }
            if (mb_strlen($fields['household']) > 100 || mb_strlen($fields['maritalStatus']) > 100
                || mb_strlen($fields['occupation']) > 255 || mb_strlen($fields['legacyPurok']) > 100
                || mb_strlen($fields['legacyAddress']) > 255 || mb_strlen($fields['sourceReference']) > 255) {
                $validationErrors[] = ['row' => $row, 'field' => 'length', 'message' => 'A field exceeds its maximum length.'];
            }
            $normalized[] = [
                'firstName' => $firstName,
                'lastName' => $lastName,
                'birthDate' => $birthDate !== '' ? $birthDate : null,
                'sex' => $sex !== '' ? $sex : null,
                'householdId' => $fields['household'] !== '' ? $fields['household'] : null,
                'zone' => $zone === false || $zone === null ? null : (int) $zone,
                'maritalStatus' => $fields['maritalStatus'] !== '' ? $fields['maritalStatus'] : null,
                'occupation' => $fields['occupation'] !== '' ? $fields['occupation'] : null,
                'purok' => $fields['legacyPurok'] !== '' ? $fields['legacyPurok'] : null,
                'address' => $fields['legacyAddress'] !== '' ? $fields['legacyAddress'] : null,
                'sourceReference' => $fields['sourceReference'] !== '' ? $fields['sourceReference'] : null,
            ];
        }
        if ($validationErrors !== []) {
            return response()->json(['message' => 'Correct the invalid rows before importing.', 'validationErrors' => $validationErrors], 400);
        }

        $potentialMatches = [];
        $seenRows = [];
        foreach ($normalized as $index => $resident) {
            $key = mb_strtolower($resident['firstName'])."\0".mb_strtolower($resident['lastName'])."\0".($resident['birthDate'] ?? '');
            if (isset($seenRows[$key])) {
                $prior = $normalized[$seenRows[$key]];
                $potentialMatches[] = [
                    'row' => $index + 2,
                    'records' => [[
                        'id' => 'upload-row-'.($seenRows[$key] + 2),
                        'firstName' => $prior['firstName'],
                        'lastName' => $prior['lastName'],
                        'birthDate' => $prior['birthDate'],
                        'source' => 'same import file',
                    ]],
                ];
            } else {
                $seenRows[$key] = $index;
            }

            $matches = $this->findRegistryPotentialMatches(
                $resident['firstName'],
                $resident['lastName'],
                $resident['birthDate']
            )->all();
            if ($matches !== []) {
                $potentialMatches[] = ['row' => $index + 2, 'records' => $matches];
            }
        }

        if ($potentialMatches !== [] && !$request->boolean('confirmPotentialMatches')) {
            return response()->json([
                'message' => 'Review every possible duplicate before confirming the import.',
                'potentialMatches' => $potentialMatches,
                'reviewRequired' => true,
            ], 409);
        }

        $actor = $request->attributes->get('actor');
        $now = now();
        DB::transaction(function () use ($normalized, $filename, $actor, $now, $potentialMatches) {
            foreach ($normalized as $resident) {
                $id = (string) Str::uuid();
                DB::table('resident_registry')->insert([
                    'id' => $id,
                    'first_name' => '',
                    'last_name' => '',
                    'birth_date' => null,
                    'sex' => null,
                    'household_id' => null,
                    'zone' => $resident['zone'],
                    'purok' => $resident['purok'],
                    'address' => null,
                    'record_status' => 'active',
                    'verification_status' => 'pending',
                    'source_reference' => null,
                    'source_filename' => null,
                    'encrypted_data' => ResidentRegistryData::encrypt([
                        ...$resident,
                        'sourceFilename' => trim($filename),
                    ], $id),
                    'created_by' => $actor->id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
            $this->writeAudit($actor, 'resident_registry.bulk_imported', 'resident_registry_batch', null, [
                'count' => count($normalized),
                'hasSourceFilename' => trim($filename) !== '',
                'potentialMatchCount' => count($potentialMatches),
            ]);
        });

        return response()->json([
            'imported' => count($normalized),
            'verificationStatus' => 'pending',
            'potentialMatches' => $potentialMatches,
        ], 201);
    }

    public function auditRegistryPrint(Request $request): JsonResponse
    {
        $count = $request->input('count');
        $filters = $request->input('filters', []);
        if (!is_int($count) || $count < 1 || $count > 100 || !is_array($filters)) {
            return response()->json(['message' => 'Print between 1 and 100 visible resident records.'], 400);
        }
        $zoneValue = $filters['zone'] ?? null;
        $zone = $zoneValue === null || $zoneValue === '' ? null : filter_var($zoneValue, FILTER_VALIDATE_INT);
        $purok = $filters['purok'] ?? '';
        $page = $filters['page'] ?? null;
        if (($zoneValue !== null && $zoneValue !== '' && ($zone === false || $zone < 1 || $zone > 7))
            || !is_string($purok) || mb_strlen(trim($purok)) > 100
            || !is_int($page) || $page < 1) {
            return response()->json(['message' => 'Print filter values are invalid.'], 400);
        }

        $this->writeAudit($request->attributes->get('actor'), 'resident_registry.print.blocked', 'resident_registry', null, [
            'recordCount' => $count,
            'filters' => ['zone' => $zone === false ? null : $zone, 'hasPurokFilter' => trim($purok) !== '', 'page' => $page],
            'dataFields' => ['name', 'birthDate', 'age', 'sex', 'householdId', 'purok', 'zone', 'verificationStatus', 'recordStatus'],
        ]);

        return response()->json([
            'message' => 'Managed office printing is not configured. No print job was started.',
        ], 503);
    }

    public function auditRegistryExport(Request $request): JsonResponse
    {
        $count = $request->input('count');
        $filters = $request->input('filters');
        $filterKeys = ['hasSearch', 'hasBirthDate', 'hasAge', 'hasZone', 'hasMaritalStatusFilter', 'hasOccupationFilter'];
        if (!is_int($count) || $count < 1 || $count > 10000
            || $request->input('format') !== 'csv'
            || $request->input('grouping') !== 'zone_household_name'
            || !is_array($filters)
            || array_diff(array_keys($filters), $filterKeys) !== []
            || count($filters) !== count($filterKeys)) {
            return response()->json(['message' => 'Spreadsheet export details are invalid.'], 400);
        }
        foreach ($filterKeys as $key) {
            if (!array_key_exists($key, $filters) || !is_bool($filters[$key])) {
                return response()->json(['message' => 'Spreadsheet export details are invalid.'], 400);
            }
        }

        $this->writeAudit($request->attributes->get('actor'), 'resident_registry.exported', 'resident_registry', null, [
            'recordCount' => $count,
            'format' => 'csv',
            'grouping' => 'zone_household_name',
            'filters' => $filters,
            'dataFields' => ['zone', 'household', 'name', 'birthDate', 'age', 'sex', 'maritalStatus', 'occupation', 'recordStatus', 'verificationStatus'],
        ]);

        return response()->json(['success' => true]);
    }

    public function updateRegistryResident(Request $request, string $id): JsonResponse
    {
        if (!Str::isUuid($id)) {
            return response()->json(['message' => 'Choose a valid resident record.'], 400);
        }

        $body = $request->all();
        $editableFields = [
            'firstName', 'lastName', 'birthDate', 'sex', 'household', 'householdId',
            'maritalStatus', 'occupation', 'purok', 'zone', 'address', 'sourceReference',
            'sourceFilename', 'status', 'verificationStatus',
        ];
        $changedFields = array_values(array_intersect($editableFields, array_keys($body)));
        if ($changedFields === []) {
            return response()->json(['message' => 'Provide at least one resident field to update.'], 400);
        }

        $privateUpdates = [];
        $stringLimits = [
            'firstName' => 100,
            'lastName' => 100,
            'household' => 100,
            'householdId' => 100,
            'maritalStatus' => 100,
            'occupation' => 255,
            'address' => 255,
            'sourceReference' => 255,
            'sourceFilename' => 255,
        ];
        $nullableStringFields = ['maritalStatus', 'sourceReference', 'sourceFilename'];
        foreach ($stringLimits as $field => $maxLength) {
            if (!array_key_exists($field, $body)) {
                continue;
            }
            if ($field === 'householdId' && array_key_exists('household', $body)) {
                continue;
            }
            if (in_array($field, $nullableStringFields, true) && $body[$field] === null) {
                $privateUpdates[$field] = null;
                continue;
            }
            if (!is_string($body[$field])) {
                return response()->json(['message' => "Enter a valid {$field} value."], 400);
            }
            $value = $this->clean($body[$field]);
            if (mb_strlen($value) > $maxLength || (in_array($field, ['firstName', 'lastName'], true) && $value === '')) {
                return response()->json(['message' => "Enter a valid {$field} (up to {$maxLength} characters)."], 400);
            }
            $privateUpdates[$field === 'household' ? 'householdId' : $field] = $value !== '' ? $value : null;
        }
        if (array_key_exists('maritalStatus', $privateUpdates)
            && $privateUpdates['maritalStatus'] !== null
            && !in_array($privateUpdates['maritalStatus'], self::REGISTRY_MARITAL_STATUSES, true)) {
            return response()->json(['message' => 'Choose a valid marital status.'], 400);
        }

        if (array_key_exists('birthDate', $body)) {
            $birthDate = $body['birthDate'];
            if ($birthDate !== null && $birthDate !== ''
                && (!is_string($birthDate) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $birthDate)
                    || !checkdate((int) substr($birthDate, 5, 2), (int) substr($birthDate, 8, 2), (int) substr($birthDate, 0, 4))
                    || $birthDate > now('Asia/Manila')->toDateString())) {
                return response()->json(['message' => 'Enter a valid birthdate that is not in the future.'], 400);
            }
            $privateUpdates['birthDate'] = $birthDate ?: null;
        }
        if (array_key_exists('sex', $body)) {
            if (!in_array($body['sex'], ['Male', 'Female'], true)) {
                return response()->json(['message' => 'Choose Male or Female for sex.'], 400);
            }
            $privateUpdates['sex'] = $body['sex'];
        }

        $columns = [];
        if (array_key_exists('zone', $body)) {
            $zone = $body['zone'] === null || $body['zone'] === '' ? null : filter_var($body['zone'], FILTER_VALIDATE_INT);
            if ($zone !== null && ($zone === false || $zone < 1 || $zone > 7)) {
                return response()->json(['message' => 'Choose a valid zone from 1 to 7.'], 400);
            }
            $columns['zone'] = $zone;
        }
        if (array_key_exists('purok', $body)) {
            if (!is_string($body['purok']) || mb_strlen($this->clean($body['purok'])) > 100) {
                return response()->json(['message' => 'Enter a valid legacy location value.'], 400);
            }
            $columns['purok'] = $this->clean($body['purok']) ?: null;
        }
        if (array_key_exists('status', $body)) {
            if (!in_array($body['status'], ['active', 'inactive', 'deceased', 'archived'], true)) {
                return response()->json(['message' => 'Choose a valid resident record status.'], 400);
            }
            $columns['record_status'] = $body['status'];
        }
        if (array_key_exists('verificationStatus', $body)) {
            if (!in_array($body['verificationStatus'], ['pending', 'verified', 'needs_review'], true)) {
                return response()->json(['message' => 'Choose a valid verification status.'], 400);
            }
            $columns['verification_status'] = $body['verificationStatus'];
            $columns['verified_by'] = $body['verificationStatus'] === 'verified'
                ? $request->attributes->get('actor')->id
                : null;
            $columns['verified_at'] = $body['verificationStatus'] === 'verified' ? now() : null;
        }

        $actor = $request->attributes->get('actor');
        $updated = DB::transaction(function () use ($id, $privateUpdates, $columns) {
            $resident = DB::table('resident_registry')->where('id', $id)->lockForUpdate()->first();
            if (!$resident) {
                return null;
            }
            $private = array_merge(ResidentRegistryData::decrypt($resident), $privateUpdates);
            DB::table('resident_registry')->where('id', $id)->update([
                ...$columns,
                'encrypted_data' => ResidentRegistryData::encrypt($private, $id),
                'updated_at' => now(),
            ]);

            return ['row' => $resident, 'private' => $private];
        });
        if (!$updated) {
            return response()->json(['message' => 'Resident record not found.'], 404);
        }

        $this->writeAudit($actor, 'resident_registry.record_updated', 'resident_registry', $id, [
            'changedFields' => $changedFields,
        ]);
        $private = $updated['private'];
        $row = $updated['row'];
        $verificationStatus = $columns['verification_status'] ?? $row->verification_status;
        $recordStatus = $columns['record_status'] ?? $row->record_status;
        $zone = array_key_exists('zone', $columns) ? $columns['zone'] : $row->zone;
        $purok = array_key_exists('purok', $columns) ? $columns['purok'] : $row->purok;

        return response()->json([
            'resident' => [
                'id' => $id,
                'firstName' => $private['firstName'],
                'lastName' => $private['lastName'],
                'birthDate' => $private['birthDate'],
                'age' => $private['birthDate'] ? \Illuminate\Support\Carbon::parse($private['birthDate'], 'Asia/Manila')->age : null,
                'sex' => $private['sex'],
                'household' => $private['householdId'],
                'householdId' => $private['householdId'],
                'maritalStatus' => $private['maritalStatus'],
                'occupation' => $private['occupation'],
                'purok' => $purok,
                'zone' => $zone,
                'address' => $private['address'],
                'status' => $recordStatus,
                'verificationStatus' => $verificationStatus,
                'sourceReference' => $private['sourceReference'],
                'sourceFilename' => $private['sourceFilename'],
            ],
        ]);
    }

    public function verifyRegistryResident(Request $request, string $id): JsonResponse
    {
        $status = $request->input('verificationStatus');
        if (!in_array($status, ['verified', 'needs_review'], true)) {
            return response()->json(['message' => 'Choose verified or needs_review.'], 400);
        }
        $resident = DB::table('resident_registry')->where('id', $id)->first();
        if (!$resident) {
            return response()->json(['message' => 'Resident record not found.'], 404);
        }

        $actor = $request->attributes->get('actor');
        DB::table('resident_registry')->where('id', $id)->update([
            'verification_status' => $status,
            'verified_by' => $actor->id,
            'verified_at' => now(),
            'updated_at' => now(),
        ]);
        $this->writeAudit($actor, 'resident_registry.'.$status, 'resident_registry', $id);
        $private = ResidentRegistryData::decrypt($resident);

        return response()->json([
            'resident' => [
                'id' => $resident->id,
                'firstName' => $private['firstName'],
                'lastName' => $private['lastName'],
                'verificationStatus' => $status,
                'verifiedBy' => $actor->id,
                'verifiedAt' => now()->toISOString(),
            ],
        ]);
    }

    public function updateRegistryResidentStatus(Request $request, string $id): JsonResponse
    {
        $status = $request->input('status');
        if (!in_array($status, ['active', 'inactive', 'deceased', 'archived'], true)) {
            return response()->json(['message' => 'Choose active, inactive, deceased, or archived.'], 400);
        }
        $resident = DB::table('resident_registry')->where('id', $id)->first();
        if (!$resident) {
            return response()->json(['message' => 'Resident record not found.'], 404);
        }

        $actor = $request->attributes->get('actor');
        DB::table('resident_registry')->where('id', $id)->update([
            'record_status' => $status,
            'updated_at' => now(),
        ]);
        $this->writeAudit($actor, 'resident_registry.status_changed', 'resident_registry', $id, [
            'previousStatus' => $resident->record_status,
            'status' => $status,
        ]);

        return response()->json(['resident' => ['id' => $id, 'status' => $status]]);
    }

    public function emergencyAccessStatus(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $grant = DB::table('emergency_access_grants')
            ->where('active_slot', 'global')
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->first();

        if (!$grant) {
            return response()->json(['active' => false, 'grant' => null]);
        }

        return response()->json([
            'active' => true,
            'grant' => [
                'id' => $grant->id,
                'isOwnGrant' => $grant->admin_id === $actor->id,
                'reason' => $grant->reason,
                'scopes' => \App\Support\ApiIdentity::decodeJson($grant->scopes),
                'activatedAt' => $grant->activated_at,
                'expiresAt' => $grant->expires_at,
            ],
        ]);
    }

    public function activateEmergencyAccess(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $password = $request->input('currentPassword');
        $reason = trim((string) $request->input('reason', ''));
        $code = trim((string) $request->input('code', ''));
        if (!is_string($password) || strlen($password) > 200 || mb_strlen($reason) < 20 || mb_strlen($reason) > 500) {
            return response()->json(['message' => 'Enter your current password and an emergency reason of 20 to 500 characters.'], 400);
        }
        $admin = DB::table('users')->where('id', $actor->id)->first();
        if (!$admin || !password_verify($password, $admin->password_hash)) {
            return response()->json(['message' => 'Current password was not accepted.'], 401);
        }

        $mfaStep = null;
        if ((bool) $admin->mfa_enabled) {
            if (!$admin->mfa_secret || !preg_match('/^\d{6}$/', $code)) {
                return response()->json(['message' => 'Enter the current authenticator code to activate emergency access.'], 401);
            }
            $mfaStep = $this->verifyTotp($this->decryptTotpSecret($admin->mfa_secret), $code);
            if ($mfaStep === null || $mfaStep <= (int) $admin->mfa_last_step) {
                return response()->json(['message' => 'Authenticator code is invalid or has already been used.'], 401);
            }
        }

        $now = now();
        $expiresAt = $now->copy()->addMinutes(20);
        $grantId = (string) Str::uuid();
        $scopes = ['resident-registry.read', 'resident-registry.manage', 'request-processing'];

        try {
            return DB::transaction(function () use ($actor, $admin, $mfaStep, $reason, $now, $expiresAt, $grantId, $scopes) {
                DB::table('emergency_access_grants')
                    ->where('active_slot', 'global')
                    ->where('expires_at', '<=', $now)
                    ->update(['active_slot' => null]);
                if (DB::table('emergency_access_grants')->where('active_slot', 'global')->exists()) {
                    return response()->json(['message' => 'An emergency access grant is already active. Revoke it or wait for it to expire.'], 409);
                }
                if ($mfaStep !== null) {
                    $updated = DB::table('users')->where('id', $admin->id)
                        ->where('mfa_last_step', '<', $mfaStep)
                        ->update(['mfa_last_step' => $mfaStep]);
                    if ($updated !== 1) {
                        return response()->json(['message' => 'Authenticator code has already been used.'], 409);
                    }
                }
                DB::table('emergency_access_grants')->insert([
                    'id' => $grantId,
                    'admin_id' => $actor->id,
                    'reason' => $reason,
                    'scopes' => json_encode($scopes),
                    'active_slot' => 'global',
                    'activated_at' => $now,
                    'expires_at' => $expiresAt,
                ]);
                $this->writeAudit($actor, 'emergency_access.activated', 'emergency_access_grant', $grantId, [
                    'reason' => $reason,
                    'scopes' => $scopes,
                    'expiresAt' => $expiresAt->toISOString(),
                ]);

                return response()->json([
                    'active' => true,
                    'grant' => [
                        'id' => $grantId,
                        'isOwnGrant' => true,
                        'reason' => $reason,
                        'scopes' => $scopes,
                        'activatedAt' => $now->toISOString(),
                        'expiresAt' => $expiresAt->toISOString(),
                    ],
                ], 201);
            });
        } catch (QueryException $error) {
            if (DB::table('emergency_access_grants')->where('active_slot', 'global')->exists()) {
                return response()->json(['message' => 'An emergency access grant was activated by another administrator.'], 409);
            }
            throw $error;
        }
    }

    public function revokeEmergencyAccess(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $grant = DB::table('emergency_access_grants')
            ->where('active_slot', 'global')
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->first();
        if (!$grant) {
            return response()->json(['message' => 'There is no active emergency access grant to revoke.'], 404);
        }

        DB::table('emergency_access_grants')->where('id', $grant->id)->update([
            'active_slot' => null,
            'revoked_by' => $actor->id,
            'revoked_at' => now(),
        ]);
        $this->writeAudit($actor, 'emergency_access.revoked', 'emergency_access_grant', $grant->id, [
            'activatedBy' => $grant->admin_id,
            'reason' => $grant->reason,
        ]);

        return response()->json(['active' => false, 'revoked' => true]);
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

    public function staffAccountApprovals(): JsonResponse
    {
        $approvals = DB::table('users')
            ->where('role', 'resident')
            ->where('status', 'Pending Verification')
            ->orderBy('created_at')
            ->get()
            ->map(fn ($user) => [
                'id' => $user->id,
                'firstName' => $user->first_name,
                'lastName' => $user->last_name,
                'email' => $user->email,
                'mobile' => $user->mobile,
                'address' => $user->address,
                'zone' => $user->zone,
                'createdAt' => $user->created_at,
            ]);

        return response()->json(['approvals' => $approvals]);
    }

    public function updateStaffAccountApproval(Request $request, string $id): JsonResponse
    {
        $status = $request->input('status');
        if (!in_array($status, ['Active Resident', 'Rejected'], true)) {
            return response()->json(['message' => 'Choose Active Resident or Rejected.'], 400);
        }

        $updated = DB::table('users')
            ->where('id', $id)
            ->where('role', 'resident')
            ->where('status', 'Pending Verification')
            ->update(['status' => $status]);

        if ($updated !== 1) {
            $existing = DB::table('users')->where('id', $id)->first();
            if (!$existing || $existing->role !== 'resident') {
                return response()->json(['message' => 'Pending resident account not found.'], 404);
            }

            return response()->json(['message' => 'This resident account has already been reviewed.'], 409);
        }

        $actor = $request->attributes->get('actor');
        $this->writeAudit(
            $actor,
            $status === 'Active Resident' ? 'resident_account.approved' : 'resident_account.rejected',
            'resident_account',
            $id,
            ['status' => $status]
        );

        return response()->json(['user' => ['id' => $id, 'status' => $status]]);
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
        $householdId = $request->exists('householdId')
            ? ($this->clean($request->input('householdId')) ?: null)
            : ($existing->household_id ?? null);
        $familyMembers = $request->input('familyMembers', $existing->family_members ?? 4);
        $storedHouseholdMembers = json_decode((string) ($existing->household_members ?? '[]'), true);
        $householdMembers = $request->input('householdMembers', is_array($storedHouseholdMembers) ? $storedHouseholdMembers : []);

        if (!is_array($householdMembers) || count($householdMembers) > 100) {
            return response()->json(['message' => 'Household members must be a list of no more than 100 people.'], 400);
        }
        $validatedHouseholdMembers = [];
        foreach ($householdMembers as $member) {
            if (!is_array($member) || !is_string($member['name'] ?? null) || !is_string($member['relationship'] ?? null)) {
                return response()->json(['message' => 'Each household member needs a name (up to 100 characters) and relationship (up to 50 characters).'], 400);
            }
            $name = $this->clean($member['name']);
            $relationship = $this->clean($member['relationship']);
            if (!$name || mb_strlen($name) > 100 || !$relationship || mb_strlen($relationship) > 50) {
                return response()->json(['message' => 'Each household member needs a name (up to 100 characters) and relationship (up to 50 characters).'], 400);
            }
            $validatedHouseholdMembers[] = ['name' => $name, 'relationship' => $relationship];
        }

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
        if (filter_var($familyMembers, FILTER_VALIDATE_INT) === false || (int) $familyMembers < 1 || (int) $familyMembers > 100) {
            return response()->json(['message' => 'Family members must be a whole number from 1 to 100.'], 400);
        }
        if ($householdId !== null && mb_strlen($householdId) > 50) {
            return response()->json(['message' => 'Household ID must not exceed 50 characters.'], 400);
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
            'family_members' => (int) $familyMembers,
            'household_members' => json_encode($validatedHouseholdMembers),
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
        $pendingSecret = $actor->mfaSecret ?? null;
        if ($pendingSecret && !$request->boolean('rotate')) {
            $secret = $this->decryptTotpSecret($pendingSecret);
        } else {
            $secret = $this->encodeBase32(random_bytes(20));
            DB::table('users')->where('id', $actor->id)->update([
                'mfa_secret' => $this->encryptTotpSecret($secret),
                'mfa_enabled' => false,
                'mfa_last_step' => 0,
            ]);
        }
        $label = rawurlencode('Barangay Legaspi:'.$actor->email);
        $uri = 'otpauth://totp/'.$label.'?'.http_build_query([
            'secret' => $secret,
            'issuer' => 'Barangay Legaspi',
            'algorithm' => 'SHA1',
            'digits' => '6',
            'period' => '30',
        ]);
        $this->writeAudit($actor, 'mfa.setup_started', 'user', $actor->id);

        return response()->json(['secret' => $secret, 'otpauthUri' => $uri]);
    }

    public function mfaEnable(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $code = trim((string) $request->input('code', ''));
        if (!preg_match('/^\d{6}$/', $code)) {
            return response()->json(['message' => 'A valid 6-digit authenticator code is required.'], 400);
        }
        $failure = DB::transaction(function () use ($actor, $code) {
            $user = DB::table('users')->where('id', $actor->id)->lockForUpdate()->first();
            if (!$user || !$user->mfa_secret) {
                return response()->json(['message' => 'Start authenticator setup before enabling MFA.'], 400);
            }
            if ((bool) $user->mfa_enabled) {
                return response()->json(['message' => 'Authenticator MFA is already enabled.'], 409);
            }
            $step = $this->verifyTotp($this->decryptTotpSecret($user->mfa_secret), $code);
            if ($step === null) {
                return response()->json(['message' => 'The MFA code is invalid. Please try again.'], 400);
            }
            if ($step <= (int) $user->mfa_last_step) {
                return response()->json(['message' => 'The authenticator code has already been used.'], 401);
            }
            DB::table('users')->where('id', $actor->id)->update(['mfa_enabled' => true, 'mfa_last_step' => $step]);

            return null;
        });
        if ($failure instanceof JsonResponse) {
            return $failure;
        }
        $this->writeAudit($actor, 'mfa.enabled', 'user', $actor->id);

        return response()->json(['message' => 'Authenticator MFA is enabled for this account.']);
    }

    public function mfaDisable(Request $request): JsonResponse
    {
        $actor = $request->attributes->get('actor');
        $currentPassword = (string) $request->input('currentPassword', '');
        $code = trim((string) $request->input('code', ''));
        $failure = DB::transaction(function () use ($actor, $currentPassword, $code) {
            $user = DB::table('users')->where('id', $actor->id)->lockForUpdate()->first();
            if (!$user || !$user->mfa_enabled || !$user->mfa_secret) {
                return response()->json(['message' => 'Authenticator MFA is not enabled.'], 409);
            }
            if (!password_verify($currentPassword, $user->password_hash)) {
                return response()->json(['message' => 'Current password is incorrect.'], 401);
            }
            $step = $this->verifyTotp($this->decryptTotpSecret($user->mfa_secret), $code);
            if ($step === null || $step <= (int) $user->mfa_last_step) {
                return response()->json(['message' => 'The MFA code is invalid or has already been used.'], 401);
            }
            DB::table('users')->where('id', $actor->id)->update(['mfa_enabled' => false, 'mfa_secret' => null, 'mfa_last_step' => 0]);

            return null;
        });
        if ($failure instanceof JsonResponse) {
            return $failure;
        }
        $this->writeAudit($actor, 'mfa.disabled', 'user', $actor->id);

        return response()->json(['message' => 'Authenticator MFA is disabled.']);
    }

    public function archiveResident(Request $request, string $id): JsonResponse
    {
        $resident = DB::table('users')->where('id', $id)->first();
        if (!$resident) {
            return response()->json(['message' => 'Resident not found.'], 404);
        }
        if ($resident->role !== 'resident') {
            return response()->json(['message' => 'Only resident accounts can be archived here.'], 400);
        }
        if ($resident->status === 'Disabled') {
            return response()->json(['success' => true, 'alreadyArchived' => true, 'user' => $this->publicUser($resident)]);
        }

        DB::table('users')->where('id', $id)->update(['status' => 'Disabled']);
        $updated = DB::table('users')->where('id', $id)->first();
        $this->writeAudit($request->attributes->get('actor'), 'resident.archived', 'user', $id, [
            'previousStatus' => $resident->status ?: null,
        ]);

        return response()->json(['success' => true, 'user' => $this->publicUser($updated)]);
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
        $days = $request->input('days');
        if ($days !== null && !in_array($days, [0, '0'], true)) {
            return response()->json(['message' => 'Only manual archiving of closed requests is supported.'], 400);
        }
        $result = DB::transaction(function () {
            $rows = DB::table('requests')
                ->whereIn('status', ['Approved', 'Rejected'])
                ->orderBy('created_at')
                ->limit(500)
                ->lockForUpdate()
                ->get();
            if ($rows->isEmpty()) {
                return ['count' => 0, 'filename' => null, 'archivedAt' => null, 'remaining' => 0];
            }
            $records = $rows->map(fn ($row) => $this->requestData($row))->values()->all();
            $archivedAt = now();
            $filename = 'queue-approvals-'.$archivedAt->format('Y-m-d\TH-i-s-u').'-'.Str::uuid().'.json';
            $payload = [
                'archivedAt' => $archivedAt->toISOString(),
                'archivedFor' => 'manual',
                'total' => count($records),
                'records' => $records,
            ];
            DB::table('archives')->insert([
                'id' => (string) Str::uuid(),
                'name' => $filename,
                'category' => 'queue-approvals',
                'contents' => json_encode($payload, JSON_THROW_ON_ERROR),
                'created_at' => $archivedAt,
            ]);
            DB::table('requests')->whereIn('id', $rows->pluck('id'))->delete();
            $remaining = DB::table('requests')->whereIn('status', ['Approved', 'Rejected'])->count();

            return ['count' => count($records), 'filename' => $filename, 'archivedAt' => $payload['archivedAt'], 'remaining' => $remaining];
        });
        $this->writeAudit($request->attributes->get('actor'), 'requests.archived', 'archive', $result['filename'], [
            'count' => $result['count'],
            'remainingClosedCount' => $result['remaining'],
        ]);

        return response()->json(['archive' => $result]);
    }

    public function restoreArchivedRequests(Request $request): JsonResponse
    {
        $filename = $request->input('filename');
        if (!is_string($filename) || !preg_match('/^queue-approvals-[\w.-]+\.json$/', $filename)) {
            return response()->json(['message' => 'Choose a valid closed-request archive.'], 400);
        }

        $result = DB::transaction(function () use ($filename) {
            $archiveRow = DB::table('archives')
                ->where('name', $filename)
                ->where('category', 'queue-approvals')
                ->lockForUpdate()
                ->first();
            if (!$archiveRow) {
                return response()->json(['message' => 'Closed-request archive not found.'], 404);
            }
            $archive = ApiIdentity::decodeJson($archiveRow->contents);
            if (!is_array($archive) || !isset($archive['records']) || !is_array($archive['records'])) {
                return response()->json(['message' => 'The selected archive is invalid.'], 400);
            }
            foreach ($archive['records'] as $record) {
                if (!is_array($record)
                    || !is_string($record['id'] ?? null)
                    || !Str::isUuid($record['id'])
                    || !is_string($record['userId'] ?? null)
                    || !Str::isUuid($record['userId'])
                    || !in_array($record['status'] ?? null, ['Approved', 'Rejected'], true)
                    || !is_string($record['type'] ?? null)
                    || !is_string($record['purpose'] ?? null)) {
                    return response()->json(['message' => 'The selected archive contains an invalid request.'], 400);
                }
            }

            $restoredCount = 0;
            $conflictCount = 0;
            foreach ($archive['records'] as $record) {
                if (!DB::table('users')->where('id', $record['userId'])->exists()) {
                    $conflictCount++;
                    continue;
                }

                $inserted = DB::table('requests')->insertOrIgnore([
                    'id' => $record['id'],
                    'user_id' => $record['userId'],
                    'type' => $record['type'],
                    'purpose' => $record['purpose'],
                    'notes' => $record['notes'] ?? '',
                    'status' => $record['status'],
                    'delivery_method' => $record['deliveryMethod'] ?? 'online',
                    'delivery_note' => $record['deliveryNote'] ?? '',
                    'follow_ups' => json_encode($record['followUps'] ?? [], JSON_THROW_ON_ERROR),
                    'status_history' => json_encode($record['statusHistory'] ?? [], JSON_THROW_ON_ERROR),
                    'created_at' => $record['date'] ?? $record['createdAt'] ?? now(),
                    'updated_at' => $record['updatedAt'] ?? null,
                ]);
                if ($inserted === 1) {
                    $restoredCount++;
                } else {
                    $conflictCount++;
                }
            }

            return ['restoredCount' => $restoredCount, 'conflictCount' => $conflictCount];
        });
        if ($result instanceof JsonResponse) {
            return $result;
        }
        $this->writeAudit($request->attributes->get('actor'), 'requests.archive.restored', 'request_archive', $filename, $result);

        return response()->json(['restore' => $result]);
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

    private function staffReportFilters(Request $request): array|JsonResponse
    {
        $filters = [
            'from' => $request->query('from', ''),
            'to' => $request->query('to', ''),
            'type' => $request->query('type', ''),
            'status' => $request->query('status', ''),
        ];
        foreach ($filters as $value) {
            if (!is_string($value)) {
                return response()->json(['message' => 'Invalid report filter.'], 400);
            }
        }
        if (($filters['from'] !== '' && !$this->isValidReportDate($filters['from']))
            || ($filters['to'] !== '' && !$this->isValidReportDate($filters['to']))
            || ($filters['from'] !== '' && $filters['to'] !== '' && $filters['from'] > $filters['to'])) {
            return response()->json(['message' => 'Invalid report date range.'], 400);
        }
        if (mb_strlen($filters['type']) > 100
            || ($filters['status'] !== '' && !in_array($filters['status'], ['Pending', 'In Review', 'Needs Information', 'Approved', 'Rejected'], true))) {
            return response()->json(['message' => 'Invalid report filter.'], 400);
        }

        return $filters;
    }

    private function staffReportRequests(): array
    {
        return DB::table('requests')
            ->select('id', 'type', 'status', 'created_at', 'status_history')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn ($request) => [
                'id' => $request->id,
                'type' => $request->type,
                'status' => $request->status,
                'date' => $request->created_at,
                'statusHistory' => ApiIdentity::decodeJson($request->status_history),
            ])
            ->all();
    }

    private function staffRequestReport(array $requests, array $filters): array
    {
        [$fromTime, $toTime] = $this->reportTimeBounds($filters);
        $selected = $this->filterStaffReportRequests($requests, $filters);
        $requestsById = array_column($requests, null, 'id');
        $requestTypes = array_values(array_unique(array_filter(array_column($requests, 'type'))));
        $statuses = array_values(array_unique(array_filter(array_column($requests, 'status'))));
        sort($requestTypes, SORT_STRING);
        sort($statuses, SORT_STRING);

        $decisions = [];
        foreach ($requests as $item) {
            if (($filters['type'] !== '' && $item['type'] !== $filters['type'])
                || ($filters['status'] !== '' && $item['status'] !== $filters['status'])) {
                continue;
            }
            $decision = $this->lastRequestDecision($item['statusHistory']);
            if ($decision && ($fromTime === null || $decision['timestamp'] >= $fromTime)
                && ($toTime === null || $decision['timestamp'] < $toTime)) {
                $decisions[] = [
                    'id' => $item['id'],
                    'type' => $item['type'],
                    'status' => $decision['status'],
                    'timestamp' => $decision['timestamp'],
                ];
            }
        }

        $statusCounts = [];
        $typeCounts = [];
        $activeCount = 0;
        $submissionTimes = [];
        foreach ($selected as $item) {
            $statusCounts[$item['status']] = ($statusCounts[$item['status']] ?? 0) + 1;
            $typeCounts[$item['type']] = ($typeCounts[$item['type']] ?? 0) + 1;
            if (!in_array($item['status'], ['Approved', 'Rejected'], true)) {
                $activeCount++;
            }
            $timestamp = $this->reportTimestamp($item['date']);
            if ($timestamp !== null) {
                $submissionTimes[] = $timestamp;
            }
        }

        $approvedDecisions = count(array_filter($decisions, fn ($item) => $item['status'] === 'Approved'));
        $rejectedDecisions = count($decisions) - $approvedDecisions;
        $decisionDurations = [];
        foreach ($decisions as $decision) {
            $request = $requestsById[$decision['id']] ?? null;
            $created = $request ? $this->reportTimestamp($request['date']) : null;
            if ($created !== null && $decision['timestamp'] >= $created) {
                $decisionDurations[] = ($decision['timestamp'] - $created) / 3600;
            }
        }

        $unit = $this->activityBucketUnit($fromTime, $toTime, $submissionTimes);
        $activity = [];
        foreach ($selected as $item) {
            $timestamp = $this->reportTimestamp($item['date']);
            if ($timestamp !== null && ($fromTime === null || $timestamp >= $fromTime)
                && ($toTime === null || $timestamp < $toTime)) {
                $key = $this->activityBucketKey($timestamp, $unit);
                $activity[$key] ??= ['period' => $key, 'received' => 0, 'decisions' => 0];
                $activity[$key]['received']++;
            }
        }
        foreach ($decisions as $decision) {
            $key = $this->activityBucketKey($decision['timestamp'], $unit);
            $activity[$key] ??= ['period' => $key, 'received' => 0, 'decisions' => 0];
            $activity[$key]['decisions']++;
        }
        ksort($activity, SORT_STRING);
        $activity = array_values(array_map(fn ($bucket) => $bucket + ['unit' => $unit], $activity));
        usort($decisions, fn ($left, $right) => $right['timestamp'] <=> $left['timestamp']);
        $recentDecisions = array_slice($decisions, 0, 10);
        $recentDecisions = array_map(fn ($item) => [
            'id' => $item['id'],
            'type' => $item['type'],
            'status' => $item['status'],
            'date' => \Illuminate\Support\Carbon::createFromTimestampUTC($item['timestamp'])->toISOString(),
        ], $recentDecisions);

        return [
            'summary' => [
                'received' => count($selected),
                'pendingReview' => $statusCounts['Pending'] ?? 0,
                'inProcessing' => $statusCounts['In Review'] ?? 0,
                'needsInformation' => $statusCounts['Needs Information'] ?? 0,
                'approved' => $statusCounts['Approved'] ?? 0,
                'rejected' => $statusCounts['Rejected'] ?? 0,
                'active' => $activeCount,
                'approvedDecisions' => $approvedDecisions,
                'rejectedDecisions' => $rejectedDecisions,
                'decisionCount' => count($decisions),
                'approvalRate' => count($decisions) ? (int) round($approvedDecisions / count($decisions) * 100) : null,
                'pendingRate' => count($selected) ? (int) round($activeCount / count($selected) * 100) : null,
                'averageDecisionHours' => $decisionDurations ? (int) round(array_sum($decisionDurations) / count($decisionDurations)) : null,
                'deadlineTracking' => false,
                'releaseTracking' => false,
                'missingSubmissionDates' => count(array_filter($requests, fn ($item) => $this->reportTimestamp($item['date']) === null)),
            ],
            'requestTypes' => $requestTypes,
            'statuses' => $statuses,
            'statusDistribution' => array_map(fn ($name, $count) => ['name' => $name, 'count' => $count], array_keys($statusCounts), array_values($statusCounts)),
            'typeBreakdown' => array_map(fn ($name, $count) => ['name' => $name, 'count' => $count], array_keys($typeCounts), array_values($typeCounts)),
            'activity' => $activity,
            'recentDecisions' => $recentDecisions,
            'generatedAt' => now()->toISOString(),
        ];
    }

    private function filterStaffReportRequests(array $requests, array $filters): array
    {
        [$fromTime, $toTime] = $this->reportTimeBounds($filters);

        return array_values(array_filter($requests, function ($item) use ($filters, $fromTime, $toTime) {
            $timestamp = $this->reportTimestamp($item['date']);

            return $timestamp !== null
                && ($fromTime === null || $timestamp >= $fromTime)
                && ($toTime === null || $timestamp < $toTime)
                && ($filters['type'] === '' || $item['type'] === $filters['type'])
                && ($filters['status'] === '' || $item['status'] === $filters['status']);
        }));
    }

    private function lastRequestDecision(array $history): ?array
    {
        $decisions = [];
        foreach ($history as $entry) {
            if (!is_array($entry) || !in_array($entry['status'] ?? null, ['Approved', 'Rejected'], true)) {
                continue;
            }
            $timestamp = $this->reportTimestamp($entry['createdAt'] ?? $entry['created_at'] ?? null);
            if ($timestamp !== null) {
                $decisions[] = ['status' => $entry['status'], 'timestamp' => $timestamp];
            }
        }
        usort($decisions, fn ($left, $right) => $left['timestamp'] <=> $right['timestamp']);

        return $decisions ? $decisions[count($decisions) - 1] : null;
    }

    private function reportTimestamp(mixed $value): ?int
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->getTimestamp();
        }
        if (!is_string($value) || trim($value) === '') {
            return null;
        }
        try {
            return \Illuminate\Support\Carbon::parse($value)->getTimestamp();
        } catch (Throwable) {
            return null;
        }
    }

    private function reportTimeBounds(array $filters): array
    {
        return [
            $filters['from'] === '' ? null : \Illuminate\Support\Carbon::parse($filters['from'], 'Asia/Manila')->startOfDay()->getTimestamp(),
            $filters['to'] === '' ? null : \Illuminate\Support\Carbon::parse($filters['to'], 'Asia/Manila')->addDay()->startOfDay()->getTimestamp(),
        ];
    }

    private function activityBucketUnit(?int $fromTime, ?int $toTime, array $timestamps): string
    {
        if ($fromTime !== null && $toTime !== null) {
            $days = (int) ceil(($toTime - $fromTime) / 86400);

            return $days <= 31 ? 'day' : ($days <= 120 ? 'week' : 'month');
        }
        if (count($timestamps) < 2) {
            return 'month';
        }
        $days = (max($timestamps) - min($timestamps)) / 86400;

        return $days <= 31 ? 'day' : ($days <= 120 ? 'week' : 'month');
    }

    private function activityBucketKey(int $timestamp, string $unit): string
    {
        $date = \Illuminate\Support\Carbon::createFromTimestampUTC($timestamp)->setTimezone('Asia/Manila');
        if ($unit === 'day') {
            return $date->toDateString();
        }
        if ($unit === 'week') {
            return $date->startOfWeek(\Illuminate\Support\Carbon::MONDAY)->toDateString();
        }

        return $date->format('Y-m');
    }

    private function escapeCsvCell(mixed $value): string
    {
        $text = (string) ($value ?? '');
        if (preg_match('/^[\s\x00-\x1f]*[=+\-@]/', $text)) {
            $text = "'".$text;
        }

        return '"'.str_replace('"', '""', $text).'"';
    }

    private function isValidReportDate(string $value): bool
    {
        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $matches)) {
            return false;
        }

        return checkdate((int) $matches[2], (int) $matches[3], (int) $matches[1]);
    }

    private function applyManilaDateFilter(\Illuminate\Database\Query\Builder $query, string $column, string $from, string $to): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            if ($from !== '') {
                $query->whereRaw("({$column} AT TIME ZONE 'Asia/Manila')::date >= ?", [$from]);
            }
            if ($to !== '') {
                $query->whereRaw("({$column} AT TIME ZONE 'Asia/Manila')::date <= ?", [$to]);
            }

            return;
        }
        if ($from !== '') {
            $query->whereDate($column, '>=', $from);
        }
        if ($to !== '') {
            $query->whereDate($column, '<=', $to);
        }
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

    private function captainPhotoStorageConfigured(): bool
    {
        $disk = config('filesystems.disks.s3');

        return filled($disk['bucket'] ?? null)
            && filled($disk['key'] ?? null)
            && filled($disk['secret'] ?? null);
    }

    private function hasCaptainPhotoSignature(string|false $signature, string $contentType): bool
    {
        if ($contentType === 'image/jpeg') {
            return is_string($signature) && strlen($signature) >= 3
                && substr($signature, 0, 3) === "\xFF\xD8\xFF";
        }
        if ($contentType === 'image/png') {
            return is_string($signature) && strlen($signature) >= 8
                && substr($signature, 0, 8) === "\x89PNG\r\n\x1A\n";
        }
        if ($contentType === 'image/webp') {
            return is_string($signature) && strlen($signature) >= 12
                && substr($signature, 0, 4) === 'RIFF'
                && substr($signature, 8, 4) === 'WEBP';
        }

        return false;
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

    private function findRegistryPotentialMatches(string $firstName, string $lastName, ?string $birthDate): Collection
    {
        return DB::table('resident_registry')
            ->orderBy('created_at')
            ->get(['id', 'encrypted_data', 'purok', 'zone', 'verification_status'])
            ->map(fn ($resident) => ['row' => $resident, 'private' => ResidentRegistryData::decrypt($resident)])
            ->filter(function ($entry) use ($firstName, $lastName, $birthDate) {
                $private = $entry['private'];

                return mb_strtolower($private['firstName']) === mb_strtolower($firstName)
                    && mb_strtolower($private['lastName']) === mb_strtolower($lastName)
                    && (!$birthDate || $private['birthDate'] === $birthDate);
            })
            ->take(5)
            ->map(fn ($entry) => [
                'id' => $entry['row']->id,
                'firstName' => $entry['private']['firstName'],
                'lastName' => $entry['private']['lastName'],
                'birthDate' => $entry['private']['birthDate'],
                'householdId' => $entry['private']['householdId'],
                'purok' => $entry['row']->purok,
                'zone' => $entry['row']->zone === null ? null : (int) $entry['row']->zone,
                'verificationStatus' => $entry['row']->verification_status,
            ])->values();
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
            'statusHistory' => ApiIdentity::decodeJson($row->status_history ?? []),
            'date' => $row->created_at,
            'createdAt' => $row->created_at,
            'updatedAt' => $row->updated_at,
        ];
        if ($user) {
            $data['firstName'] = $user->first_name ?? $user->firstName ?? '';
            $data['lastName'] = $user->last_name ?? $user->lastName ?? '';
            $data['first_name'] = $user->first_name ?? $user->firstName ?? '';
            $data['last_name'] = $user->last_name ?? $user->lastName ?? '';
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

    private function announcementList(): array
    {
        return DB::table('announcements')->orderByDesc('created_at')->get()
            ->map(fn ($announcement) => $this->announcementData($announcement))
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
            'socialChannels' => ApiIdentity::decodeJson($row->social_channels),
            'createdAt' => $row->created_at,
        ];
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
