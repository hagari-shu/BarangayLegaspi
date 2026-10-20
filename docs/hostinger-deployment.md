# Hostinger deployment preparation

This guide prepares a staged migration of the current production system:

- Vite/React frontend
- Node.js/Express API
- Laravel/PHP API
- PostgreSQL database

The active production frontend and API currently use Vercel and Render. Keep those services and the existing database running until the Hostinger deployment has passed the verification and rollback checks below. Do not point the production domain at Hostinger or delete the current services as part of preparation.

## Before deployment

1. Choose the public website domain and API hostnames, for example `www.example.org`, `api.example.org`, and `laravel-api.example.org`. Keep the website and API services on separate origins unless deliberately reconfigured.
2. Confirm the Hostinger plan supports Node.js 22.12 or newer, a persistent Node.js web app, PHP 8.2 or newer, Composer, the `pdo_pgsql` extension, outbound HTTPS, and managed PostgreSQL. Confirm both apps can use the selected database service.
3. Confirm whether Hostinger's database allows secure remote connections from the current production database. If not, arrange an approved secure backup-and-restore path with Hostinger support before migrating. Do not put database credentials in GitHub, the repository, or chat.
4. Arrange a maintenance window and an authorized database operator. Resident and staff records are sensitive; transfer backups only through approved, encrypted channels with access limited to the migration operators.

## Deploy the API as a staging service

1. Create a PostgreSQL database on Hostinger. Do not use MySQL: the production API requires PostgreSQL.
2. Create a Node.js web app connected to the repository's `main` branch. Set the application root to the repository root, the startup command to `npm start`, and the Node version to 22.12 or newer. The `start` script runs `node server.js`.
3. Configure the environment in Hostinger's private application settings. Set `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGINS`. `PORT` is supplied by the hosting platform. Add other settings only when the corresponding feature is enabled.
4. Preserve the current production `JWT_SECRET` and `MFA_ENCRYPTION_KEY` values during a database migration. Changing them can invalidate user sessions or prevent existing MFA credentials from decrypting. Transfer them using the provider's secure secret manager, not source control or chat.
5. Set `CORS_ORIGINS` to the exact HTTPS origin(s) of the new frontend, comma-separated if required. Do not use `*` for a production portal.
6. Leave all `ADMIN_*` seed variables unset when importing the production database. The database initialization path creates schema but does not need to create another administrator.
7. Verify `https://<api-hostname>/api/health` returns HTTP 200 and reports PostgreSQL storage. Confirm startup logs contain no database or configuration errors.

## Deploy Laravel/PHP as a separate staging API

Laravel is included in the repository under `laravel-api`, but it is not currently the production API and does not yet have confirmed feature parity with the Node API. Deploy it as a separate staging service; do not route the live frontend to it or let it write to the production database during preparation.

The current route inventory finds 42 Node API routes missing from Laravel's route declarations. The missing surface includes the resident registry, official profile/logo/photo management, staff invitations and temporary access, staff presence/reporting, and other Admin workflows. Matching health responses and empty announcement/event collections does not establish application workflow parity.

1. Create a separate, empty PostgreSQL staging database for Laravel. Do not point both API implementations at the production database or at one shared staging database until schema and transaction compatibility have been verified.
2. Create a PHP web application using `laravel-api` as its application root. Set the document root to `laravel-api/public`, use PHP 8.2 or newer, install dependencies from `composer.lock` with production Composer settings, and enable the required extensions including `pdo_pgsql`, `mbstring`, `openssl`, `tokenizer`, `xml`, `ctype`, `curl`, `fileinfo`, and `zip`. Keep `storage` and `bootstrap/cache` writable by the application user.
3. Configure Laravel's private environment values for production mode, a unique `APP_KEY`, the staging `DATABASE_URL`, a `JWT_SECRET` that matches the staging Node API only if shared authentication is intentionally being tested, and exact `CORS_ORIGINS`. Preserve the current production JWT/MFA secrets only for a reviewed migration to the production data; never copy them into an isolated test environment unnecessarily.
4. Run Laravel migrations only against the empty staging database first. The container entrypoint in `laravel-api/docker-entrypoint.sh` automatically runs `php artisan migrate --force`; a non-container Hostinger PHP deployment must run migrations explicitly using the Hostinger terminal/SSH or deployment release command.
5. Verify `https://<laravel-api-hostname>/api/health` returns HTTP 200 and reports `pgsql`. Run the Laravel test suite from `laravel-api` with `composer install` and `php artisan test` in a development/staging environment.
6. Compare Laravel route behavior and response shapes with the Node API using the frontend contract tests and authorized test accounts. The README currently identifies Laravel API parity as incomplete. Track and fix any missing or different behavior before selecting Laravel as the production API.

