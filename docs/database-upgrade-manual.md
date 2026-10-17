# Database Upgrade and Cutover Manual

## Purpose and current architecture

Use this runbook to evaluate and, if approved, upgrade the PostgreSQL database supporting Barangay Legaspi. It is written for an authorized operator with access to the Render and Vercel dashboards.

Current repository configuration indicates:

- The application has a PostgreSQL adapter in the Node/Express API and PostgreSQL configuration in the Laravel API.
- `render.yaml` configures the Laravel service to use the existing Render database named `barangay-legaspi-db` in Singapore.
- The repository deployment notes say to keep Vercel pointed at the Node API until authenticated resident, staff, administrator, and content-management workflows have all passed against Laravel.
- The current JSON database is for local development/testing; it is not synchronized with PostgreSQL and is not a production backup.

**Do not infer from this configuration that production is already using Laravel or that a database tier change has been approved.** Confirm the live services and database in the provider dashboards before acting.

## Current verified status (16 October 2026)

This is a point-in-time operational check, not a guarantee that provider settings have not changed since:

- The Render dashboard showed `barangay-legaspi-db` in Singapore as **Available**, on the **Free** plan, with **1 GB** storage and approximately **6.7%** used.
- The database Recovery page stated that backups are unavailable for Free databases. Render's documentation says paid PostgreSQL enables point-in-time recovery, but its recovery window begins accruing after the upgrade; upgrading does not create a historical recovery point.
- The deployed Singapore Laravel service responded to `/api/health` with `ok: true` and `storage: pgsql`. This confirms that API health endpoint and PostgreSQL connectivity at that check; it does not validate resident workflows, encryption status, backup/restore, or production readiness. The service root returned HTTP 500 during the same check.
- The separate Oregon Node service was in a failed-deploy state. Its logs reported that the configured database hostname could not be resolved. The Oregon service and Singapore database are in different regions; verify intended topology and connection configuration before any recovery action. Do not change the Node service or point traffic at it as a workaround.
- The repository's resident-data encryption changes have been tested locally but are **not deployed**. No production encryption migration, backup export, plan upgrade, secret change, or resident-list import was performed in this check.
- No provider-side backup encryption, off-site backup, access controls, retention, or restore drill has been verified.

The live state may change. Recheck the dashboard and health endpoints before following any operational step below. Keep secrets, connection strings, resident names, and source lists out of the operations log.

## 1. Establish the actual change and cost

1. Sign in to the Render account that owns the production services.
2. Locate the PostgreSQL database referenced by the Laravel service. Confirm its name, region, plan, storage usage, connection status, and current billing.
3. Identify the exact proposed upgrade in the dashboard and record its monthly price, any one-time charges, downtime expectation, storage limit, and backup retention. At the check on 16 October 2026, the database plan selector displayed $6/month (0.1 CPU, 256 MB RAM), $19/month (0.5 CPU, 1 GB RAM), and $40/month (1 CPU, 2 GB RAM). The dashboard's displayed amount and final billing confirmation take precedence; verify again before approval.
4. Confirm whether the change is an in-place plan adjustment, a new database, or a migration. Treat a new database as a data migration, not a simple resize.
5. Record the current Vercel API base URL and the production Node and Laravel service URLs without copying secrets into tickets or chat.
6. Obtain written approval for the expected recurring and one-time costs and an agreed maintenance window.

If the dashboard does not clearly state the effect of the change, stop and confirm it with the provider before proceeding.

The Render Laravel service plan selector showed $7/month for 0.5 CPU and 512 MB RAM and $25/month for 1 CPU and 2 GB RAM at the same check. These are dashboard observations, not a purchase approval or a capacity recommendation. Vercel was on the Hobby plan; Pro was displayed as $20/month. See the companion brochure for a high-level cost summary and optional-service caveats.

## 2. Prepare a recoverable backup

