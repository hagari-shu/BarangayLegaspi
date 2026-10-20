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

## Provision the VPS

1. Provision a non-production SSH key for this VPS. Use a separate Compose project and database volume for migration rehearsal; do not point production DNS at it.
2. Wait until hPanel reports the VPS is running. Record its public IP and confirm the operating system, region, backups, firewall, and recovery console. Do not share a root password or private SSH key in chat.
3. Use the current supported Ubuntu LTS image. Install Docker Engine and the Compose plugin from Docker's official Ubuntu instructions, plus Nginx, Certbot, `python3-certbot-nginx`, `ufw`, `unattended-upgrades`, and `postgresql-client`. The application containers provide Node, PHP, and PostgreSQL; do not expose either database port publicly.
4. Create a non-root deployment account and configure SSH key authentication. Docker group membership is root-equivalent; limit it to trusted VPS administrators. Configure the firewall to deny inbound traffic by default, allow SSH from trusted IPs, and allow only HTTP/HTTPS publicly. Enable unattended security updates and set up an independent backup destination and restore drill.
5. Configure DNS only after confirming authorized ownership and the VPS address. For initial testing use a temporary hostname or an approved staging subdomain with HTTPS; do not route the official domain or resident traffic to an untested VPS.

## Prepare and test the Hostinger stack

The repository now includes `Dockerfile.hostinger`, `docker-compose.hostinger.yml`, an inner application Nginx config, a host HTTPS reverse-proxy template, a PostgreSQL least-privilege initialization script, and `.env.hostinger.example`. The stack runs the frontend and Node API on a private Docker network, with PostgreSQL not published to the Internet. The PostgreSQL administrator is separate from the two application database owners. Laravel is optional and isolated behind a Compose profile with its own database; it is not used by the frontend while API parity is incomplete.

1. Check out the reviewed deployment commit on the VPS and copy `.env.hostinger.example` to `.env.hostinger`. Keep the private environment file outside Git; restrict it to the deployment operator (`chmod 600 .env.hostinger`). Generate distinct random values locally/on the VPS with a cryptographically secure generator. Use hexadecimal-only database passwords so the internal PostgreSQL URLs parse correctly. Never paste production credentials into chat or commit them. Set distinct random values for the database administrator, Node database role, Laravel database role, Node JWT secret, and Laravel keys. Existing production JWT/MFA keys must be transferred through a protected secret channel only at cutover. The PostgreSQL init scripts run only when a database volume is first initialized; changing the environment file later does not rotate role passwords or reset the database.
2. Set `PUBLIC_APP_URL` and the exact `CORS_ORIGINS` to the HTTPS staging hostname during rehearsal. Configure only integrations that are ready to test. Keep `SKIP_SEED=true` (Compose enforces it) and do not add any `ADMIN_*` seed variables; this prevents demo accounts or a second administrator from being created.
3. For the migration rehearsal, make a protected backup of the current PostgreSQL database, restore it only to a separate staging Compose project/database, and restrict access to the authorized operators. Use synthetic test accounts and do not expose the restored resident data or its staging API publicly. Verify that the Node startup schema changes complete on that restored copy, `/api/health` reports PostgreSQL, sign-in, registration approval, resident/staff/Admin workflows, password reset delivery, MFA, uploads, audit records, and the required integrations behave as expected. Keep production JWT/MFA secrets out of the rehearsal; this means existing sessions and MFA cannot be used for staging validation.
4. Start only the staging database first, restore the rehearsal dump into that empty database, and then start the stack. Keep the dump in a root-only directory and remove it only under the approved retention procedure. The API must not start against the database before the restore:

   ```sh
   docker compose --env-file .env.migration-test -f docker-compose.hostinger.yml -p brgy-migration-test up -d node-db
   docker compose --env-file .env.migration-test -f docker-compose.hostinger.yml -p brgy-migration-test exec -T node-db sh -c 'pg_restore --exit-on-error --no-owner --no-acl --role="$NODE_DB_USER" -U "$POSTGRES_USER" -d "$NODE_DB_NAME"' < /root/protected/authorized-staging-copy.dump
   docker compose --env-file .env.migration-test -f docker-compose.hostinger.yml -p brgy-migration-test up --build -d
   docker compose --env-file .env.migration-test -f docker-compose.hostinger.yml -p brgy-migration-test ps
   ```

   Set `WEB_PORT=8081` in `.env.migration-test` so this project binds only to `127.0.0.1:8081`. Use an SSH tunnel to test it locally; do not publish the staging port or enable official DNS. Keep the staging PostgreSQL volume separate from the production stack. Do not use a production dump for rehearsal unless specifically approved and secured; remove or anonymize resident data before functional tests wherever possible.
