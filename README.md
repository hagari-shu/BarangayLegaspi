# Barangay Legaspi

## Policies

- [Account approval policy](./ACCOUNT_APPROVAL_POLICY.md)
- [Location policy](./LOCATION_POLICY.md)
- [Resident, Staff, and Administrator user manual](./docs/user-manual.md)
- [Database upgrade and cutover manual](./docs/database-upgrade-manual.md)

The staff registry includes CSV batch import and an optional in-browser document scanner for JPEG, PNG, and WebP page images. Staff can choose existing images, use the phone's camera picker, or open a live rear-camera preview and capture pages directly. Live camera access requires HTTPS (or localhost on the same device) and explicit browser permission. OCR runs using locally served worker/model assets; it does not upload scans to a recognition service or auto-fill/import records. Staff must manually prepare each row, compare it with the source, and explicitly import it as pending. Build and dev scripts prepare the OCR assets from the pinned npm packages. This feature does not change the current production status or authorize real-data entry before encryption and backup controls are verified.

## Role boundaries

Administrators have read-only monitoring access. They may use personal password/MFA controls, logout, and activate or revoke their own 20-minute emergency grant. A grant allows only its listed resident-registry and request-processing operations; it never enables account, announcement, captain-photo, or other administrative writes. Staff review pending resident registrations in the Staff Portal. All Admin write attempts are rejected and audited by both APIs.

## Staff account invitations

Staff accounts are provisioned only by an authorized deployment operator through the Node API's PostgreSQL-backed CLI; there is no Admin, Staff, or public account-creation endpoint for staff. After deploying the Node API change so its startup migration creates `staff_invitations`, run `npm run staff:invite` in an authorized operator environment with `DATABASE_URL` set to that Node API's PostgreSQL database and `STAFF_INVITE_APP_URL` set to the deployed HTTPS frontend URL. The CLI prompts for an operator identifier, staff email, and Philippine mobile number, requires an explicit confirmation, and prints a single-use link once. Deliver the link out of band using an approved secure channel; do not put it in chat, tickets, source control, or logs. The link expires after 24 hours. The raw invitation token is not stored; the invitation record stores its SHA-256 hash and the invited email/mobile. The operator identifier and expiry are audited; issuance/redemption audit entries omit the token, email, and mobile number. The invitee chooses their name and password in the portal. The operator must protect terminal scrollback and avoid shell/session recording when issuing an invitation. This CLI currently supports the Node API only; it does not provision accounts in Laravel. No live invitation or account is created by this code change.

Browser printing is disabled for resident/report output because a browser cannot guarantee a physical printer instead of “Save as PDF.” The app fails closed until a managed office print server is configured and tested. Do not treat a successful audit event as proof that a hard copy was produced.

## Resident registry

The staff portal's Resident registry supports CSV preview and import, duplicate review, record search, manual resident entry, and verification. Search terms match the beginning of each name component. Imports accept up to 500 rows per batch; every imported or manually entered record is saved as pending verification, and only active, verified records are included in demographic totals. Staff can also create a persistent source-review warning for a purok/zone when source sheets are incomplete or unclear; open warnings remain visible until staff resolves them after reconciliation. Warning changes are staff-only and audited without storing resident names or free-form notes. Registry endpoints require an authenticated staff account, and responses are marked private and non-cacheable. The staff list returns only fields needed for registry work; audit entries record who created, imported, verified, or changed a record without copying resident names or uploaded filenames into audit metadata. PostgreSQL writes and their audit entries are transactional; the JSON adapter serializes registry mutations. Duplicate review is checked again atomically at write time, and identical retries do not add duplicate records. The staff interface displays a privacy notice instructing users to use only necessary data for authorized duties and not share screenshots or exports outside approved work. The Node API initializes the PostgreSQL registry tables on startup. Before loading real resident data, confirm the office's authority, provide its approved privacy notice, establish least-privilege access and a retention schedule, and use the managed staff workflow rather than writing directly to the database.

## Deployment

### Hostinger VPS target (Laravel/PHP)

