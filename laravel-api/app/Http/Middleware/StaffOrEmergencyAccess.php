<?php

namespace App\Http\Middleware;

use App\Support\ApiIdentity;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class StaffOrEmergencyAccess
{
    public function handle(Request $request, Closure $next, string $scope, string $allowResident = ''): Response
    {
        $actor = $request->attributes->get('actor');

        if ($allowResident === 'resident' && $actor?->role === 'resident') {
            return $next($request);
        }

        if ($actor?->role === 'staff') {
            return $next($request);
        }

        if ($actor?->role !== 'admin') {
            return response()->json(['message' => 'Access denied for this role.'], 403);
        }

        $grant = DB::table('emergency_access_grants')
            ->where('active_slot', 'global')
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->first();
        $scopes = $grant ? ApiIdentity::decodeJson($grant->scopes) : [];

        if (!$grant || $grant->admin_id !== $actor->id || !in_array($scope, $scopes, true)) {
            DB::table('audit_logs')->insert([
                'id' => (string) Str::uuid(),
                'actor_id' => $actor->id,
                'actor_role' => $actor->role,
                'action' => 'emergency_access.denied',
                'target_type' => 'permission',
                'target_id' => $scope,
                'metadata' => json_encode(['scope' => $scope]),
                'created_at' => now(),
            ]);

            return response()->json(['message' => 'Activate the required emergency access scope before using this staff operation.'], 403);
        }

        DB::table('audit_logs')->insert([
            'id' => (string) Str::uuid(),
            'actor_id' => $actor->id,
            'actor_role' => $actor->role,
            'action' => 'emergency_access.used',
            'target_type' => 'permission',
            'target_id' => $scope,
            'metadata' => json_encode(['scope' => $scope, 'grantId' => $grant->id]),
            'created_at' => now(),
        ]);

        return $next($request);
    }
}
