# Barangay Legaspi Laravel API

This Laravel 12 service replaces the former Express API while preserving the React frontend's `/api` contract.

For deployment, environment variables, local setup, and database migration guidance, see the [repository README](../README.md).

The API schema migration is designed to extend the existing PostgreSQL data. Back up the database and validate the migration against a staging copy before deploying it to production.
