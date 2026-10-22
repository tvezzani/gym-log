#!/bin/bash
set -euo pipefail
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 --set app_password="$APP_DB_PASSWORD" --set db_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE gym_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO gym_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