1. Announce the maintenance window and temporarily pause any planned schema or API cutover.
2. Confirm that the selected database plan actually provides the backup/export and recovery features needed. If the current Free database still reports backups unavailable, stop: do not run an encryption migration, destructive schema change, database replacement, or resident import against it.
3. Create a provider-supported backup/snapshot before changing the database or deploying migrations. If upgrading the existing database plan is approved, remember that a new paid-plan recovery window is not retroactive; first obtain an export or other verified backup of the current database if the provider supports it.
4. Record the backup identifier, timestamp, database, and operator in the approved operations log. Do not include credentials or resident data.
5. Restore the backup to an isolated staging database using the provider's supported restore procedure.
6. Confirm that the restored database is reachable and that expected tables and non-sensitive record counts are present.
7. Confirm that the application can connect to staging using staging-only credentials and environment variables.

**Gate:** Do not proceed to a production schema migration, database replacement, or API cutover until the restore test succeeds.

## 2a. Resident-data privacy and encryption gate

Run this gate before loading, migrating, or manually entering identifiable resident information:

1. Confirm the production database has an approved, paid recovery plan or equivalent independently verified backup coverage. Create a fresh backup and successfully restore it into an isolated environment before changing the schema.
2. Deploy and verify the reviewed encryption implementation in staging first. The Node API requires a separate `RESIDENT_DATA_ENCRYPTION_KEY` of at least 32 random characters; Laravel uses `APP_KEY`. Keep keys in the provider's private secret manager, not in source control, logs, tickets, or this manual. Preserve the applicable key in the restricted recovery procedure; losing it can make encrypted resident records unreadable.
3. Confirm the staging migration encrypts existing private registry fields, clears legacy plaintext columns, and preserves record counts and row identity. Run tests for authorized reads, denial of unauthorized reads, duplicate review, verification status, and privacy-safe audit metadata.
4. Review database backups created before encryption: they may contain plaintext and are not retroactively protected. Restrict access and retention, and retire them only under the approved records-retention policy after a verified encrypted recovery copy exists.
5. Enter or import resident information only after the data owner approves the source and scope, staff access is authorized, and source totals and verification procedures are defined. Do not bulk-import uncertain scans or claim the registry is complete until source lists reconcile.
6. Confirm that logs and audit metadata do not contain resident names, birth dates, search terms, source filenames, or other unnecessary personal data. Audit successful access and record changes without copying resident content into the audit trail.
7. Keep an authorized source roster in the approved private environment. Before staging import, run the local-only `npm run registry:preflight -- "<private-roster.csv>"` command with no `DATABASE_URL` configured. It reports aggregate validation counts only and does not import or send data. Correct the source in its authorized location; do not copy it into chat, tickets, source control, or the app repository.

**Current gate:** Encryption changes are local and not deployed, and the existing Free database has no available backup capability shown in its Recovery page. Do not add or migrate real resident personal information until both blockers are resolved and a restore is verified.

## 3. Validate application compatibility in staging

1. Use a staging API service and staging database. Never point local development or automated tests at production.
2. Deploy the reviewed application version to staging.
3. Review the Laravel schema migration at `laravel-api/database/migrations/2026_10_04_000001_create_barangay_api_tables.php` against the restored database.
4. Check migration status and apply migrations to staging using the deployment's normal migration process. Do not manually edit production tables to bypass migration failures.
5. Confirm expected schema, indexes, constraints, data relationships, and non-sensitive record counts after migration.
6. Exercise representative workflows:
   - resident registration, login, profile, and request submission;
   - staff login, queue filters, status updates, and reports;
   - administrator login, staff/user access management, and content-management flows;
   - MFA setup/challenge if enabled;
   - health checks and public service, announcement, and event reads.
7. Check application and database logs for errors, query timeouts, connection exhaustion, and migration warnings.
8. Confirm that failed database writes are surfaced as errors and are not silently redirected to local JSON storage.
9. For the resident registry, confirm encrypted fields are unreadable in raw database inspection, authorized staff can retrieve them through the API, unauthorized roles cannot, pending records remain excluded from verified totals, and audit metadata excludes resident details.

**Gate:** Do not change production traffic if any required role workflow fails, data is inconsistent, or errors remain unexplained.

## 4. Apply an approved in-place capacity upgrade

