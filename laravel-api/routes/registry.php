<?php

use App\Http\Controllers\ResidentRegistryController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth.api', 'role:staff'])->group(function (): void {
    Route::get('/staff/registry-source-reviews', [ResidentRegistryController::class, 'sourceReviews']);
    Route::post('/staff/registry-source-reviews', [ResidentRegistryController::class, 'openSourceReview']);
    Route::patch('/staff/registry-source-reviews/{id}/resolve', [ResidentRegistryController::class, 'resolveSourceReview']);

    Route::get('/staff/residents/zones', [ResidentRegistryController::class, 'zones']);
    Route::get('/staff/residents/{id}', [ResidentRegistryController::class, 'show']);
    Route::get('/staff/residents', [ResidentRegistryController::class, 'index']);
    Route::post('/staff/residents/import', [ResidentRegistryController::class, 'import']);
    Route::post('/staff/residents', [ResidentRegistryController::class, 'store']);
    Route::patch('/staff/residents/{id}/verify', [ResidentRegistryController::class, 'verify']);
    Route::patch('/staff/residents/{id}/status', [ResidentRegistryController::class, 'updateStatus']);
    Route::patch('/staff/residents/{id}', [ResidentRegistryController::class, 'update']);
    Route::get('/staff/demographics', [ResidentRegistryController::class, 'demographics']);
});

Route::middleware(['auth.api', 'role:admin'])->post(
    '/admin/residents/{id}/archive',
    [ResidentRegistryController::class, 'archiveResidentAccount']
);
