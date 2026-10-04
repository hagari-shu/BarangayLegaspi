# Barangay Legaspi

## Policies

- [Account approval policy](./ACCOUNT_APPROVAL_POLICY.md)
- [Location policy](./LOCATION_POLICY.md)

## Deployment

Deploy the React/Vite frontend to Vercel and the Laravel API to Render:

1. Set the Vercel build command to `npm run build`.
2. Set `VITE_API_BASE` in Vercel to the public API URL ending in `/api` (for example, `https://brgy-legaspi-laravel.onrender.com/api`).
3. Deploy the API using the repository's `render.yaml` (configured for Render's Free web-service plan and linked to the existing Singapore PostgreSQL database). Provide Laravel `APP_KEY`, `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, and the exact frontend URL in `CORS_ORIGINS`. Use random keys of at least 32 characters. Existing installations must coordinate JWT rotation because it invalidates existing sessions; the MFA key-rotation procedure below preserves enrolled authenticators.
4. For a new database without an administrator, set `ADMIN_EMAIL`, `ADMIN_MOBILE`, and a strong `ADMIN_PASSWORD` in the Render service environment before the first API login. Change that password after signing in.
5. Set `RESET_DELIVERY_URL` to an authenticated HTTPS notification service before enabling password recovery.

The API migration preserves the `/api` routes and PostgreSQL data model. Laravel runs the schema migration on container startup. Back up the database before the first Laravel deployment and review the migration against a staging copy first. Keep database credentials, application keys, and webhook secrets in deployment environment variables, never in source control.

Payment records remain empty until a real billing/payment source is integrated. The previous API's hard-coded invoice examples were demonstration data, not resident charges; neither API should create or display them as real payments.

Keep the Vercel `VITE_API_BASE` pointed at the existing Node API until authenticated resident, staff, and administrator workflows have been verified against Laravel. The public Laravel health and read endpoints are live, but a healthy database connection alone is not a cutover sign-off.

### Coordinated MFA/JWT key rotation

Node-issued sessions are signed with `JWT_SECRET` and expire after seven days. Do not accept tokens signed with a compromised previous key during rotation. Existing MFA secrets are stored as `v1` ciphertext encrypted using the JWT key; both APIs support a separate `MFA_ENCRYPTION_KEY` and `v2` ciphertext for a controlled migration. A temporary, comma-separated `MFA_ENCRYPTION_KEY_PREVIOUS` list supports deployments whose services currently use different MFA keys while records are being re-encrypted.

1. Back up PostgreSQL and verify the backup before changing service secrets.
2. Deploy the backward-compatible API code while leaving `MFA_ENCRYPTION_KEY` unset. Confirm the production API remains healthy.
3. Preserve each service's existing MFA key. Set `MFA_ENCRYPTION_KEY_PREVIOUS` on both services to a comma-separated list containing both existing keys and a new, distinct random key. Keep each service's current key unchanged and deploy this staged configuration first; this ensures either service can read existing ciphertext and ciphertext written with the new key during rollout.
4. Set the same new key as `MFA_ENCRYPTION_KEY` on both services, retaining both old keys in `MFA_ENCRYPTION_KEY_PREVIOUS`, and deploy. Keep the current JWT key temporarily so `v1` records and sessions remain readable; new MFA records are written as `v2` using the shared key.
5. In the active Node service environment, run `npm run mfa:rotate-key` to validate records without changing them. Review only the record counts. After verifying a backup, run `npm run mfa:rotate-key -- --apply`; it re-encrypts both `v1` and old `v2` records and verifies every record with only the new key. Remove `MFA_ENCRYPTION_KEY_PREVIOUS` from both services after confirming the deploy. The command never prints decrypted values and detects concurrent edits.
6. Replace `JWT_SECRET` with a new random value on the Node service and redeploy. This intentionally invalidates all existing JWT sessions; users sign in again. Do not configure a previous-key JWT fallback.
7. Configure Laravel with the same new `JWT_SECRET` and `MFA_ENCRYPTION_KEY`, then validate representative login and MFA flows before any frontend cutover.

Keep Node serving traffic until rotation, database checks, and Laravel verification all pass. Never paste key values into logs, source control, or chat.

Vercel continues to serve the frontend and SPA routes through `vercel.json`.

## Local development

Install Node.js, PHP 8.2 or newer with the `pdo_sqlite` extension, and Composer. From the repository root:

```sh
cd laravel-api
composer install
copy .env.example .env
php artisan key:generate
php -r "file_exists('database/database.sqlite') || touch('database/database.sqlite');"
php artisan migrate
cd ..
npm install
npm run dev
```

The Vite frontend runs on port 5173 and Laravel serves the API on port 8000. Configure PostgreSQL instead of SQLite by setting `DATABASE_URL` and removing the `DB_CONNECTION=sqlite` override from `laravel-api/.env`.

The former Express implementation remains in `server/` as a temporary rollback/reference only. It can be started explicitly with `npm run dev:legacy-server`; it is not the configured API deployment.