The application is prepared for a Hostinger VPS deployment that keeps Laravel 12/PHP as the API, PostgreSQL as the database, and the React frontend as static files served from the same origin. Caddy terminates HTTPS automatically. PostgreSQL is on an internal Docker network and is not exposed on a public port.

This configuration is a deployment target, not a production cutover. The current live frontend/API remain on Vercel/Render until a Hostinger VPS is provisioned, an isolated staging restore is verified, and the authenticated role-based checks and rollback rehearsal pass. Do not migrate production records or point DNS at the VPS before those gates are complete.

1. Provision a Hostinger VPS plan that supports Docker and meets the application's resource needs. Confirm the current checkout and renewal price in your Hostinger account before purchase. Create a staging subdomain and point its A record directly to the VPS (disable any DNS proxy during initial certificate issuance). Allow inbound TCP 80/443 (and UDP 443 for HTTP/3); retain SSH access. Prepare the public IPv4 address of the office/test connection that should be allowed to access staging.
2. Use a supported Ubuntu image with Docker Engine and Docker Compose v2 installed. Transfer the reviewed project through an authorized private Git checkout or secure file transfer; do not put database exports or secrets in the repository.
3. From the project directory on the VPS, run `sudo bash scripts/hostinger-vps-setup.sh`. The script verifies that the staging hostname resolves to that VPS, asks for the authorized administrator contacts and staging-access IPv4, generates unique secrets, writes `.env.hostinger` with owner-only permissions, builds the images, creates a new PostgreSQL database, explicitly runs its initial migrations, and checks Laravel's PostgreSQL health endpoint. Caddy restricts staging to that IPv4. Keep the temporary admin password printed at the end private, store it securely, clear terminal scrollback, and change it after first login.
4. This automated bootstrap creates a **new, empty database**. It does not migrate production residents, requests, announcements, account passwords, or MFA enrollment. Do not use production DNS or import live data until the production backup has been verified, restore has been rehearsed on isolated staging, authenticated role checks pass, and rollback has been tested.
5. Configure private object storage and authenticated password-reset delivery before enabling those workflows. Configure tested, encrypted off-server database backups with a documented retention and restore procedure. The Compose volume alone is not a backup. Never run `docker compose down -v` on a database containing data.
6. Before production DNS cutover, remove the staging-only IP allowlist from `Caddyfile`, then review the VPS firewall, HTTPS, off-server backups, and monitoring. Keep an independent staging environment with its own database and access restrictions.

The Laravel container skips startup migrations in this stack. Run migrations explicitly after a verified backup; do not enable `RUN_MIGRATIONS` on production without a reviewed change and recovery point. The API has no published host port, and PostgreSQL is reachable only on its internal network; the frontend Nginx proxy forwards `/api/` to Laravel, and Caddy serves the frontend over HTTPS.

### Current Vercel/Render deployment

Deploy the React/Vite frontend to Vercel and the Laravel API to Render:

1. Set the Vercel build command to `npm run build`.
2. Set `VITE_API_BASE` in Vercel to the public API URL ending in `/api` (for example, `https://brgy-legaspi-laravel.onrender.com/api`).
3. Deploy the API using the repository's `render.yaml` in a paid, always-on web-service plan and link it to a paid PostgreSQL database with recovery enabled. Confirm the service plan in the hosting dashboard; do not use free compute or free databases for production resident data. Provide Laravel `APP_KEY`, `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, and the exact frontend URL in `CORS_ORIGINS`. Use random keys of at least 32 characters. Existing installations must coordinate JWT rotation because it invalidates existing sessions; the MFA key-rotation procedure below preserves enrolled authenticators.
4. For a new database without an administrator, set `ADMIN_EMAIL`, `ADMIN_MOBILE`, and a strong `ADMIN_PASSWORD` in the Render service environment before the first API login. Change that password after signing in.
5. Set `RESET_DELIVERY_URL` to an authenticated HTTPS notification service before enabling password recovery.

The API migration preserves the `/api` routes and PostgreSQL data model. Laravel runs schema migrations on container startup, so deploy first against an isolated staging database. Back up and verify a restore before any production migration. Keep database credentials, application keys, and webhook secrets in deployment environment variables, never in source control.

