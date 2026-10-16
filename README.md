# Barangay Legaspi

## Policies

- [Account approval policy](./ACCOUNT_APPROVAL_POLICY.md)
- [Location policy](./LOCATION_POLICY.md)

## Database planning

- [Upgrade brochure](./docs/database-upgrade-brochure.md)
- [Database upgrade and cutover manual](./docs/database-upgrade-manual.md)

## Admin records and resident search

In Admin → Access, user search updates as the administrator types and returns matching resident, staff, and administrator names across zones. The resident portal's search is intentionally limited to public dashboard content; it does not expose other residents' account details.

The Admin → Access staff roster shows which staff portal sessions checked in within the last two minutes. Staff clients update their presence every 30 seconds while the page is visible, and the roster refreshes every 15 seconds. This is a recent-activity indicator, not a guaranteed real-time connection or proof of a person’s identity.

Approval history stays active for 30 days by default and older approvals are archived automatically when a new approval is recorded. Administrators can also archive approvals manually: the default is 30 days, and every manual archive requires confirmation. Setting retention to `0` archives every approval currently in the active list, including recent ones. Archives remain downloadable from Archived Files until an administrator explicitly deletes them.

## Resident registry

The staff portal's Resident registry supports CSV preview and import, duplicate review, record search, manual resident entry, and verification. Search terms match the beginning of each name component. Imports accept up to 500 rows per batch; every imported or manually entered record is saved as pending verification, and only active, verified records are included in demographic totals. Staff can also create a persistent source-review warning for a purok/zone when source sheets are incomplete or unclear; open warnings remain visible until staff resolves them after reconciliation. Warning changes are staff-only and audited without storing resident names or free-form notes. Registry endpoints require an authenticated staff account, and responses are marked private and non-cacheable. The staff list returns only fields needed for registry work; audit entries record who created, imported, verified, or changed a record without copying resident names or uploaded filenames into audit metadata. PostgreSQL writes and their audit entries are transactional; the JSON adapter serializes registry mutations. Duplicate review is checked again atomically at write time, and identical retries do not add duplicate records. The staff interface displays a privacy notice instructing users to use only necessary data for authorized duties and not share screenshots or exports outside approved work. The Node API initializes the PostgreSQL registry tables on startup. Before loading real resident data, confirm the office's authority, provide its approved privacy notice, establish least-privilege access and a retention schedule, and use the managed staff workflow rather than writing directly to the database.

## Deployment

The current production frontend on Vercel uses the Node/Express API at `https://barangaylegaspi.onrender.com/api`, backed by PostgreSQL. Laravel is deployed as a staged migration target and is not yet the API used by the production frontend. Do not change `VITE_API_BASE` to Laravel until authenticated resident, staff, admin, and content-management workflows have passed a coordinated cutover check.

1. Set the Vercel build command to `npm run build`.
2. Set `VITE_API_BASE` in Vercel to the active Node API URL ending in `/api`.
3. Keep the active Node/Express Render service connected to PostgreSQL and configure its keys, exact frontend `CORS_ORIGINS`, and other required environment variables. Use random keys of at least 32 characters. Existing installations must coordinate JWT rotation because it invalidates existing sessions; the MFA key-rotation procedure below preserves enrolled authenticators.
4. For a new database without an administrator, set `ADMIN_EMAIL`, `ADMIN_MOBILE`, and a strong `ADMIN_PASSWORD` on the active Node service before the first API login. Change that password after signing in.
5. The repository's `render.yaml` provisions the staged Laravel service and its connection to the existing Singapore PostgreSQL database; it does not configure or replace the active Node service. Back up the database and review the Laravel migration against a staging copy before any production cutover. Keep database credentials, application keys, and webhook secrets in deployment environment variables, never in source control.
6. Set `RESET_DELIVERY_URL` and `RESET_DELIVERY_TOKEN` on the active Node API to an authenticated HTTPS notification service before enabling password recovery. The service must accept a bearer token and the `password_reset` JSON payload; requests time out after 10 seconds.

### Staff announcement publishing to Facebook and Messenger

