# Database Upgrade and Cutover Manual

## Purpose and current architecture

Use this runbook to evaluate and, if approved, upgrade the PostgreSQL database supporting Barangay Legaspi. It is written for an authorized operator with access to the Render and Vercel dashboards.

Current repository configuration indicates:

- The application has a PostgreSQL adapter in the Node/Express API and PostgreSQL configuration in the Laravel API.
- `render.yaml` configures the Laravel service to use the existing Render database named `barangay-legaspi-db` in Singapore.
- The repository deployment notes say to keep Vercel pointed at the Node API until authenticated resident, staff, administrator, and content-management workflows have all passed against Laravel.
- The current JSON database is for local development/testing; it is not synchronized with PostgreSQL and is not a production backup.

**Do not infer from this configuration that production is already using Laravel or that a database tier change has been approved.** Confirm the live services and database in the provider dashboards before acting.

## 1. Establish the actual change and cost

1. Sign in to the Render account that owns the production services.
2. Locate the PostgreSQL database referenced by the Laravel service. Confirm its name, region, plan, storage usage, connection status, and current billing.
3. Identify the exact proposed upgrade in the dashboard and record its monthly price, any one-time charges, downtime expectation, storage limit, and backup retention.
4. Confirm whether the change is an in-place plan adjustment, a new database, or a migration. Treat a new database as a data migration, not a simple resize.
5. Record the current Vercel API base URL and the production Node and Laravel service URLs without copying secrets into tickets or chat.
6. Obtain written approval for the expected recurring and one-time costs and an agreed maintenance window.

If the dashboard does not clearly state the effect of the change, stop and confirm it with the provider before proceeding.

## 2. Prepare a recoverable backup

1. Announce the maintenance window and temporarily pause any planned schema or API cutover.
2. Create a provider-supported backup/snapshot before changing the database or deploying migrations.
3. Record the backup identifier, timestamp, database, and operator in the approved operations log. Do not include credentials or resident data.
4. Restore the backup to an isolated staging database using the provider's supported restore procedure.
5. Confirm that the restored database is reachable and that expected tables and non-sensitive record counts are present.
6. Confirm that the application can connect to staging using staging-only credentials and environment variables.

**Gate:** Do not proceed to a production schema migration, database replacement, or API cutover until the restore test succeeds.

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
