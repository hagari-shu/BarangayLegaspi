<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $actor = $request->attributes->get('actor');

        if (!$actor || !in_array($actor->role, $roles, true)) {
            return response()->json(['message' => 'Access denied for this role.'], 403);
        }

        return $next($request);
    }
}