5. After confirming authorized DNS points to this VPS, install `deploy/hostinger/nginx-http-challenge.conf`, create `/var/www/html/.well-known/acme-challenge`, and reload Nginx. Obtain a certificate with Certbot webroot mode for the approved hostname(s) (provide an authorized renewal-contact email during the command). Enable the HTTPS server block in `deploy/hostinger/nginx-host.conf` only after certificate files exist; validate with `nginx -t`, reload, and verify renewal. The host proxy should remain the only public path to the web container, which itself binds only to loopback.
6. Verify from an external network that only SSH (trusted source IPs), 80, and 443 are reachable; ports 3001, 5432, and 8080 must not be public. Verify HTTPS, SPA deep links, same-origin `/api/health`, PostgreSQL storage, authenticated workflows, browser errors, and backup restoration before considering cutover.

## Production data migration and cutover

Do not treat the successful Laravel CI run as permission to replace the Node API with Laravel. Laravel's security hardening is tested, but 42 routes from the active Node API remain missing from Laravel. The Hostinger frontend therefore uses the existing Node API; the Compose `laravel-staging` profile starts Laravel only on an isolated database and does not publish it or route frontend requests to it.

1. Complete the isolated migration rehearsal above using a protected database copy. The new target production database must be a separate PostgreSQL volume on Hostinger, not a shared Render/Node/Laravel database.
2. Schedule an approved maintenance window. Stop writes to the old Node production API, take and verify a final backup encrypted at rest with an approved key, transfer it over an approved secure channel, and restore it to the new Hostinger Node database. Start only the production database service, restore into its empty application database using the same `pg_restore --no-owner --no-acl --role="$NODE_DB_USER" -U "$POSTGRES_USER" -d "$NODE_DB_NAME"` pattern, and start the API only after restore validation. The Node startup runs schema initialization/compatible `CREATE TABLE` and `ALTER TABLE` statements; verify their logs and the database on the rehearsal copy first.
3. Preserve the active production `JWT_SECRET` and any `MFA_ENCRYPTION_KEY`/previous MFA keys required to decrypt current credentials. Changing these can invalidate sessions or lock users out of MFA. Transfer values only through a secret manager or protected operator-only file. Keep the database passwords, JWT/MFA keys, reset-delivery credentials, object-storage keys, and Meta tokens out of Git and chat. Do not configure `ADMIN_*` seed values.
4. Start the production Compose project, validate the restored records and required workflows, then schedule DNS changes only after HTTPS and rollback checks pass. Update Meta webhook URLs and any password-reset/delivery allowlists if the official domain changes. Keep Render, Vercel, the original database, and the final pre-cutover backup available during the rollback period.
5. If rollback is necessary after Hostinger has accepted writes, first freeze writes and preserve a backup of the Hostinger database. Do not simply point traffic back to the old API/database and assume new writes will follow: plan an approved reverse data migration or explicitly accept/reconcile the data written since cutover. Do not delete either database until the owner approves retirement.

## Deploy Laravel/PHP as a separate staging API

Laravel is included in the repository under `laravel-api`, but it is not currently the production API and does not yet have confirmed feature parity with the Node API. Deploy it as a separate staging service; do not route the live frontend to it or let it write to the production database during preparation.

The current route inventory finds 42 Node API routes missing from Laravel's route declarations. The missing surface includes the resident registry, official profile/logo/photo management, staff invitations and temporary access, staff presence/reporting, and other Admin workflows. Matching health responses and empty announcement/event collections does not establish application workflow parity.

The repository's current `render.yaml` points the staged Laravel service at the existing `barangay-legaspi-db` PostgreSQL resource, and its Docker entrypoint runs migrations at service startup. Treat this as a shared database/schema, not an isolated staging copy. Do not rely on the existing Laravel service as a safe staging environment or deploy migration changes there until an authorized operator confirms the database topology, takes a backup, and approves the migration against a separate staging copy.

