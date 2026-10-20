#!/bin/bash
set -euo pipefail

if [[ "${INIT_NODE_DATABASE:-false}" == "true" ]]; then
    psql \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        --set=db_name="$NODE_DB_NAME" \
        --set=db_user="$NODE_DB_USER" \
        --set=db_password="$NODE_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', :'db_user', :'db_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user') \gexec
SQL
fi

if [[ "${INIT_LARAVEL_DATABASE:-false}" == "true" ]]; then
    if [[ -z "${LARAVEL_DB_NAME:-}" || -z "${LARAVEL_DB_USER:-}" || -z "${LARAVEL_DB_PASSWORD:-}" ]]; then
        echo "Laravel staging database credentials must be configured before starting its profile." >&2
        exit 1
    fi

    psql \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        --set=db_name="$LARAVEL_DB_NAME" \
        --set=db_user="$LARAVEL_DB_USER" \
        --set=db_password="$LARAVEL_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', :'db_user', :'db_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db_name', :'db_user') \gexec
SQL
fi
