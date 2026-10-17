#!/bin/sh
set -eu

case "${RUN_MIGRATIONS:-true}" in
    true|1)
        php artisan migrate --force --no-interaction
        ;;
    false|0)
        ;;
    *)
        printf '%s\n' "RUN_MIGRATIONS must be true, false, 1, or 0." >&2
        exit 1
        ;;
esac

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

exec apache2-foreground