1. Use a separate empty PostgreSQL database and least-privilege role for Laravel. Do not point both API implementations at the production database or one shared staging database until schema and transaction compatibility are verified.
2. Deploy Laravel from `laravel-api` using PHP 8.2 or newer and production Composer dependencies from `composer.lock`. Configure Nginx/PHP-FPM with document root `laravel-api/public`; enable `pdo_pgsql`, `mbstring`, `openssl`, `tokenizer`, `xml`, `ctype`, `curl`, `fileinfo`, and `zip`. Keep `storage` and `bootstrap/cache` writable by the application user. When running Composer package-discovery scripts during build/release, set `APP_ENV=local` (or `testing` in CI) so production startup validation is reserved for the actual service runtime.
3. Configure Laravel's private environment values for production mode, `APP_DEBUG=false`, a unique `APP_KEY`, the staging `DATABASE_URL`, a distinct random `JWT_SECRET` of at least 32 characters, and exact HTTPS `CORS_ORIGINS`. Laravel now refuses to boot in production with debug enabled, a non-PostgreSQL database, a missing/non-HTTPS CORS origin, a missing/short/placeholder JWT secret, or a JWT secret equal to the app key. Preserve the current production JWT/MFA secrets only for a reviewed migration to production data; never copy them into an isolated test environment unnecessarily.
4. Run Laravel migrations only against the empty, isolated Laravel staging database first. The Compose `laravel-staging` profile runs `php artisan migrate --force` at container startup, so its database credentials must point only to the dedicated Laravel database and never to Node's database or production data. The token-revocation migration adds a legacy-JWT revocation table and a token-validity timestamp to users; test it on staging before any production migration.
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

## Data and frontend deployment notes

The Hostinger Compose deployment builds the frontend with same-origin `VITE_API_BASE=/api`, serves the Vite build through the private web container, and proxies API requests to Node. Do not set the Hostinger frontend API base to Laravel or to the old Render URL.

Create a verified PostgreSQL backup before rehearsal and before cutover. Restore only to a separately named Compose project and volume for staging; inspect only approved, minimal metadata such as row counts, and do not put resident data in logs or screenshots. Keep the original database unchanged through the rollback period. The staging restore must be encrypted at rest and accessible only to authorized operators; use synthetic test accounts and remove/anonymize resident data before functional tests where possible.

The existing Vercel deployment remains configured for its current API during rehearsal and rollback. Do not change its `VITE_API_BASE` as part of the Hostinger cutover. The Hostinger bundle uses `/api` and is switched to the official Hostinger origin only through the separately approved DNS cutover.

## Staging verification and cutover gate

Use the temporary Hostinger hostname before changing DNS. Verify:

- Home page, sign-in, registration, and direct navigation to `/register` load over HTTPS.
- API health is 200 and the browser can make credentialed API requests from the exact frontend origin.
- Authorized test users can complete resident, staff, and Admin workflows, including account creation, certificate preview, and printing.
- Password reset/invitation delivery, MFA, official-profile photos, uploads, and Meta integrations work if enabled.
- Browser console and API logs contain no unexpected errors; do not include personal data or tokens in diagnostic reports.
- A fresh backup from the Hostinger database can be restored to a separate test database.

Only after all checks pass should an authorized operator schedule DNS changes. Keep Vercel, Render, and the original database available through a rollback period. If the new site or API fails after cutover, freeze writes, preserve the Hostinger database, and follow the reverse-migration decision in the cutover section; DNS rollback alone does not copy new data back to the old database. Do not shut down the old services until the owner has approved retirement after the rollback period.

## Current blocker

The Hostinger VPS has been paid for, but the user reports it is still provisioning and has not been configured. The hPanel view available to this session is still loading and does not expose a server address or console, so no deployment connection is available yet. The intended domain is `barangay-legaspi.gov.ph`, but current registration, ownership, and DNS control have not been confirmed. The production database credentials are not available in this session. No Hostinger app, database, backup, DNS, or production traffic has been changed.

Laravel API parity is not complete (42 Node routes are missing in the current route inventory). Laravel's feature tests pass in GitHub Actions (20 tests, 86 assertions, commit `7e1477e` on `readiness/laravel-prod-hardening`); they could not be run locally because Composer and required PHP extensions are absent. This does not establish staging or production readiness, and the feature branch has not been merged or deployed.

The latest public checks found the active Node API healthy. All three official profile-photo endpoints now return `Cross-Origin-Resource-Policy: cross-origin`, so the earlier cross-origin header blocker is resolved in the live API. They still return `204 No Content`, meaning no photo is currently available and the frontend should show its fallback until an authorized Admin uploads one. The Vercel site currently serves `assets/index-Da49UIDO.js` and `assets/index-B2nn0lV0.css`; both filenames match a fresh local production build, so the deployed frontend bundle matches the current source build.