The staff portal supports Facebook Page posts and Messenger announcements only. Configure these variables as secrets/environment settings on the active Node/Express Render service; never put Page tokens or app secrets in Vercel or source control:

- `META_PAGE_ID`: the official Barangay Legaspi Facebook Page ID. Do not use the currently linked Sangguniang Kabataan profile.
- `META_PAGE_ACCESS_TOKEN`: a Page access token with Meta's `pages_manage_posts` permission for Page publishing, `pages_messaging` for Messenger, and `pages_manage_metadata` to subscribe the Page to app webhooks.
- `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN`: required to verify Messenger webhook deliveries.
- `META_GRAPH_API_VERSION`: a currently supported Meta Graph API version, in `vNN.N` format.

Configure the Meta app's Page webhook subscription for `messages` and `messaging_postbacks`, pointing to `https://barangaylegaspi.onrender.com/api/meta/webhook`. Publish the app and obtain any required Meta review/advanced access before enabling it for real residents. Staff can share the Page's Messenger link from the announcement form. A resident must start a Page conversation and send `SUBSCRIBE`; `STOP` or `UNSUBSCRIBE` opts them out. Subscriber Page-scoped IDs and consent state are stored by the active API.

Messenger delivery is restricted to opted-in people who messaged the Page within the preceding 24 hours. A correction is sent only to recipients who received that specific original Messenger announcement and who remain opted in and eligible; the API does not send a correction to a broader subscriber list. Facebook Page posts can be deleted from the staff portal; already-delivered Messenger messages cannot be unsent, so staff must publish a correction/retraction instead. Subscriber Page-scoped IDs and per-announcement delivery relationships are stored by the API to enforce these rules. Establish and publish an appropriate privacy notice and retention schedule for this data before enabling Messenger for residents. Verify the connected Page and permissions in Meta before setting the production environment variables.

The staged Laravel API preserves the `/api` routes and PostgreSQL data model, and runs its schema migration on container startup. The production health-check workflow monitors the active Node API and compares public announcement/event reads with the staged Laravel API.

For the active Node/Express API, automatic administrator seeding is only for a genuinely new database. If either configured seed identifier (`ADMIN_EMAIL` or `ADMIN_MOBILE`) already belongs to an account, seeding is skipped; it never promotes or overwrites an existing user.

### Mau assistant maintenance

Mau currently uses client-side, keyword-matched responses; it is not a machine-learning model and does not continuously train on conversations. Adapt it through staff-approved, version-controlled FAQ updates: maintain role- and language-specific intents in `src/mau-responses.js`, keep English and Filipino answers aligned in `src/translations.js`, and add question, role, language, and out-of-scope coverage in `tests/translations.test.js`. Recheck these answers whenever a portal workflow or policy changes, and keep claims about unavailable features explicit.

Do not collect or use resident conversations for training without an explicit privacy review, user notice and consent, retention limits, and a human review process for proposed answer changes.

