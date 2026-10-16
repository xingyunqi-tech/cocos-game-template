#!/bin/sh
set -e
exec node "$(dirname "$0")/update-core.mjs" "$@"