Keep Node and Laravel on separate database copies until parity checks, migration behavior, account/session compatibility, audit logging, and rollback have all been reviewed. For the eventual cutover, configure the frontend to use exactly one API base URL. Do not load-balance or switch requests between Node and Laravel while both are independently mutating data.

## Migrate the database safely

1. Take a fresh PostgreSQL backup from the current production database using the approved operator workflow. Record the backup timestamp, size, and checksum without recording credentials.
2. Restore into an isolated Hostinger staging database for the API implementation under test. Never test against or overwrite the active production database.
3. Verify schema and representative record counts with an authorized, read-only database check. Do not export resident data to logs or screenshots.
4. Test sign-in and the resident, staff, and Admin workflows on the staging frontend/API. Use authorized test accounts; do not create duplicate production users as a deployment test.
5. Keep the original database untouched and ensure the backup can be restored before planning a cutover.

## Build and deploy the frontend

The frontend is a separate static site. Build it with the final API base URL, including `/api`, and upload the **contents** of `dist` to the Hostinger document root. `VITE_API_BASE` is embedded in the public frontend bundle; it must contain only the API URL, never a secret.

For a local PowerShell build, use a temporary environment variable in the current shell:

```powershell
$env:VITE_API_BASE = 'https://<api-hostname>/api'
npm ci
npm run build
Remove-Item Env:VITE_API_BASE
```

Upload `dist` using Hostinger's supported Git/build workflow or file manager over its secure connection. `public/.htaccess` is copied to `dist` and provides the single-page-app route fallback on Apache/LiteSpeed hosting. Confirm Hostinger supports `.htaccess` rewrite rules; if it does not, configure the equivalent fallback in its web server settings. Do not upload `.env` files, backups, local database files, or the repository's development data directory.

## Staging verification and cutover gate

Use the temporary Hostinger hostname before changing DNS. Verify:

- Home page, sign-in, registration, and direct navigation to `/register` load over HTTPS.
- API health is 200 and the browser can make credentialed API requests from the exact frontend origin.
- Authorized test users can complete resident, staff, and Admin workflows, including account creation, certificate preview, and printing.
- Password reset/invitation delivery, MFA, official-profile photos, uploads, and Meta integrations work if enabled.
- Browser console and API logs contain no unexpected errors; do not include personal data or tokens in diagnostic reports.
- A fresh backup from the Hostinger database can be restored to a separate test database.

Only after all checks pass should an authorized operator schedule DNS changes. Keep Vercel, Render, and the original database available through a rollback period. If the new site or API fails after cutover, restore the previous DNS target and continue using the original services. Do not shut down the old services until the owner has approved retirement after the rollback period.

## Current blocker

The Hostinger account currently has no hosting service attached; its Websites area opens the hosting purchase page. The production domain has not been selected, and this session does not have production database credentials. The repository is prepared locally for staging, but no Hostinger app, database, backup, or production traffic has been changed. Laravel's tests could not run locally because Composer dependencies are absent and the PHP runtime lacks the PostgreSQL and SQLite PDO drivers, OpenSSL, cURL, and mbstring extensions. Laravel API parity is not complete (42 Node routes are missing in the current route inventory).

The last production check also found that the official Vercel URL serves an older JavaScript bundle than the local build. The active Node API is healthy, but its three official profile photo endpoints return `204 No Content` and `Cross-Origin-Resource-Policy: same-origin`; this blocks cross-origin image requests. The source fix is local until deployed. Profile photos are not currently available from those endpoints, so the frontend should display its fallback until an authorized Admin uploads them.