The official captain photo is resized in the browser and uploaded directly from the admin portal to S3-compatible object storage using a short-lived, size-limited upload policy; the API does not buffer image bytes. Configure `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, and `OBJECT_STORAGE_SECRET_ACCESS_KEY` on the Express API. Set `OBJECT_STORAGE_FORCE_PATH_STYLE=true` only if required by your provider. Scope the storage credentials to the `official/captain-portrait` prefix, configure bucket CORS to allow `POST` from the web app’s exact origin, and add a lifecycle rule to remove stale objects under `official/captain-portrait/pending/`. Keep the bucket private; the API issues short-lived signed read URLs. Uploads accept JPEG, PNG, and WebP images up to 5 MB and validate the file signature before publishing the replacement portrait. Without these settings, the upload controls report that image storage is unavailable.

Payment records remain empty until a real billing/payment source is integrated. The previous API's hard-coded invoice examples were demonstration data, not resident charges; neither API should create or display them as real payments.

Keep the Vercel `VITE_API_BASE` pointed at the existing Node API until authenticated resident, staff, and administrator workflows have been verified against Laravel. Until that cutover, Laravel's public announcement and event reads use `PUBLIC_CONTENT_API_BASE` to read from the Node API, and Laravel returns `502` rather than a misleading empty collection if the source is unavailable. Announcement writes on Laravel return `409` during this transition so content is not silently written to a database the active portal does not read. Do not cut over until the resident, staff, administrator, and content-management workflows have been migrated and verified together.

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

The admin portal health card checks API availability and, for PostgreSQL deployments, database connectivity. It does not inspect backup schedules, alert delivery, restoreability, or staff coverage. Verify automated database backups and perform a restore test separately; add authorized staff accounts in Admin → Access only when the barangay has assigned those responsibilities.

### Staff request dashboard metrics

The staff request dashboard reads request totals from the authenticated staff dashboard API. Pending review counts only `Pending`; in-processing counts only `In Review`. Needs-information requests remain a separate attention category. The request table is filtered, sorted, and paginated by the API, with date filters interpreted in `Asia/Manila`.

The staff Reports tab supports Manila-time reporting periods and custom date ranges, request-type and current-status filters, status/type breakdowns, activity trends, decision metrics, and CSV export. Received totals and status breakdowns are based on submission dates; decision metrics are based on recorded decision dates. Report responses and exports omit resident contact details. The current request workflow has no release/completion state, processing deadline, or staff assignment field. Therefore the dashboard deliberately shows release and overdue metrics as untracked instead of treating `Approved` as completed or estimating deadlines. Residents are told that approval is not confirmation of document release. Staff can archive approved/rejected requests older than 30 days or explicitly archive all processed requests; both actions require confirmation, and resulting archives remain available in Archived Files for viewing or download. Average response time is not reported because the request model does not persist a reliable first-response timestamp. Add these workflow fields and guarded transitions before enabling those metrics.

Administrators can maintain a resident's household ID, address, family count, and household-member names and relationships from the resident detail editor. These details remain attached to the resident account; a separate household registry, multi-head household workflow, and Laravel API parity are not yet implemented.

## Local development

Install Node.js dependencies from the repository root with `npm install`, then run `npm run dev`. The Vite frontend runs on port 5173 and the local Express API runs on port 3001, using the local JSON store unless `DATABASE_URL` is configured. Do not point local development or tests at the production database. Run `npm test` and `npm run build` before submitting changes.

The Node API request workflow stores the resident's online/physical copy choice, status history, and staff notes. Staff can request missing information; a resident follow-up returns that request to review. The resident request page and staff queue show the same status timeline. Browser reminders are scoped to the signed-in resident and can alert while the app is open; they are not push notifications when the browser is closed. Announcement channel selections are planning metadata only until official social accounts are connected; the app does not claim to publish posts automatically.

The Express API uses JSON storage only when `DATABASE_URL` is absent in local development. When PostgreSQL is configured, database errors fail the affected operation; records are not silently written to a parallel JSON file. Production Express startup requires `DATABASE_URL`. Local JSON data is not synchronized with PostgreSQL and must not be treated as a database backup. The JSON adapter strips legacy plaintext `password` fields when reading and writing user records; only password hashes are retained.

Empty reports, announcements, and event lists are returned as empty until actual records are entered. The former demonstration reports and sample announcements/events were removed so they cannot be mistaken for barangay records. Events currently have no persistent management workflow.

Do not upload official scans to the current local JSON store or use the empty payment screens for real transactions. Document storage needs an access-controlled persistent storage design, while real payment recording needs an agreed reconciliation workflow. Keep Laravel cutover and production key changes paused until there is a verified database backup and restore.

To run the Laravel API locally instead, install PHP 8.2 or newer with the `pdo_sqlite` extension and Composer. In `laravel-api`, install Composer dependencies, copy `.env.example` to `.env`, run `php artisan key:generate`, create `database/database.sqlite`, then run `php artisan migrate`. Start it with `npm run dev:api` from the repository root and set the Vite API base to `http://localhost:8000/api`. Configure PostgreSQL instead of SQLite only with a non-production development database.