The Laravel resident registry encrypts names, birth dates, sex, household IDs, addresses, and source references/filenames with Laravel's authenticated application encryption before writing them to `encrypted_data`. Its migration encrypts existing values and clears their legacy plaintext columns; the normal registry APIs decrypt only after the existing staff/emergency authorization checks. Registry list and demographic reads are audited without recording names, birth dates, or search terms. PostgreSQL connections require TLS in production (`DB_SSLMODE=require`). Preserve `APP_KEY` in a restricted secret store and include it in protected recovery procedures; changing or losing it without a completed re-encryption plan can make registry data unreadable. The migration cannot retroactively protect older plaintext backups, so verify provider-managed database encryption, encrypted off-server backups, backup access restrictions, and expiration of pre-encryption backups separately. These protections apply to the Laravel deployment target and do not establish provider-side controls.

The active Node API encrypts the same resident fields using AES-256-GCM and a separate `RESIDENT_DATA_ENCRYPTION_KEY` (at least 32 random characters) before PostgreSQL persistence; its startup migration backfills existing registry rows transactionally and clears legacy plaintext columns. Configure this secret in the active API's private deployment environment **before deploying this code**; production startup fails if it is missing. Keep it separate from `JWT_SECRET` and `MFA_ENCRYPTION_KEY`, restrict access, and include it in tested recovery procedures. When rotating it, keep old keys in `RESIDENT_DATA_ENCRYPTION_KEY_PREVIOUS` until all records have been deliberately re-encrypted; do not remove an old key while any ciphertext uses it. PostgreSQL TLS certificate verification is enabled for the Node API; provide a trusted PEM through `DATABASE_SSL_CA` if the provider's certificate is not in the system trust store. Production refuses to disable certificate verification. The JSON development adapter also encrypts resident fields and upgrades legacy entries on first read. As with Laravel, provider-side database/backup encryption and retirement of old plaintext backups must be verified outside the repository.

For the active Node/Express API, automatic administrator seeding is only for a genuinely new database. If either configured seed identifier (`ADMIN_EMAIL` or `ADMIN_MOBILE`) already belongs to an account, seeding is skipped; it never promotes or overwrites an existing user.

### Mau assistant maintenance

Mau currently uses client-side, keyword-matched responses; it is not a machine-learning model and does not continuously train on conversations. Adapt it through staff-approved, version-controlled FAQ updates: maintain role- and language-specific intents in `src/mau-responses.js`, keep English and Filipino answers aligned in `src/translations.js`, and add question, role, language, and out-of-scope coverage in `tests/translations.test.js`. Recheck these answers whenever a portal workflow or policy changes, and keep claims about unavailable features explicit.

Do not collect or use resident conversations for training without an explicit privacy review, user notice and consent, retention limits, and a human review process for proposed answer changes.

Captain-photo upload, replacement, and deletion are currently unavailable in the portal and denied by the APIs because Admin is read-only. Existing storage integration must not be treated as authority to change the official portrait; establish an authorized non-Admin publishing workflow before enabling it.

Payment records remain empty until a real billing/payment source is integrated. The previous API's hard-coded invoice examples were demonstration data, not resident charges; neither API should create or display them as real payments.

Keep the production frontend's `VITE_API_BASE` pointed at the existing Node API until the Laravel staging release passes the cutover gates below. Laravel serves announcements from its PostgreSQL `announcements` table and no longer depends on Node for public content; the existing table/data must be present in the selected database or explicitly migrated before cutover. Events currently have no management or persistence workflow and both APIs return an empty collection. Laravel now implements the S3-compatible captain-photo upload, verification, read URL, and delete flow; configure and verify storage against staging before cutover. Do not cut over until all required authenticated workflows pass and the rollback route has been rehearsed.

**Verified hosting blocker (15 October 2026):** the available Render account showed only a Production environment; both the Laravel web service and `barangay-legaspi-db` were on Free plans, and the database recovery page showed that backup export and point-in-time recovery were unavailable. The currently deployed Laravel revision also predates the local announcement and captain-photo implementations. Treat the hosted Laravel API as unverified and do not switch production traffic or run production migrations until an isolated staging environment, recoverable database, and reviewed deployment of the current code are available.

