-- Ported verbatim from Intelligence infra/app-postgres/init/01-create-databases.sql.
-- Runs once on the postgres container's first boot (docker-entrypoint-initdb.d).
-- The composite image's migrations oneshot + app-api connect to intelligence_app;
-- graphile-migrate uses intelligence_app_shadow for its shadow database.
CREATE DATABASE intelligence_app;
CREATE DATABASE intelligence_app_shadow;
