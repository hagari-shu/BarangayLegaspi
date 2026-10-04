<?php

$configuredOrigins = array_filter(array_map('trim', explode(',', (string) env('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173'))));

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => $configuredOrigins,
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
