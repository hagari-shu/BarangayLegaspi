# Barangay Legaspi

## Policies

- [Account approval policy](./ACCOUNT_APPROVAL_POLICY.md)
- [Location policy](./LOCATION_POLICY.md)

## Deployment

Deploy the React/Vite frontend to Vercel and the Laravel API to Render:

1. Set the Vercel build command to `npm run build`.
2. Set `VITE_API_BASE` in Vercel to the public API URL ending in `/api` (for example, `https://brgy-legaspi-laravel.onrender.com/api`).
3. Deploy the API using the repository's `render.yaml` (configured for Render's Free web-service plan). Provide a PostgreSQL `DATABASE_URL`, Laravel `APP_KEY`, and the exact frontend URL in `CORS_ORIGINS`. Use a random `JWT_SECRET` of at least 32 characters. Existing installations must coordinate JWT rotation because it invalidates existing sessions; the MFA key-rotation procedure below preserves enrolled authenticators.
4. For a new database without an administrator, set `ADMIN_EMAIL`, `ADMIN_MOBILE`, and a strong `ADMIN_PASSWORD` in the Render service environment before the first API login. Change that password after signing in.
5. Set `RESET_DELIVERY_URL` to an authenticated HTTPS notification service before enabling password recovery.

The API migration preserves the `/api` routes and PostgreSQL data model. Laravel runs the schema migration on container startup. Back up the database before the first Laravel deployment and review the migration against a staging copy first. Keep database credentials, application keys, and webhook secrets in deployment environment variables, never in source control.

### Coordinated MFA/JWT key rotation

Node-issued sessions are signed with `JWT_SECRET` and expire after seven days. Do not accept tokens signed with a compromised previous key during rotation. Existing MFA secrets are stored as `v1` ciphertext encrypted using the JWT key; both APIs support a separate `MFA_ENCRYPTION_KEY` and `v2` ciphertext for a controlled migration.

1. Back up PostgreSQL and verify the backup before changing service secrets.
2. Deploy the backward-compatible API code while leaving `MFA_ENCRYPTION_KEY` unset. Confirm the production API remains healthy.
3. Set a new, distinct random `MFA_ENCRYPTION_KEY` (at least 32 characters) on the active API service. Keep the current JWT key temporarily so the service can still read existing `v1` records; new MFA records are written as `v2`.
4. In the active Node service environment, set `DATABASE_URL` and both keys, then run `npm run mfa:rotate-key` to validate the legacy records without changing them. Review only the record counts. After a backup, run `npm run mfa:rotate-key -- --apply` and repeat the dry run to verify no `v1` records remain. The command never prints decrypted values and is safe to rerun if interrupted.
5. Replace `JWT_SECRET` with a new random value on the Node service and redeploy. This intentionally invalidates all existing JWT sessions; users sign in again. Do not configure a previous-key JWT fallback.
6. Configure Laravel with the same new `JWT_SECRET` and `MFA_ENCRYPTION_KEY`, then validate representative login and MFA flows before any frontend cutover.

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
