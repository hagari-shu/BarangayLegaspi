<?php

use App\Http\Controllers\MediaController;
use Illuminate\Support\Facades\Route;

Route::get('/captain-photo', [MediaController::class, 'captainPhoto']);
Route::get('/system-logo', [MediaController::class, 'systemLogo']);
Route::get('/official-profiles', [MediaController::class, 'officialProfiles']);
Route::get('/official-profiles/{role}/photo', [MediaController::class, 'officialPhoto']);
Route::get('/meta/webhook', [MediaController::class, 'verifyMetaWebhook']);
Route::post('/meta/webhook', [MediaController::class, 'receiveMetaWebhook']);

Route::middleware('auth.api')->group(function (): void {
    Route::post('/admin/captain-photo/upload-url', [MediaController::class, 'createCaptainPhotoUpload']);
    Route::post('/admin/captain-photo', [MediaController::class, 'finalizeCaptainPhoto']);
    Route::delete('/admin/captain-photo', [MediaController::class, 'deleteCaptainPhoto']);

    Route::post('/admin/system-logo/upload-url', [MediaController::class, 'createSystemLogoUpload']);
    Route::post('/admin/system-logo', [MediaController::class, 'finalizeSystemLogo']);
    Route::delete('/admin/system-logo', [MediaController::class, 'deleteSystemLogo']);

    Route::put('/admin/official-profiles/{role}', [MediaController::class, 'updateOfficialProfile']);
    Route::post('/admin/official-profiles/{role}/photo/upload-url', [MediaController::class, 'createOfficialPhotoUpload']);
    Route::post('/admin/official-profiles/{role}/photo', [MediaController::class, 'finalizeOfficialPhoto']);
    Route::delete('/admin/official-profiles/{role}/photo', [MediaController::class, 'deleteOfficialPhoto']);

    Route::get('/social-integrations/status', [MediaController::class, 'socialIntegrationStatus']);
});
