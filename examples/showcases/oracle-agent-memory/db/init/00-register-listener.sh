#!/usr/bin/env bash
# Railway remote-access fix (ORA-12514 / DPY-6001 "FREEPDB1 not registered").
#
# Railway's private network is dual-stack. The agent connects to the database over
# IPv4 (10.x), but the DB's primary address -- what UTL_INADDR.GET_HOST_ADDRESS
# returns -- is IPv6 (fd12:...). Registering the listener service on the IPv6 address
# therefore leaves the IPv4-connecting agent with ORA-12514. This script pins
# LOCAL_LISTENER to the container's own IPv4 address so PMON publishes both FREE (CDB)
# and FREEPDB1 (PDB) to the TCP listener on the exact endpoint the agent reaches.
#
# Runs on every container boot (startup hook). SCOPE=MEMORY -- re-applied each boot.
# The echoed IP + sqlplus output let the deploy logs confirm the fix applied, and on
# which address, without needing shell access to the running container.
#
# Written to be safe whether the startup runner executes or sources it: no `set -e`
# and no `exit` (which would abort the runner / skip 01-create-user.sql).

IP4="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -vE '^127\.' | head -1)"

if [ -z "$IP4" ]; then
  echo "[register-listener] no non-loopback IPv4 found (hostname -I: $(hostname -I 2>/dev/null)); leaving LOCAL_LISTENER at default"
else
  echo "[register-listener] registering services on IPv4 ${IP4}:1521"
  SQLPLUS="${ORACLE_HOME:+${ORACLE_HOME}/bin/}sqlplus"
  "$SQLPLUS" -s "/ as sysdba" <<SQL
WHENEVER SQLERROR CONTINUE
ALTER SESSION SET CONTAINER = CDB\$ROOT;
ALTER SYSTEM SET LOCAL_LISTENER='(ADDRESS=(PROTOCOL=TCP)(HOST=${IP4})(PORT=1521))' SCOPE=MEMORY;
ALTER SYSTEM REGISTER;
EXIT
SQL
  echo "[register-listener] done (IPv4 ${IP4})"
fi