Use this section only if the provider confirms that the plan can be changed in place and that the existing database and connection string remain valid.

1. Confirm the verified backup and restore test from section 2.
2. Schedule the approved maintenance window if the provider indicates connections may be interrupted.
3. Apply the plan change in the provider dashboard; do not change credentials or application secrets unless required and separately approved.
4. Wait for the provider to report the database as available.
5. Verify database connectivity from the API's health endpoint and review database/service logs.
6. Run the staging-tested smoke checks against production with authorized test accounts and non-destructive actions.
7. Monitor latency, error rate, connection usage, storage, and service health through the agreed observation period.

If the provider requires a new database instead, skip this section and prepare a separately reviewed migration plan. Do not point the application at an empty replacement database.

## 5. Optional API cutover to Laravel

A PostgreSQL plan upgrade is independent of switching the portal API. Do not combine them unless the change owner has approved a single coordinated release and rollback plan.

Before cutover:

- Confirm Laravel is deployed with production-grade configuration and the intended production database.
- Confirm secrets are set through the provider's secret manager/environment settings; never commit or paste them.
- Confirm migrations completed successfully and the data source contains the expected production records.
- Confirm authentication, role authorization, MFA, user management, requests, reports, and content management end to end for all user roles.
- Confirm Vercel's `VITE_API_BASE` points to the intended API and that CORS is limited to the exact frontend origin.
- Confirm public content reads and writes will not split between APIs or databases.
- Obtain explicit approval and schedule the cutover.

Change `VITE_API_BASE` only after these gates pass. Verify the deployed frontend and authenticated workflows after propagation. Keep the old API/database available and unmodified during the rollback window unless the approved migration plan says otherwise.

## 6. Rollback and incident handling

If the upgraded database becomes unavailable, data checks fail, or critical workflows regress:

1. Stop further migrations, data writes, and traffic changes.
2. Notify the incident owner and preserve service/database logs.
3. If the change was an in-place plan upgrade, follow the provider's documented downgrade procedure; do not assume a downgrade is immediate or data-safe.
4. If the change involved a replacement database or cutover, route traffic back only if the old system is still consistent and has not diverged. Otherwise, pause writes and obtain the data owner/provider's direction before restoring.
5. Restore only from the verified backup using the provider's recovery procedure and an approved recovery point.
6. Re-run role-based smoke tests and confirm data integrity before declaring recovery.
7. Document the cause, recovery point, data impact, and follow-up actions without including resident data or secrets.

Never restore over the only production copy without confirming the target and backup. A rollback can lose writes created after the backup or after systems diverged.

## 7. Completion checklist

- [ ] Current provider plan, size, billing, and proposed cost confirmed.
- [ ] Upgrade and maintenance window approved by the account owner.
- [ ] Backup completed and restored successfully to isolated staging.
- [ ] Resident-data encryption deployed and verified in staging; encryption key recovery is documented and tested.
- [ ] Legacy plaintext backups and their retention/access policy have been reviewed.
- [ ] Resident source lists, import authorization, and verification totals have been reconciled before any resident-data load.
- [ ] Migration and role-based workflow tests passed in staging.
- [ ] Production change completed and database/API health verified.
- [ ] No unexplained database or application errors in the observation period.
- [ ] If API cutover was separately approved, resident/staff/admin workflows passed on Laravel.
- [ ] Rollback owner, method, and recovery point recorded.
- [ ] Operations log updated without credentials or resident information.

## Repository references

- [Render service and database connection configuration](../render.yaml)
- [PostgreSQL schema migration](../laravel-api/database/migrations/2026_10_04_000001_create_barangay_api_tables.php)
- [Deployment and API cutover guidance](../README.md)
- [Render pricing](https://render.com/pricing)
- [Render PostgreSQL documentation](https://render.com/docs/postgresql)
- [Render PostgreSQL backup and recovery documentation](https://render.com/docs/postgresql-backups)
- [Resident registry encryption and deployment requirements](../README.md)
- [Laravel PostgreSQL encryption migration](../laravel-api/database/migrations/2026_10_16_000001_encrypt_resident_registry_private_data.php)
