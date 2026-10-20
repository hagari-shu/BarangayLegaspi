# Hostinger deployment preparation

This guide prepares a staged migration of the current production system:

- Vite/React frontend
- Node.js/Express API
- Laravel/PHP API
- PostgreSQL database

The active production frontend and API currently use Vercel and Render. Keep those services and the existing database running until the Hostinger deployment has passed the verification and rollback checks below. Do not point the production domain at Hostinger or delete the current services as part of preparation.

## Before deployment

1. Choose the public website domain and API hostnames, for example `www.example.org`, `api.example.org`, and `laravel-api.example.org`.
2. Use a Hostinger VPS with root access for a single-provider deployment. The shared Web Hosting offers visible in hPanel include Node.js only on the Unlimited tier and list MySQL databases, not PostgreSQL; this application requires PostgreSQL. Hostinger's VPS provides root access so PostgreSQL, Node.js, PHP, and the web server can be installed and configured together.
3. Select a VPS operating system supported by Hostinger's current images and confirm the selected region/data center, CPU, RAM, disk, backup options, and renewal price during checkout. KVM 2 (2 vCPU, 8 GB RAM, 100 GB NVMe) is a reasonable staging starting point, not a production capacity guarantee. Size production from actual load and backup/monitoring requirements.
4. Plan server operations: security updates, firewall, SSH key-only access, TLS renewal, process supervision, log rotation, monitoring/alerts, PostgreSQL backups, and restore drills. Hostinger advertises weekly VPS backups; weekly snapshots alone are not an adequate backup plan for a production resident database.
5. Arrange a maintenance window and an authorized database operator. Resident and staff records are sensitive; transfer backups only through approved, encrypted channels with access limited to the migration operators. Do not put credentials in GitHub, the repository, or chat.

## Provision a staging VPS

1. Create an isolated staging VPS and provision a non-production SSH key. Do not point production DNS at it.
2. Install and configure a supported Ubuntu LTS release, Nginx, Node.js 22.12 or newer, PHP 8.2 or newer with PHP-FPM and `pdo_pgsql`, Composer, and PostgreSQL. Keep PostgreSQL bound to localhost/private networking; do not expose port 5432 publicly.
3. Create separate least-privilege PostgreSQL roles and empty databases for Node staging and Laravel staging. Restrict the firewall to SSH from trusted addresses plus HTTP/HTTPS; enable automatic security updates and SSH key authentication.
4. Deploy the Node API from repository `main` with `npm ci --omit=dev` and the startup command `npm start` under a process supervisor such as systemd. Configure private environment variables including `NODE_ENV=production`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGINS`. Add other settings only when the corresponding feature is enabled.
5. Configure Nginx to serve the built Vite frontend over HTTPS and proxy `/api/` to the Node API. This same-origin layout avoids cross-origin browser requests. If using separate origins, set `CORS_ORIGINS` to the exact HTTPS frontend origin(s); never use `*`.
6. Preserve the current production `JWT_SECRET` and `MFA_ENCRYPTION_KEY` during an approved production database migration. Changing them can invalidate sessions or prevent existing MFA credentials from decrypting. Keep secrets in root-readable environment files or a secret manager, never in source control or chat.
7. Leave all `ADMIN_*` seed variables unset when importing the production database. The database initialization path creates schema but should not create another administrator.
8. Verify `https://<website-domain>/api/health` returns HTTP 200 and reports PostgreSQL storage. Confirm startup logs contain no database or configuration errors.

## Deploy Laravel/PHP as a separate staging API

Laravel is included in the repository under `laravel-api`, but it is not currently the production API and does not yet have confirmed feature parity with the Node API. Deploy it as a separate staging service; do not route the live frontend to it or let it write to the production database during preparation.

The current route inventory finds 42 Node API routes missing from Laravel's route declarations. The missing surface includes the resident registry, official profile/logo/photo management, staff invitations and temporary access, staff presence/reporting, and other Admin workflows. Matching health responses and empty announcement/event collections does not establish application workflow parity.

The repository's current `render.yaml` points the staged Laravel service at the existing `barangay-legaspi-db` PostgreSQL resource, and its Docker entrypoint runs migrations at service startup. Treat this as a shared database/schema, not an isolated staging copy. Do not rely on the existing Laravel service as a safe staging environment or deploy migration changes there until an authorized operator confirms the database topology, takes a backup, and approves the migration against a separate staging copy.

