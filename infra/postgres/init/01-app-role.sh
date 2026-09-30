#!/bin/sh
# Runs once, when the Postgres volume is first created: the API's login role, which owns nothing,
# so row-level security always applies to it. The migrations grant it what it may do.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE grand_app LOGIN PASSWORD '${APP_DB_PASSWORD:?Set APP_DB_PASSWORD}';
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO grand_app;
SQL
