#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/compose.hostinger.yaml"
ENV_FILE="${ROOT_DIR}/.env.hostinger"

fail() {
    printf 'Setup failed: %s\n' "$*" >&2
    exit 1
}

is_ipv4() {
    local address="$1"
    local octet
    local -a octets
    local first
    local second

    [[ "$address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
    IFS='.' read -r -a octets <<<"$address"
    for octet in "${octets[@]}"; do
        ((10#$octet <= 255)) || return 1
    done
    first=$((10#${octets[0]}))
    second=$((10#${octets[1]}))
    ((first > 0 && first < 224 && first != 10 && first != 127)) || return 1
    ((first != 169 || second != 254)) || return 1
    ((first != 172 || second < 16 || second > 31)) || return 1
    ((first != 192 || second != 168)) || return 1
    ((first != 100 || second < 64 || second > 127))
}

for command in docker curl openssl getent awk grep sort sleep tr; do
    command -v "$command" >/dev/null 2>&1 || fail "Required command not found: ${command}"
done

[[ -f "$COMPOSE_FILE" ]] || fail "Run this script from a complete Barangay Legaspi checkout."
[[ $EUID -eq 0 ]] || fail "Run as root on the VPS, for example: sudo bash scripts/hostinger-vps-setup.sh"
[[ ! -e "$ENV_FILE" ]] || fail "${ENV_FILE} already exists; refusing to overwrite deployment secrets."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not installed."
docker info >/dev/null 2>&1 || fail "Docker is not running or this user cannot access it."

read -r -p "Staging hostname (for example, staging.example.org): " DOMAIN
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "Enter a valid DNS hostname without a scheme or path."
[[ "$DOMAIN" == *.* && "$DOMAIN" != *..* ]] || fail "Enter a fully qualified DNS hostname."

read -r -p "Authorized administrator email: " ADMIN_EMAIL
[[ "$ADMIN_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail "Enter a valid administrator email address."

read -r -p "Authorized administrator mobile (country code, digits only): " ADMIN_MOBILE
[[ "$ADMIN_MOBILE" =~ ^[+]?[0-9]{7,15}$ ]] || fail "Enter a phone number containing 7-15 digits, optionally prefixed with +."

SSH_CLIENT_IPV4="${SSH_CLIENT:-}"
SSH_CLIENT_IPV4="${SSH_CLIENT_IPV4%% *}"
if ! is_ipv4 "$SSH_CLIENT_IPV4"; then
    SSH_CLIENT_IPV4=""
fi
read -r -p "Your authorized staging public IPv4 [${SSH_CLIENT_IPV4:-required}]: " STAGING_ALLOWED_IP
STAGING_ALLOWED_IP="${STAGING_ALLOWED_IP:-$SSH_CLIENT_IPV4}"
is_ipv4 "$STAGING_ALLOWED_IP" || fail "Enter a valid public IPv4 address to restrict staging access."
STAGING_ALLOWED_CIDR="${STAGING_ALLOWED_IP}/32"

PUBLIC_IPV4="$(curl --fail --silent --show-error --max-time 15 https://api.ipify.org)" \
    || fail "Could not determine the VPS public IPv4 address."
DOMAIN_IPV4="$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u || true)"
printf '%s\n' "$DOMAIN_IPV4" | grep -Fxq "$PUBLIC_IPV4" \
    || fail "The hostname must resolve to this VPS IPv4 (${PUBLIC_IPV4}) before setup."

APP_KEY="base64:$(openssl rand -base64 32 | tr -d '\n')"
JWT_SECRET="$(openssl rand -hex 32)"
MFA_ENCRYPTION_KEY="$(openssl rand -hex 32)"
POSTGRES_PASSWORD="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -hex 24)"
POSTGRES_DB="barangay_legaspi"
POSTGRES_USER="barangay_app"

umask 077
TEMP_ENV="$(mktemp "${ROOT_DIR}/.env.hostinger.XXXXXX")"
trap 'rm -f "$TEMP_ENV"' EXIT
cat >"$TEMP_ENV" <<EOF
DOMAIN=${DOMAIN}
STAGING_ALLOWED_CIDR=${STAGING_ALLOWED_CIDR}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
APP_KEY=${APP_KEY}
JWT_SECRET=${JWT_SECRET}
MFA_ENCRYPTION_KEY=${MFA_ENCRYPTION_KEY}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_MOBILE=${ADMIN_MOBILE}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_FORCE_PATH_STYLE=false
RESET_DELIVERY_URL=
EOF
chmod 600 "$TEMP_ENV"
mv "$TEMP_ENV" "$ENV_FILE"
trap - EXIT

cd "$ROOT_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet \
    || fail "Docker Compose rejected the deployment configuration."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres

printf 'Waiting for the private PostgreSQL database'
for _ in $(seq 1 60); do
    POSTGRES_CONTAINER="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps -q postgres)"
    DB_STATE=""
    if [[ -n "$POSTGRES_CONTAINER" ]]; then
        DB_STATE="$(docker inspect --format '{{.State.Health.Status}}' "$POSTGRES_CONTAINER" 2>/dev/null || true)"
    fi
    if [[ "$DB_STATE" == "healthy" ]]; then
        printf '\n'
        break
    fi
    printf '.'
    sleep 2
done
[[ "${DB_STATE:-}" == "healthy" ]] || {
    printf '\n'
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail 60 postgres >&2
    fail "PostgreSQL did not become healthy within 120 seconds."
}

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm laravel-api php artisan migrate --force
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

printf 'Waiting for public HTTPS and Laravel/PostgreSQL health'
API_HEALTHY=false
for _ in $(seq 1 60); do
    if docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T frontend \
        wget -qO- http://laravel-api/api/health 2>/dev/null | grep -q '"storage":"pgsql"'; then
        API_HEALTHY=true
        break
    fi
    printf '.'
    sleep 2
done
printf '\n'
[[ "$API_HEALTHY" == "true" ]] || {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail 80 laravel-api postgres >&2
    fail "Laravel did not report a healthy PostgreSQL connection."
}

cat <<EOF

Staging stack is running.
URL: https://${DOMAIN}
API health: https://${DOMAIN}/api/health
Access restricted to: ${STAGING_ALLOWED_CIDR}

Initial administrator:
  Email: ${ADMIN_EMAIL}
  Mobile: ${ADMIN_MOBILE}
  Temporary password: ${ADMIN_PASSWORD}

Change the temporary password immediately after the first login. Store it securely,
then remove it from this terminal history/output. The generated deployment secrets
are stored in ${ENV_FILE} with owner-only permissions.

This creates a NEW, EMPTY database. It does not migrate production residents,
requests, announcements, passwords, or MFA enrollments. Do not point production
DNS here until a reviewed data migration, backup/restore rehearsal, and rollback
test have passed. Object storage and password-reset delivery are not configured.
EOF
