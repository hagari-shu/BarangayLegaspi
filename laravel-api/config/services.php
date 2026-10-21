<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
        'from_email' => env('PASSWORD_RESET_FROM_EMAIL', env('SUPER_ADMIN_INVITATION_FROM_EMAIL')),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'public_content' => [
        'api_base' => env('PUBLIC_CONTENT_API_BASE'),
    ],

    'object_storage' => [
        'bucket' => env('OBJECT_STORAGE_BUCKET'),
        'key' => env('OBJECT_STORAGE_ACCESS_KEY_ID'),
        'secret' => env('OBJECT_STORAGE_SECRET_ACCESS_KEY'),
        'endpoint' => env('OBJECT_STORAGE_ENDPOINT'),
        'region' => env('OBJECT_STORAGE_REGION', 'auto'),
        'use_path_style_endpoint' => env('OBJECT_STORAGE_FORCE_PATH_STYLE', false),
    ],

    'meta' => [
        'page_id' => env('META_PAGE_ID'),
        'page_access_token' => env('META_PAGE_ACCESS_TOKEN'),
        'app_secret' => env('META_APP_SECRET'),
        'webhook_verify_token' => env('META_WEBHOOK_VERIFY_TOKEN'),
        'graph_api_version' => env('META_GRAPH_API_VERSION'),
    ],

];
