-- Creates the `cookbook` application user inside the FREEPDB1 pluggable database
-- with the privileges oracleagentmemory needs (tables + AI Vector Search).
--
-- Idempotent — safe to run repeatedly. Run it via `db/setup-db.sh` after the
-- database is ready. NOTE: the Oracle Database Free image does NOT reliably
-- auto-run scripts mounted into /opt/oracle/scripts/setup, so the cookbook
-- invokes this explicitly rather than depending on first-boot execution.
ALTER SESSION SET CONTAINER = FREEPDB1;

SET SERVEROUTPUT ON
DECLARE
  user_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM dba_users WHERE username = 'COOKBOOK';
  IF user_count = 0 THEN
    EXECUTE IMMEDIATE 'CREATE USER cookbook IDENTIFIED BY "cookbook_pw"';
    EXECUTE IMMEDIATE 'GRANT DB_DEVELOPER_ROLE TO cookbook';
    EXECUTE IMMEDIATE 'GRANT UNLIMITED TABLESPACE TO cookbook';
    DBMS_OUTPUT.PUT_LINE('cookbook user created');
  ELSE
    DBMS_OUTPUT.PUT_LINE('cookbook user already exists - skipping');
  END IF;
END;
/
