# Barangay Legaspi

## Policies

- [Account approval policy](./ACCOUNT_APPROVAL_POLICY.md)
- [Location policy](./LOCATION_POLICY.md)

## Deployment

Deploy the React/Vite frontend to Vercel and the Laravel API to Render:

1. Set the Vercel build command to `npm run build`.
2. Set `VITE_API_BASE` in Vercel to the public API URL ending in `/api` (for example, `https://brgy-legaspi-laravel.onrender.com/api`).
3. Deploy the API using the repository's `render.yaml` (configured for Render's Free web-service plan). Provide a PostgreSQL `DATABASE_URL`, Laravel `APP_KEY`, and the exact frontend URL in `CORS_ORIGINS`. Preserve the existing `JWT_SECRET` when migrating an existing database so current MFA secrets and Express-issued sessions remain compatible; use a random value of at least 32 characters for a new installation. Free Render services sleep when idle and are intended for testing, not production workloads.
4. For a new database without an administrator, set `ADMIN_EMAIL`, `ADMIN_MOBILE`, and a strong `ADMIN_PASSWORD` in the Render service environment before the first API login. Change that password after signing in.
5. Set `RESET_DELIVERY_URL` to an authenticated HTTPS notification service before enabling password recovery.

The API migration preserves the `/api` routes and PostgreSQL data model. Laravel runs the schema migration on container startup. Back up the database before the first Laravel deployment and review the migration against a staging copy first. Keep database credentials, application keys, and webhook secrets in deployment environment variables, never in source control.

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