#### Laravel takeover gates

1. Confirm the Laravel service and Express service use the intended PostgreSQL database. Never infer this from matching service names. If they use different databases, migrate data only after taking a verified backup and rehearsing import/restore against staging.
2. Run Laravel feature tests against PostgreSQL, then run role-based browser/API checks for resident registration and Staff approval, login/MFA, profile/password changes, requests and follow-ups, reminders, staff queue/status/report/archive actions, Admin read-only monitoring, scoped emergency operations, and password reset. Verify denied roles remain denied.
3. Configure Laravel captain-photo storage against the private bucket and verify short-lived uploads, content/size/signature validation, read URLs, delete behavior, and lifecycle cleanup for pending uploads.
4. Configure and test the password-reset delivery integration. Until delivery is confirmed in production-like staging, keep password reset unavailable and provide an office support path.
5. Deploy Laravel against staging and a staging frontend. Verify the health response reports PostgreSQL, data relationships and status history survive reloads, CORS and uploads work from the real frontend origin, and migrations complete from a restored production snapshot.
6. Before production cutover, verify a fresh database backup and restore path, record the current frontend/API/database configuration, and confirm rollback steps. Switch only the frontend API URL, smoke-test key journeys, and keep Express available for rollback. Do not run the two APIs as independent writers against separate databases.

The Laravel PostgreSQL feature suite runs in GitHub Actions against an ephemeral PostgreSQL service for pull requests and main-branch changes. A passing CI run verifies migration and API behavior on PostgreSQL, but does not replace a staging restore rehearsal, authenticated browser checks, or production backup verification.

### Coordinated MFA/JWT key rotation

Node-issued sessions are signed with `JWT_SECRET` and expire after seven days. Do not accept tokens signed with a compromised previous key during rotation. Existing MFA secrets are stored as `v1` ciphertext encrypted using the JWT key; both APIs support a separate `MFA_ENCRYPTION_KEY` and `v2` ciphertext for a controlled migration. A temporary, comma-separated `MFA_ENCRYPTION_KEY_PREVIOUS` list supports deployments whose services currently use different MFA keys while records are being re-encrypted.

If only `MFA_ENCRYPTION_KEY` is exposed, follow the MFA re-encryption steps below but do not rotate `JWT_SECRET`; changing the JWT key invalidates sessions and is unnecessary unless the JWT key itself is compromised or rotation is separately planned.

1. Back up PostgreSQL and verify the backup before changing service secrets.
2. Deploy the backward-compatible API code while leaving `MFA_ENCRYPTION_KEY` unset. Confirm the production API remains healthy.
3. Preserve each service's existing MFA key. Set `MFA_ENCRYPTION_KEY_PREVIOUS` on both services to a comma-separated list containing both existing keys and a new, distinct random key. Keep each service's current key unchanged and deploy this staged configuration first; this ensures either service can read existing ciphertext and ciphertext written with the new key during rollout.
4. Set the same new key as `MFA_ENCRYPTION_KEY` on both services, retaining both old keys in `MFA_ENCRYPTION_KEY_PREVIOUS`, and deploy. Keep the current JWT key temporarily so `v1` records and sessions remain readable; new MFA records are written as `v2` using the shared key.
5. In the active Node service environment, run `npm run mfa:rotate-key` to validate records without changing them. Review only the record counts. After verifying a backup, run `npm run mfa:rotate-key -- --apply`; it re-encrypts both `v1` and old `v2` records and verifies every record with only the new key. Remove `MFA_ENCRYPTION_KEY_PREVIOUS` from both services after confirming the deploy. The command never prints decrypted values and detects concurrent edits.
6. Replace `JWT_SECRET` with a new random value on the Node service and redeploy. This intentionally invalidates all existing JWT sessions; users sign in again. Do not configure a previous-key JWT fallback.
7. Configure Laravel with the same new `JWT_SECRET` and `MFA_ENCRYPTION_KEY`, then validate representative login and MFA flows before any frontend cutover.

