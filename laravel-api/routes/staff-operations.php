<?php

use App\Http\Controllers\StaffOperationsController;
use Illuminate\Support\Facades\Route;

Route::post('/staff/invitations/validate', [StaffOperationsController::class, 'validateInvitation'])->middleware('throttle:12,1');
Route::post('/staff/invitations/accept', [StaffOperationsController::class, 'acceptInvitation'])->middleware('throttle:12,1');
Route::post('/staff/invitations', [StaffOperationsController::class, 'createInvitation'])->middleware(['auth.api', 'role:staff,admin', 'throttle:12,1']);
Route::post('/staff/temporary-access/redeem', [StaffOperationsController::class, 'redeemTemporaryAccess'])->middleware('throttle:12,1');
Route::post('/announcements/{id}/retract', [StaffOperationsController::class, 'retractAnnouncement'])->middleware(['auth.api', 'role:staff,admin']);
Route::get('/staff/dashboard-requests', [StaffOperationsController::class, 'dashboardRequests'])->middleware(['auth.api', 'role:staff,admin']);
Route::get('/staff/reports/export.csv', [StaffOperationsController::class, 'exportReports'])->middleware(['auth.api', 'role:staff,admin']);
Route::get('/staff/reports', [StaffOperationsController::class, 'reports'])->middleware(['auth.api', 'role:staff,admin']);
Route::post('/staff/presence', [StaffOperationsController::class, 'updatePresence'])->middleware(['auth.api', 'role:staff']);
Route::get('/admin/staff/presence', [StaffOperationsController::class, 'staffPresence'])->middleware(['auth.api', 'role:admin']);
Route::post('/admin/staff/{id}/password', [StaffOperationsController::class, 'resetStaffPassword'])->middleware(['auth.api', 'role:admin']);
Route::post('/admin/staff/{id}/temporary-access', [StaffOperationsController::class, 'issueTemporaryAccess'])->middleware(['auth.api', 'role:admin', 'throttle:12,1']);

Route::post('/login/mfa', [StaffOperationsController::class, 'completeMfa'])->middleware('throttle:12,1');
