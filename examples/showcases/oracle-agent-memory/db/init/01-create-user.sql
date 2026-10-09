-- Creates the `cookbook` application user inside the FREEPDB1 pluggable database
-- with the privileges oracleagentmemory needs (tables + AI Vector Search), and a
-- dedicated ASSM tablespace as its DEFAULT.
--
-- WHY THE ASSM TABLESPACE: oracleagentmemory creates tables with native JSON columns
-- and a VECTOR column + HNSW vector index. Those segments are SecureFile LOB/BLOBs,
-- which Oracle forbids in a Manual Segment Space Management (MSSM) tablespace
-- (ORA-43853). On the Free `:latest-lite` image FREEPDB1 has NO USERS tablespace and
-- its default permanent tablespace is SYSTEM (MSSM), so a user with no DEFAULT
-- TABLESPACE lands on SYSTEM and the first JSON table fails. We therefore create an
-- ASSM tablespace (cookbook_ts) and make it the user's default.
--
-- Idempotent — safe to run on every container boot (startup hook). Self-heals ONLY
-- the genuinely broken case: a `cookbook` user stranded on the SYSTEM tablespace
-- (MSSM), which is FREEPDB1's default permanent tablespace on :latest-lite and is what
-- raises ORA-43853. Such a user is dropped (CASCADE) and recreated on cookbook_ts.
-- DROP USER CASCADE is the correct self-heal because Oracle DDL auto-commits: a prior
-- failed run can leave non-JSON tables (schema_meta, actor_profile) stranded in SYSTEM
-- with empty metadata, and oracleagentmemory's 'create_if_necessary' policy will NOT
-- recover from that — it raises a metadata-validation error instead of recreating into
-- the new tablespace. CASCADE removes those stranded objects regardless of tablespace.
--
-- A user already on a working ASSM tablespace (e.g. USERS on the local :latest image)
-- is LEFT UNTOUCHED, so re-running stays non-destructive on the documented local flow.
-- The self-heal drop assumes a fresh boot with no live `cookbook` session (true for the
-- ephemeral, no-volume demo: the DB is recreated each restart). Using a persisted volume
-- would need session-disconnect handling before the drop (the agent reconnects as soon
-- as the listener is up) — out of scope while the demo runs volume-less.
ALTER SESSION SET CONTAINER = FREEPDB1;

SET SERVEROUTPUT ON
DECLARE
  ts_count    INTEGER;
  user_count  INTEGER;
  default_ts  VARCHAR2(128);
BEGIN
  -- 1) Dedicated ASSM tablespace (guarded: CREATE TABLESPACE is NOT idempotent and
  --    raises ORA-01543 if it already exists; REUSE only protects the datafile, not
  --    the tablespace metadata). The datafile path is the verified PDB datafile dir
  --    for the Free image (ORACLE_SID/db_name = FREE; OMF is off so an explicit path
  --    is required). REUSE re-adopts an orphaned datafile left on the persisted volume.
  SELECT COUNT(*) INTO ts_count
    FROM dba_tablespaces
   WHERE tablespace_name = 'COOKBOOK_TS';
  IF ts_count = 0 THEN
    EXECUTE IMMEDIATE
      'CREATE TABLESPACE cookbook_ts ' ||
      'DATAFILE ''/opt/oracle/oradata/FREE/FREEPDB1/cookbook_ts01.dbf'' ' ||
      'SIZE 256M REUSE AUTOEXTEND ON NEXT 64M MAXSIZE 2G ' ||
      'EXTENT MANAGEMENT LOCAL SEGMENT SPACE MANAGEMENT AUTO';
    DBMS_OUTPUT.PUT_LINE('cookbook_ts tablespace created (ASSM)');
  ELSE
    DBMS_OUTPUT.PUT_LINE('cookbook_ts tablespace already exists - skipping');
  END IF;

  -- 2) Self-heal ONLY a user stranded on SYSTEM (MSSM) — the sole default that causes
  --    ORA-43853 (only FREEPDB1's default on :latest-lite). Drop + recreate it on the
  --    ASSM tablespace. A user already on a working ASSM tablespace (e.g. USERS on the
  --    local :latest image, or cookbook_ts itself) is left untouched, so re-running is
  --    non-destructive there. dba_users.default_tablespace is stored uppercase.
  SELECT COUNT(*) INTO user_count
    FROM dba_users WHERE username = 'COOKBOOK';

  IF user_count > 0 THEN
    SELECT default_tablespace INTO default_ts
      FROM dba_users WHERE username = 'COOKBOOK';
    IF default_ts = 'SYSTEM' THEN
      DBMS_OUTPUT.PUT_LINE('cookbook is on SYSTEM (MSSM) - dropping to self-heal onto cookbook_ts');
      EXECUTE IMMEDIATE 'DROP USER cookbook CASCADE';
      user_count := 0;
    ELSE
      DBMS_OUTPUT.PUT_LINE('cookbook user default tablespace is ' || default_ts ||
                           ' (ASSM) - leaving as-is');
    END IF;
  END IF;

  IF user_count = 0 THEN
    EXECUTE IMMEDIATE
      'CREATE USER cookbook IDENTIFIED BY "cookbook_pw" ' ||
      'DEFAULT TABLESPACE cookbook_ts TEMPORARY TABLESPACE temp';
    EXECUTE IMMEDIATE 'GRANT DB_DEVELOPER_ROLE TO cookbook';
    -- GRANT UNLIMITED TABLESPACE covers quota on every tablespace (incl. cookbook_ts),
    -- so no separate QUOTA clause is needed; one privilege, no redundancy.
    EXECUTE IMMEDIATE 'GRANT UNLIMITED TABLESPACE TO cookbook';
    DBMS_OUTPUT.PUT_LINE('cookbook user created (DEFAULT TABLESPACE cookbook_ts)');
  END IF;
END;
/
