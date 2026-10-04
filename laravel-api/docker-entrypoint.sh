#!/bin/sh
set -eu

php artisan migrate --force --no-interaction
exec apache2-foreground
