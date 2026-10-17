<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class AdminMonitoringOnly
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = $request->attributes->get('actor');

        if ($actor?->role !== 'admin' || in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            return $next($request);
        }

        if ($this->isAllowedAdminOperation($request)) {
            return $next($request);
        }

        DB::table('audit_logs')->insert([
            'id' => (string) Str::uuid(),
            'actor_id' => $actor->id,
            'actor_role' => $actor->role,
            'action' => 'admin.read_only.denied',
            'target_type' => 'permission',
            'target_id' => $request->route()?->uri() ?? 'unknown',
            'metadata' => json_encode(['method' => $request->method()]),
            'created_at' => now(),
        ]);

        return response()->json([
            'message' => 'Administrator access is read-only. Use an approved emergency staff scope for staff operations.',
        ], 403);
    }

    private function isAllowedAdminOperation(Request $request): bool
    {
        $method = $request->method();
        $path = '/'.$request->path();
        $allowed = [
            'POST /api/logout',
            'POST /api/change-password',
            'POST /api/mfa/setup',
            'POST /api/mfa/enable',
            'POST /api/mfa/disable',
            'POST /api/admin/emergency-access',
            'POST /api/admin/emergency-access/revoke',
            'POST /api/staff/residents',
            'POST /api/staff/residents/import',
            'POST /api/staff/residents/print-audit',
            'POST /api/staff/archive-requests',
            'POST /api/staff/archive-requests/restore',
            'DELETE /api/staff/archive-file',
        ];

        if (in_array($method.' '.$path, $allowed, true)) {
            return true;
        }

        return $method === 'PATCH' && (
            preg_match('#^/api/staff/residents/[^/]+/(?:verify|status)$#', $path) === 1
            || preg_match('#^/api/requests/[^/]+/status$#', $path) === 1
        );
    }
}
