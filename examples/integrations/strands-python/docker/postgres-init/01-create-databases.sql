-- Runs once on the postgres container's first boot (docker-entrypoint-initdb.d).
-- The intelligence composite image's migrations oneshot + app-api connect to
-- intelligence_app; graphile-migrate uses intelligence_app_shadow for its shadow
-- database.
CREATE DATABASE intelligence_app;
CREATE DATABASE intelligence_app_shadow;
