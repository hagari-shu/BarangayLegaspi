<?php

namespace App\Http\Middleware;

use App\Support\ApiIdentity;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ApiTokenAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = ApiIdentity::fromRequest($request);

        if (!$actor) {
            return response()->json(['message' => 'Authentication required.'], 401);
        }

        if (in_array($actor->status, ['Suspended', 'Disabled'], true)) {
            return response()->json(['message' => 'Account access is disabled.'], 403);
        }

        $request->attributes->set('actor', $actor);

        return $next($request);
    }
}
