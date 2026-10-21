# Barangay Legaspi Laravel API

This Laravel 12 service replaces the former Express API while preserving the React frontend's `/api` contract.

For deployment, environment variables, local setup, and database migration guidance, see the [repository README](../README.md).

Profile email changes use a one-time Gmail verification code delivered through Resend. Configure `RESEND_API_KEY` and `PASSWORD_RESET_FROM_EMAIL` (or `SUPER_ADMIN_INVITATION_FROM_EMAIL`) in the Laravel environment. Resident registration and profile updates also support accounts without an email address.

The API schema migration is designed to extend the existing PostgreSQL data. Back up the database and validate the migration against a staging copy before deploying it to production.