Keep Node serving traffic until rotation, database checks, and Laravel verification all pass. Never paste key values into logs, source control, or chat.

Vercel continues to serve the frontend and SPA routes through `vercel.json`.

### Production health monitoring

The `Production health check` GitHub Actions workflow checks the public frontend, Laravel API, PostgreSQL-backed health endpoint, and public services, announcements, and events endpoints every 15 minutes. It also runs after changes to the workflow and can be started manually from the repository's Actions tab. A failed check identifies the failing service in the workflow log.

Enable GitHub Actions failure notifications in your GitHub account or repository notification settings to be alerted when a scheduled check fails. The frontend reports rendering errors, uncaught browser errors, and unhandled promise rejections to the active API. Reports are rate-limited and contain only an allowlisted event type, route, language, and role; error messages, stacks, and account data are deliberately excluded. Review these warnings in the active API service logs. The frontend also shows a bilingual recovery screen if a rendering error prevents the portal from loading.

These checks cover uptime and public read paths; they do not replace authenticated workflow tests, application-log review, or verified database backups.

### Staff request dashboard metrics

The staff request dashboard reads request totals from the authenticated staff dashboard API. Pending review counts only `Pending`; in-processing counts only `In Review`. Needs-information requests remain a separate attention category. The request table is filtered, sorted, and paginated by the API, with date filters interpreted in `Asia/Manila`.

The current request workflow has no release/completion state, processing deadline, or staff assignment field. Therefore the dashboard deliberately shows release and overdue metrics as untracked instead of treating `Approved` as completed or estimating deadlines. Average response time is also not reported because the request model does not persist a reliable first-response timestamp. Add these workflow fields and guarded transitions before enabling those metrics.

Administrators can maintain a resident's household ID, address, family count, and household-member names and relationships from the resident detail editor. These details remain attached to the resident account; a separate household registry and multi-head household workflow are not implemented. Laravel now includes announcement management, the staff request queue, service reports and CSV export, persistent reminders, request status history, individual resident archiving, and S3-compatible captain-photo APIs. Full cutover still requires PostgreSQL staging validation, verified workflow tests, and a rehearsed backup/rollback.

## Local development

Install Node.js dependencies from the repository root with `npm install`, then run `npm run dev`. The Vite frontend runs on port 5173 and the local Express API runs on port 3001, using the local JSON store unless `DATABASE_URL` is configured. Do not point local development or tests at the production database. Run `npm test` and `npm run build` before submitting changes.

The Node API request workflow stores the resident's online/physical copy choice, status history, and staff notes. Staff can request missing information; a resident follow-up returns that request to review. The resident request page and staff queue show the same status timeline. Browser reminders are scoped to the signed-in resident and can alert while the app is open; they are not push notifications when the browser is closed. Announcement channel selections are planning metadata only until official social accounts are connected; the app does not claim to publish posts automatically.

The Express API uses JSON storage only when `DATABASE_URL` is absent in local development. When PostgreSQL is configured, database errors fail the affected operation; records are not silently written to a parallel JSON file. Production Express startup requires `DATABASE_URL`. Local JSON data is not synchronized with PostgreSQL and must not be treated as a database backup. The JSON adapter strips legacy plaintext `password` fields when reading and writing user records; only password hashes are retained.

Empty reports, announcements, and event lists are returned as empty until actual records are entered. The former demonstration reports and sample announcements/events were removed so they cannot be mistaken for barangay records. Events currently have no persistent management workflow.

Do not upload official scans to the current local JSON store or use the empty payment screens for real transactions. Document storage needs an access-controlled persistent storage design, while real payment recording needs an agreed reconciliation workflow. Keep Laravel cutover and production key changes paused until there is a verified database backup and restore.

To run the Laravel API locally instead, install PHP 8.2 or newer with the `pdo_sqlite` extension and Composer. In `laravel-api`, install Composer dependencies, copy `.env.example` to `.env`, run `php artisan key:generate`, create `database/database.sqlite`, then run `php artisan migrate`. Start it with `npm run dev:api` from the repository root and set the Vite API base to `http://localhost:8000/api`. Configure PostgreSQL instead of SQLite only with a non-production development database.