1. Use a separate empty PostgreSQL database and least-privilege role for Laravel. Do not point both API implementations at the production database or one shared staging database until schema and transaction compatibility are verified.
2. Deploy Laravel from `laravel-api` using PHP 8.2 or newer and production Composer dependencies from `composer.lock`. Configure Nginx/PHP-FPM with document root `laravel-api/public`; enable `pdo_pgsql`, `mbstring`, `openssl`, `tokenizer`, `xml`, `ctype`, `curl`, `fileinfo`, and `zip`. Keep `storage` and `bootstrap/cache` writable by the application user. When running Composer package-discovery scripts during build/release, set `APP_ENV=local` (or `testing` in CI) so production startup validation is reserved for the actual service runtime.
3. Configure Laravel's private environment values for production mode, `APP_DEBUG=false`, a unique `APP_KEY`, the staging `DATABASE_URL`, a distinct random `JWT_SECRET` of at least 32 characters, and exact HTTPS `CORS_ORIGINS`. Laravel now refuses to boot in production with debug enabled, a non-PostgreSQL database, a missing/non-HTTPS CORS origin, a missing/short/placeholder JWT secret, or a JWT secret equal to the app key. Preserve the current production JWT/MFA secrets only for a reviewed migration to production data; never copy them into an isolated test environment unnecessarily.
4. Run Laravel migrations only against the empty staging database first. The container entrypoint in `laravel-api/docker-entrypoint.sh` runs `php artisan migrate --force`; on a VPS deployment, run migrations as a controlled release step over SSH, after confirming Laravel's environment points to the staging database. The token-revocation migration adds a legacy-JWT revocation table and a token-validity timestamp to users; test it on staging before any production migration.
5. Verify `https://<laravel-api-hostname>/api/health` returns HTTP 200 and reports `pgsql`. Run the Laravel test suite from `laravel-api` with `composer install` and `php artisan test` in a development/staging environment.
6. Compare Laravel route behavior and response shapes with the Node API using the frontend contract tests and authorized test accounts. The README currently identifies Laravel API parity as incomplete. Track and fix any missing or different behavior before selecting Laravel as the production API.

Keep Node and Laravel on separate database copies until parity checks, migration behavior, account/session compatibility, audit logging, and rollback have all been reviewed. For the eventual cutover, configure the frontend to use exactly one API base URL. Do not load-balance or switch requests between Node and Laravel while both are independently mutating data.

Laravel password change and password reset revoke existing database tokens and invalidate legacy Node JWTs issued before the credential change. Laravel logout stores a short-lived hash of a revoked legacy JWT until that JWT expires. Confirm these session-expiration behaviors in staging before cutover.

## Initial production Admin

The repository supports two distinct account paths:

- Once an Admin exists, authenticated Admin/Staff screens can create accounts. The generated temporary password is shown once to the creator, and the new user must change it before accessing the portal.
- To bootstrap the first Admin, the protected GitHub Actions workflow sends a single-use, 12-hour setup invitation. The invitee verifies the email address and chooses their own password. It does not generate or send a temporary password; this avoids handing an initial credential through the operator or CI logs.

Do not dispatch the invitation until `https://barangay-legaspi.gov.ph` is registered to the barangay, points to the tested production portal, and serves HTTPS. Then configure the GitHub repository's protected `production` environment:

- Variables: `PUBLIC_APP_URL` (the exact deployed HTTPS portal origin), `SUPER_ADMIN_INVITATION_FROM_EMAIL` (verified sender), and `PRODUCTION_ACCOUNT_WORKFLOW_ENABLED` (set to `true` only after all checks below).
- Secrets: `PRODUCTION_DATABASE_URL`, `PRODUCTION_JWT_SECRET`, and `RESEND_API_KEY`.

The workflow now fails closed when `PUBLIC_APP_URL`, database/JWT configuration, invitation email configuration, or explicit workflow enablement is absent. After confirming the portal URL and invitation delivery, enable the workflow and choose `invite-admin` in the protected Actions workflow. Enter only the intended recipient email in the workflow form; the recipient creates their password from the emailed setup invitation. Never put a temporary password, database URL, API key, or invitation link into source control or chat.

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

The Hostinger VPS has been paid for, but the user reports it is still provisioning and has not been configured. The hPanel view available to this session is still loading and does not expose a server address or console, so no deployment connection is available yet. The intended domain is `barangay-legaspi.gov.ph`, but current registration, ownership, and DNS control have not been confirmed. The production database credentials are not available in this session. No Hostinger app, database, backup, DNS, or production traffic has been changed.

Laravel API parity is not complete (42 Node routes are missing in the current route inventory). Laravel's feature tests pass in GitHub Actions (20 tests, 86 assertions, commit `7e1477e` on `readiness/laravel-prod-hardening`); they could not be run locally because Composer and required PHP extensions are absent. This does not establish staging or production readiness, and the feature branch has not been merged or deployed.

The latest public checks found the active Node API healthy. All three official profile-photo endpoints now return `Cross-Origin-Resource-Policy: cross-origin`, so the earlier cross-origin header blocker is resolved in the live API. They still return `204 No Content`, meaning no photo is currently available and the frontend should show its fallback until an authorized Admin uploads one. The Vercel site currently serves `assets/index-Da49UIDO.js` and `assets/index-B2nn0lV0.css`; both filenames match a fresh local production build, so the deployed frontend bundle matches the current source build.
