<?php

$defaultOrigins = in_array(env('APP_ENV', 'production'), ['local', 'testing'], true)
    ? 'http://localhost:5173,http://127.0.0.1:5173'
    : '';
$configuredOrigins = array_filter(array_map('trim', explode(',', (string) env('CORS_ORIGINS', $defaultOrigins))));

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
