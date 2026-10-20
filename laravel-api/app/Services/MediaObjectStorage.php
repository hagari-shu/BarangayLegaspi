<?php

namespace App\Services;

use Aws\Exception\AwsException;
use Aws\S3\PostObjectV4;
use Aws\S3\S3Client;
use Illuminate\Support\Str;
use RuntimeException;

class MediaObjectStorage
{
    public const CAPTAIN_KEY = 'official/captain-portrait';
    public const SYSTEM_LOGO_KEY = 'branding/system-logo';
    public const OFFICIAL_KEYS = [
        'captain' => self::CAPTAIN_KEY,
        'secretary' => 'official/secretary-portrait',
        'treasurer' => 'official/treasurer-portrait',
    ];
    public const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    public const MAX_BYTES = 5 * 1024 * 1024;

    private ?S3Client $client = null;

    public function isConfigured(): bool
    {
        $config = config('services.object_storage');

        return !empty($config['bucket']) && !empty($config['key']) && !empty($config['secret']);
    }

    public function createUpload(string $keyPrefix, string $contentType): array
    {
        $this->ensureConfigured();
        $key = $keyPrefix.'/pending/'.Str::uuid();
        $post = new PostObjectV4(
            $this->client(),
            (string) config('services.object_storage.bucket'),
            ['key' => $key, 'Content-Type' => $contentType],
            [
                ['key' => $key],
                ['Content-Type' => $contentType],
                ['content-length-range', 1, self::MAX_BYTES],
            ],
            '+5 minutes',
        );

        return [
            'url' => $post->getFormAttributes()['action'],
            'fields' => $post->getFormInputs(),
            'key' => $key,
        ];
    }

    public function finalizeUpload(string $prefix, string $key, string $publishedKey, string $invalidUploadMessage): void
    {
        $this->ensureConfigured();
        $uploadId = str_starts_with($key, $prefix.'/pending/') ? substr($key, strlen($prefix.'/pending/')) : '';
        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $uploadId)) {
            throw new RuntimeException($invalidUploadMessage);
        }

        $bucket = (string) config('services.object_storage.bucket');
        $client = $this->client();
        try {
            $metadata = $client->headObject(['Bucket' => $bucket, 'Key' => $key]);
            $contentType = $metadata['ContentType'] ?? '';
            $length = (int) ($metadata['ContentLength'] ?? 0);
            if (!in_array($contentType, self::CONTENT_TYPES, true) || $length < 1 || $length > self::MAX_BYTES) {
                $client->deleteObject(['Bucket' => $bucket, 'Key' => $key]);
                throw new RuntimeException('Upload must be a supported image of 5 MB or smaller.');
            }

            $image = $client->getObject(['Bucket' => $bucket, 'Key' => $key, 'Range' => 'bytes=0-11']);
            $bytes = (string) $image['Body'];
            if (!$this->hasImageSignature($bytes, $contentType)) {
                $client->deleteObject(['Bucket' => $bucket, 'Key' => $key]);
                throw new RuntimeException('Uploaded file is not a valid supported image.');
            }

            $client->copyObject([
                'Bucket' => $bucket,
                'Key' => $publishedKey,
                'CopySource' => $bucket.'/'.$key,
                'ContentType' => $contentType,
                'MetadataDirective' => 'REPLACE',
            ]);
            $client->deleteObject(['Bucket' => $bucket, 'Key' => $key]);
        } catch (AwsException $exception) {
            throw new RuntimeException('Unable to verify the uploaded image.', 0, $exception);
        }
    }

    public function url(string $key): ?string
    {
        $this->ensureConfigured();
        $bucket = (string) config('services.object_storage.bucket');
        try {
            $this->client()->headObject(['Bucket' => $bucket, 'Key' => $key]);
        } catch (AwsException $exception) {
            if ($exception->getStatusCode() === 404 || $exception->getAwsErrorCode() === 'NoSuchKey') {
                return null;
            }
            throw $exception;
        }

        $command = $this->client()->getCommand('GetObject', ['Bucket' => $bucket, 'Key' => $key]);

        return (string) $this->client()->createPresignedRequest($command, '+15 minutes')->getUri();
    }

    public function delete(string $key): void
    {
        $this->ensureConfigured();
        $this->client()->deleteObject([
            'Bucket' => (string) config('services.object_storage.bucket'),
            'Key' => $key,
        ]);
    }

    private function ensureConfigured(): void
    {
        if (!$this->isConfigured()) {
            throw new RuntimeException('Object storage is not configured.');
        }
    }

    private function client(): S3Client
    {
        if ($this->client) {
            return $this->client;
        }

        $config = config('services.object_storage');
        $clientConfig = [
            'version' => 'latest',
            'region' => $config['region'] ?: 'auto',
            'credentials' => ['key' => $config['key'], 'secret' => $config['secret']],
            'use_path_style_endpoint' => (bool) $config['use_path_style_endpoint'],
        ];
        if (!empty($config['endpoint'])) {
            $clientConfig['endpoint'] = $config['endpoint'];
        }

        return $this->client = new S3Client($clientConfig);
    }

    private function hasImageSignature(string $bytes, string $contentType): bool
    {
        return match ($contentType) {
            'image/jpeg' => strlen($bytes) >= 3 && substr($bytes, 0, 3) === "\xFF\xD8\xFF",
            'image/png' => strlen($bytes) >= 8 && substr($bytes, 0, 8) === "\x89PNG\r\n\x1A\n",
            'image/webp' => strlen($bytes) >= 12 && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP',
            default => false,
        };
    }
}
