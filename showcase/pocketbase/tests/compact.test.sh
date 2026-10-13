#!/bin/sh
# Tests for the copy-and-swap compaction scripts (scripts/compact-*.sh and
# the compact-swap.sh step of entrypoint.sh).
#
# The real scripts run against small synthetic SQLite databases in a temp
# PB_DATA_DIR, with the host's sqlite3 and a POSIX shell. There is no Docker
# and no PocketBase. Failures are injected with small PATH shims (mv,
# sqlite3, df, sync), so the scripts under test are not changed.
#
#   sh tests/compact.test.sh            run every test
#   sh tests/compact.test.sh NAME...    run only the named tests
#
# Env:
#   COMPACT_SCRIPTS_DIR  scripts under test (default: ../scripts)
#   COMPACT_ENTRYPOINT   entrypoint.sh under test (default: ../entrypoint.sh)
#   TEST_SH              shell that runs the scripts (default: dash when it
#                        is installed, else sh). The image runs busybox ash.
#
# Exit status: 0 when every test passed, 1 otherwise.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPTS=$(cd "${COMPACT_SCRIPTS_DIR:-$HERE/../scripts}" && pwd)
ENTRYPOINT=${COMPACT_ENTRYPOINT:-$HERE/../entrypoint.sh}
if [ -n "${TEST_SH:-}" ]; then
    TSH=$TEST_SH
elif command -v dash >/dev/null 2>&1; then
    TSH=$(command -v dash)
else
    TSH=/bin/sh
fi

TEST_REAL_SQLITE=$(command -v sqlite3) || { echo "sqlite3 is not installed" >&2; exit 2; }
TEST_REAL_MV=$(command -v mv)
TEST_REAL_DF=$(command -v df)
TEST_REAL_STAT=$(command -v stat)
TEST_REAL_RM=$(command -v rm)
TEST_REAL_SHA256SUM=$(command -v sha256sum) || { echo "sha256sum is not installed" >&2; exit 2; }
export TEST_REAL_SQLITE TEST_REAL_MV TEST_REAL_DF TEST_REAL_STAT TEST_REAL_RM TEST_REAL_SHA256SUM

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/pb-compact-test.XXXXXX") || exit 2
ROOT=$(cd "$ROOT" && pwd -P)
SHIM="$ROOT/bin"
mkdir -p "$SHIM"

kill_holders() {
    for _p in "$ROOT"/*/holder.pid "$ROOT"/*/keeper.pid; do
        [ -f "$_p" ] && kill -9 "$(cat "$_p")" 2>/dev/null
    done
    return 0
}
cleanup() {
    kill_holders
    rm -rf "$ROOT"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ---- shims -------------------------------------------------------------------
# sqlite3: SQ_FAIL_MATCH makes every call whose arguments contain that text
# fail; with SQ_FAIL_SKIP=n the first n such calls still work (SQ_FAIL_COUNT
# is the counter file). SQ_HOOK_MATCH runs SQ_HOOK_CMD once, after the first
# call whose arguments contain that text (SQ_HOOK_DONE records that it ran).
cat >"$SHIM/sqlite3" <<'EOF'
#!/bin/sh
all="$*"
if [ -n "${SQ_FAIL_MATCH:-}" ]; then
    case "$all" in
        *"$SQ_FAIL_MATCH"*)
            if [ -n "${SQ_FAIL_SKIP:-}" ]; then
                n=$(cat "$SQ_FAIL_COUNT" 2>/dev/null || echo 0)
                echo $((n + 1)) >"$SQ_FAIL_COUNT"
            fi
            if [ -z "${SQ_FAIL_SKIP:-}" ] || [ "$n" -ge "$SQ_FAIL_SKIP" ]; then
                echo "Error: injected failure" >&2
                exit 1
            fi
            ;;
    esac
fi
"$TEST_REAL_SQLITE" "$@"
rc=$?
if [ -n "${SQ_HOOK_MATCH:-}" ] && [ ! -e "$SQ_HOOK_DONE" ]; then
    case "$all" in
        *"$SQ_HOOK_MATCH"*)
            : >"$SQ_HOOK_DONE"
            sh -c "$SQ_HOOK_CMD" </dev/null >/dev/null 2>&1
            ;;
    esac
fi
exit $rc
EOF

# mv: fails when the source matches one of the globs in MV_FAIL_SRC. With
# MV_KILL_SRC it kills the boot (see kill-boot) instead of moving a matching
# source; with MV_KILL_AFTER_SRC it moves it and then kills the boot. That
# is the container dying just before or just after that rename. With
# MV_COPY_SRC it copies a matching source and leaves it in place: a rename
# whose result is unclear (both paths exist afterwards).
cat >"$SHIM/mv" <<'EOF'
#!/bin/sh
set -f
for p in ${MV_FAIL_SRC:-}; do
    # shellcheck disable=SC2254
    case "$1" in $p) echo "mv: injected failure: $1" >&2; exit 1 ;; esac
done
for p in ${MV_KILL_SRC:-}; do
    # shellcheck disable=SC2254
    case "$1" in $p) kill-boot $$; exit 137 ;; esac
done
for p in ${MV_KILL_AFTER_SRC:-}; do
    # shellcheck disable=SC2254
    case "$1" in $p) "$TEST_REAL_MV" "$@"; kill-boot $$; exit 137 ;; esac
done
for p in ${MV_COPY_SRC:-}; do
    # shellcheck disable=SC2254
    case "$1" in $p) cp -p "$1" "$2"; exit 0 ;; esac
done
exec "$TEST_REAL_MV" "$@"
EOF

# rm: with RM_FAIL_MATCH (a glob), a call with an argument that matches it
# fails and removes nothing, after the first RM_FAIL_SKIP such calls
# (RM_FAIL_COUNT is the counter file).
cat >"$SHIM/rm" <<'EOF'
#!/bin/sh
if [ -n "${RM_FAIL_MATCH:-}" ]; then
    for a in "$@"; do
        # shellcheck disable=SC2254
        case "$a" in
            $RM_FAIL_MATCH)
                n=$(cat "$RM_FAIL_COUNT" 2>/dev/null || echo 0)
                echo $((n + 1)) >"$RM_FAIL_COUNT"
                if [ "$n" -ge "${RM_FAIL_SKIP:-0}" ]; then
                    echo "rm: injected failure: $a" >&2
                    exit 1
                fi
                break
                ;;
        esac
    done
fi
exec "$TEST_REAL_RM" "$@"
EOF

# kill-boot PID: SIGKILL PID and every ancestor that is part of the boot
# (entrypoint.sh, compact-swap.sh, compact-build.sh, a sqlite3 or mv shim),
# all at once, as when the container dies. The test runner is not one of
# them. Records the kill in $KILL_LOG when set.
cat >"$SHIM/kill-boot" <<'EOF'
#!/bin/sh
pids=$1
p=$(ps -o ppid= -p "$1" | tr -d ' ')
while [ -n "$p" ] && [ "$p" -gt 1 ]; do
    case "$(ps -o command= -p "$p")" in
        *entrypoint.sh* | *compact-swap.sh* | *compact-build.sh* | */sqlite3* | */mv*) pids="$pids $p" ;;
        *) break ;;
    esac
    p=$(ps -o ppid= -p "$p" | tr -d ' ')
done
[ -n "${KILL_LOG:-}" ] && echo "killed $pids" >>"$KILL_LOG"
kill -9 $pids
EOF

# df: with FAKE_DF_FILE, "Available" comes from that file. Each line is
# "<last call number> <available KiB>"; call n uses the first line whose
# call number is >= n.
cat >"$SHIM/df" <<'EOF'
#!/bin/sh
if [ -n "${FAKE_DF_FILE:-}" ]; then
    n=$(cat "$FAKE_DF_FILE.n" 2>/dev/null || echo 0)
    n=$((n + 1))
    echo "$n" >"$FAKE_DF_FILE.n"
    avail=$(awk -v n="$n" '$1 >= n { print $2; exit }' "$FAKE_DF_FILE")
    echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
    echo "fakefs 999999999 1 $avail 1% /"
    exit 0
fi
exec "$TEST_REAL_DF" "$@"
EOF

# sync: records whether the manifest existed at each call. With
# SYNC_FAIL_WATCH it fails while that path exists.
cat >"$SHIM/sync" <<'EOF'
#!/bin/sh
if [ -n "${SYNC_LOG:-}" ]; then
    m=0
    [ -e "$SYNC_WATCH" ] && m=1
    echo "sync manifest=$m" >>"$SYNC_LOG"
fi
if [ -n "${SYNC_FAIL_WATCH:-}" ] && [ -e "$SYNC_FAIL_WATCH" ]; then
    echo "sync: injected failure" >&2
    exit 1
fi
exit 0
EOF

# No pocketbase process runs on the test host. PIDOF_RC=127 plays a
# missing pidof.
# shellcheck disable=SC2016 # expanded when the shim runs, not here
printf '#!/bin/sh\nexit "${PIDOF_RC:-1}"\n' >"$SHIM/pidof"
# entrypoint.sh: chown and su-exec are no-ops here; "pocketbase" only
# records that it was started.
printf '#!/bin/sh\nexit 0\n' >"$SHIM/chown"
# shellcheck disable=SC2016 # expanded when the shim runs, not here
printf '#!/bin/sh\nshift\nexec "$@"\n' >"$SHIM/su-exec"
# shellcheck disable=SC2016 # expanded when the shim runs, not here
printf '#!/bin/sh\necho "started $*" >>"$PB_STARTED_LOG"\n' >"$SHIM/fake-pocketbase"

# The scripts use GNU/busybox `stat -c %s`; BSD stat (macOS) spells it -f %z.
if ! "$TEST_REAL_STAT" -c %s / >/dev/null 2>&1; then
    cat >"$SHIM/stat" <<'EOF'
#!/bin/sh
if [ "$1" = -c ] && [ "$2" = %s ]; then
    exec "$TEST_REAL_STAT" -f %z "$3"
fi
exec "$TEST_REAL_STAT" "$@"
EOF
fi
# sha256sum: NO_SHA256SUM=1 plays a host without it.
cat >"$SHIM/sha256sum" <<'EOF'
#!/bin/sh
if [ -n "${NO_SHA256SUM:-}" ]; then
    echo "sha256sum: not found" >&2
    exit 127
fi
exec "$TEST_REAL_SHA256SUM" "$@"
EOF

# fake-remote CMD: the remote command for an off-box build. The "box" is
# this host, so it runs CMD with sh. With FR_DROP_MATCH, a command that
# contains that text loses its connection part way (output cut short, exit
# 255) the first FR_DROP_TIMES times (FR_DROP_COUNT is the counter file).
# With FR_FAIL_MATCH, such a command fails with exit 1 after FR_FAIL_SKIP
# successful ones (FR_FAIL_COUNT). With FR_TAMPER_MATCH, the gzip'd output
# of such a command is changed by the sed script FR_TAMPER_SED. With
# FR_SLEEP_MATCH, such a command first touches FR_SLEEP_FLAG and sleeps
# FR_SLEEP_S seconds. With FR_SNOOP_MATCH, the target of the symlink
# FR_SNOOP_LINK is appended to FR_SNOOP_OUT before such a command runs.
cat >"$SHIM/fake-remote" <<'EOF'
#!/bin/sh
cmd=$1
if [ -n "${FR_SNOOP_MATCH:-}" ]; then
    case "$cmd" in
        *"$FR_SNOOP_MATCH"*) echo "$(readlink "$FR_SNOOP_LINK" 2>/dev/null || echo none)" >>"$FR_SNOOP_OUT" ;;
    esac
fi
if [ -n "${FR_SLEEP_MATCH:-}" ]; then
    case "$cmd" in
        *"$FR_SLEEP_MATCH"*) : >"$FR_SLEEP_FLAG"; sleep "$FR_SLEEP_S" ;;
    esac
fi
if [ -n "${FR_DROP_MATCH:-}" ]; then
    case "$cmd" in
        *"$FR_DROP_MATCH"*)
            n=$(cat "$FR_DROP_COUNT" 2>/dev/null || echo 0)
            if [ "$n" -lt "${FR_DROP_TIMES:-1}" ]; then
                echo $((n + 1)) >"$FR_DROP_COUNT"
                sh -c "$cmd" | head -c 300
                exit 255
            fi
            ;;
    esac
fi
if [ -n "${FR_FAIL_MATCH:-}" ]; then
    case "$cmd" in
        *"$FR_FAIL_MATCH"*)
            n=$(cat "$FR_FAIL_COUNT" 2>/dev/null || echo 0)
            echo $((n + 1)) >"$FR_FAIL_COUNT"
            if [ "$n" -ge "${FR_FAIL_SKIP:-0}" ]; then
                echo "fake-remote: injected failure" >&2
                exit 1
            fi
            ;;
    esac
fi
if [ -n "${FR_TAMPER_MATCH:-}" ]; then
    case "$cmd" in
        *"$FR_TAMPER_MATCH"*)
            sh -c "$cmd" | gzip -dc | sed "$FR_TAMPER_SED" | gzip -1
            exit 0
            ;;
    esac
fi
exec sh -c "$cmd"
EOF

chmod +x "$SHIM"/*
PATH="$SHIM:$PATH"
export PATH

# ---- fixtures ----------------------------------------------------------------
ROWS=1500             # rows per pruned table, spread over 60 days
STEP_S=3456           # 60 days / ROWS

# make_db FILE IDENTITY [seqgap]
# A small database shaped like PocketBase's: the four pruned tables, an auth
# style table with a UNIQUE index, two AUTOINCREMENT tables (so
# sqlite_sequence sits between them in schema order), a WITHOUT ROWID table
# that holds IDENTITY, an index, a view and a trigger. With "seqgap" the
# sqlite_sequence rowids have a gap, as after a dropped AUTOINCREMENT table.
make_db() {
    _gap=""
    if [ "${3:-}" = seqgap ]; then
        _gap="DELETE FROM sqlite_sequence WHERE name = 'counters'; INSERT INTO counters (label) VALUES ('gap');"
    fi
    "$TEST_REAL_SQLITE" "$1" >/dev/null <<SQL
.dbconfig dqs_ddl on
.dbconfig dqs_dml on
PRAGMA journal_mode = WAL;
CREATE TABLE _collections (id TEXT PRIMARY KEY NOT NULL, name TEXT UNIQUE NOT NULL, updateRule TEXT DEFAULT NULL);
CREATE TABLE status_history (id TEXT PRIMARY KEY DEFAULT ('r' || lower(hex(randomblob(7)))) NOT NULL, created TEXT DEFAULT "" NOT NULL, updated TEXT DEFAULT "" NOT NULL, data TEXT DEFAULT "" NOT NULL);
CREATE TABLE diag_events (id TEXT PRIMARY KEY DEFAULT ('r' || lower(hex(randomblob(7)))) NOT NULL, created TEXT DEFAULT "" NOT NULL, updated TEXT DEFAULT "" NOT NULL, data TEXT DEFAULT "" NOT NULL);
CREATE TABLE cvdiag_events (id TEXT PRIMARY KEY DEFAULT ('r' || lower(hex(randomblob(7)))) NOT NULL, created TEXT DEFAULT "" NOT NULL, updated TEXT DEFAULT "" NOT NULL, data TEXT DEFAULT "" NOT NULL);
CREATE TABLE probe_runs (id TEXT PRIMARY KEY DEFAULT ('r' || lower(hex(randomblob(7)))) NOT NULL, created TEXT DEFAULT "" NOT NULL, updated TEXT DEFAULT "" NOT NULL, state TEXT DEFAULT "" NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL);
CREATE TABLE jobs (id TEXT PRIMARY KEY NOT NULL, created TEXT DEFAULT "" NOT NULL, updated TEXT DEFAULT "" NOT NULL, status TEXT DEFAULT "" NOT NULL);
CREATE TABLE counters (n INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT);
CREATE TABLE tags (n INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT);
CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
CREATE UNIQUE INDEX idx_users_email ON users (email);
CREATE INDEX idx_status_history_created ON status_history (created);
CREATE VIEW recent_status AS SELECT id, created FROM status_history;
CREATE TRIGGER users_touch AFTER INSERT ON users BEGIN UPDATE kv SET v = v WHERE k = 'identity'; END;
INSERT INTO _collections VALUES ('c1', 'status_history', NULL), ('c2', 'diag_events', NULL),
    ('c3', 'cvdiag_events', NULL), ('c4', 'probe_runs', ''), ('c5', 'users', ''), ('c6', 'jobs', '');
INSERT INTO kv VALUES ('identity', '$2');
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < $ROWS)
INSERT INTO status_history (id, created, updated, data)
SELECT 'sh' || i, strftime('%Y-%m-%d %H:%M:%f', 'now', '-' || (($ROWS - i) * $STEP_S + 60) || ' seconds') || 'Z',
       strftime('%Y-%m-%d %H:%M:%f', 'now', '-' || (($ROWS - i) * $STEP_S + 60) || ' seconds') || 'Z', 'row ' || i FROM n;
INSERT INTO diag_events (id, created, updated, data) SELECT 'de' || substr(id, 3), created, updated, data FROM status_history ORDER BY rowid;
INSERT INTO cvdiag_events (id, created, updated, data) SELECT 'cv' || substr(id, 3), created, updated, data FROM status_history ORDER BY rowid;
INSERT INTO probe_runs (id, created, updated, state) SELECT 'pr' || substr(id, 3), created, updated, 'done' FROM status_history ORDER BY rowid;
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50)
INSERT INTO jobs SELECT 'j' || i, strftime('%Y-%m-%d %H:%M:%f', 'now', '-1 day') || 'Z', strftime('%Y-%m-%d %H:%M:%f', 'now', '-1 day') || 'Z', 'queued' FROM n;
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20)
INSERT INTO users SELECT 'u' || i, 'user' || i || '@example.com' FROM n;
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10)
INSERT INTO counters (label) SELECT 'c' || i FROM n;
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5)
INSERT INTO tags (label) SELECT 't' || i FROM n;
$_gap
SQL
}

# Writes PocketBase would make while the build waits for the swap.
mutate_live() {
    "$TEST_REAL_SQLITE" "$D/data.db" >/dev/null <<'SQL'
.dbconfig dqs_dml on
INSERT INTO status_history (id, created, updated, data) VALUES ('sh-after', strftime('%Y-%m-%d %H:%M:%f', 'now') || 'Z', strftime('%Y-%m-%d %H:%M:%f', 'now') || 'Z', 'after build');
INSERT INTO diag_events (id, created, updated, data) VALUES ('de-after', strftime('%Y-%m-%d %H:%M:%f', 'now') || 'Z', strftime('%Y-%m-%d %H:%M:%f', 'now') || 'Z', 'after build');
UPDATE probe_runs SET state = 'updated after build', updated = strftime('%Y-%m-%d %H:%M:%f', 'now') || 'Z' WHERE id = 'pr1500';
INSERT INTO users VALUES ('u-after', 'after@example.com');
INSERT INTO counters (label) VALUES ('after build');
SQL
}

# Not -readonly: on macOS a read-only open of a WAL file fails when its -shm
# does not exist yet.
q() {
    "$TEST_REAL_SQLITE" "$1" "$2" 2>&1
}

ident() {
    [ -e "$1" ] || { echo "(no file)"; return; }
    q "$1" "SELECT v FROM kv WHERE k = 'identity';"
}

# First existing path among the arguments (a glob), else a path that does
# not exist.
first() {
    for _p in "$@"; do
        [ -e "$_p" ] && { echo "$_p"; return; }
    done
    echo /nonexistent
}

# Number of database files (not -wal or -shm) among the arguments (a glob).
count_db_files() {
    _n=0
    for _p in "$@"; do
        case "$_p" in *-wal | *-shm) continue ;; esac
        [ -e "$_p" ] && _n=$((_n + 1))
    done
    echo "$_n"
}

# 1 when FILE holds every write mutate_live made.
has_after_rows() {
    q "$1" "SELECT (SELECT count(*) FROM status_history WHERE id = 'sh-after')
        + (SELECT count(*) FROM diag_events WHERE id = 'de-after')
        + (SELECT count(*) FROM probe_runs WHERE id = 'pr1500' AND state = 'updated after build')
        + (SELECT count(*) FROM users WHERE id = 'u-after')
        + (SELECT count(*) FROM counters WHERE label = 'after build') = 5;"
}

# ---- runners -----------------------------------------------------------------
# Each test runs in its own directory $T with PB_DATA_DIR=$D. The host has no
# /proc, so the swap looks for open files in a fake one, $T/proc, made by the
# test loop: one entry, so the check can tell it looked. A test adds
# "$T/proc/<pid>/fd/<n>" links to play a process that has a file open.
fake_open() {
    mkdir -p "$T/proc/$1/fd"
    ln -s "$3" "$T/proc/$1/fd/$2"
}

run_build() {
    env PB_DATA_DIR="$D" PB_COMPACT_OUT_DIR="$D/compact" PB_COMPACT_CHUNK_ROWS=100 PB_COMPACT_PAUSE_S=0 PB_COMPACT_MIN_FREE_MB=1 \
        PB_COMPACT_HEADROOM_MB=1 "$@" "$TSH" "$SCRIPTS/compact-build.sh" >>"$T/build.out" 2>&1
}

# Sets SWAP_RC.
run_swap() {
    env PB_DATA_DIR="$D" PB_COMPACT_PROC_DIR="$T/proc" "$@" "$TSH" "$SCRIPTS/compact-swap.sh" >>"$T/swap.out" 2>&1
    SWAP_RC=$?
    return "$SWAP_RC"
}

# Runs a copy of entrypoint.sh with its paths pointed at the test. Sets
# BOOT_RC, and PB_STARTED to 1 when it started "pocketbase". BOOT_SCRIPTS
# points it at another copy of the scripts.
boot() {
    sed -e "s|/usr/local/lib/pb-compact/compact-swap.sh|$TSH ${BOOT_SCRIPTS:-$SCRIPTS}/compact-swap.sh|" \
        -e "s|/usr/local/bin/pocketbase|$SHIM/fake-pocketbase|g" \
        -e "s|/pb_data|$D|g" "$ENTRYPOINT" >"$T/entrypoint.sh"
    rm -f "$T/pb.log"
    env PB_DATA_DIR="$D" PB_COMPACT_PROC_DIR="$T/proc" PB_STARTED_LOG="$T/pb.log" "$@" \
        "$TSH" "$T/entrypoint.sh" serve >>"$T/boot.out" 2>&1
    BOOT_RC=$?
    PB_STARTED=0
    [ -s "$T/pb.log" ] && PB_STARTED=1
    return 0
}

T_OK=1
ok() {
    echo "    ok: $1"
}
bad() {
    echo "    FAIL: $1"
    T_OK=0
}
# check DESCRIPTION COMMAND...
check() {
    _d=$1
    shift
    if "$@"; then ok "$_d"; else bad "$_d"; fi
}
eq() {
    [ "$1" = "$2" ] || { echo "      expected [$2], got [$1]"; return 1; }
}
ne() {
    [ "$1" != "$2" ] || { echo "      expected anything but [$2]"; return 1; }
}
present() { [ -e "$1" ]; }
absent() { [ ! -e "$1" ]; }
# No file and no symlink (a dangling one too, such as the build lock).
no_path() { [ ! -e "$1" ] && [ ! -L "$1" ]; }
grep_q() { grep -q "$1" "$2"; }
no_grep() { ! grep -q "$1" "$2"; }
is_set() { [ -n "$1" ] || { echo "      expected a value, got nothing"; return 1; }; }
is_number() {
    case "$1" in "" | *[!0-9]*) echo "      expected a number, got [$1]"; return 1 ;; esac
}

# A built database plus PocketBase's later writes, ready to swap.
setup_built() {
    make_db "$D/data.db" live "${1:-}"
    run_build || { echo "    (setup) build failed:"; tail -5 "$T/build.out" | sed 's/^/      /'; return 1; }
    mutate_live
}

# ---- tests: swap ----------------------------------------------------------------

# A plain build, swap and rollback all work (regression guard).
t_swap_happy_path() {
    setup_built || { bad "setup"; return; }
    cp "$D/compact/data.db.new" "$T/new-before-swap.db"
    cp "$D/data.db" "$T/live-before-swap.db"
    boot PB_COMPACT_SWAP=1
    check "boot exits 0" eq "$BOOT_RC" 0
    check "pocketbase started" eq "$PB_STARTED" 1
    check "swap logged success" grep_q "COMPACTION SWAPPED IN" "$T/boot.out"
    check "by design, the writes made after the build are not in data.db" eq "$(has_after_rows "$D/data.db")" 0
    check "they are in the old file" eq "$(has_after_rows "$(first "$D"/data.db.pre-compact-*)")" 1
    _man=$(first "$D"/compact/manifest.done-*)
    check "manifest marked done" present "$_man"
    check "data.db is the build's file, row for row" same_db "$D/data.db" "$T/new-before-swap.db"
    check "sqlite_sequence has one row per table" eq "$(q "$D/data.db" "SELECT count(*) - count(DISTINCT name) FROM sqlite_sequence;")" 0
    check "integrity ok" eq "$(q "$D/data.db" "PRAGMA integrity_check;")" ok
    sleep 1
    boot PB_COMPACT_ROLLBACK=1
    check "rollback boot exits 0" eq "$BOOT_RC" 0
    check "rollback logged" grep_q "ROLLED BACK" "$T/boot.out"
    check "data.db is the pre-swap file again" eq "$(q "$D/data.db" "SELECT count(*) FROM status_history;")" "$(q "$T/live-before-swap.db" "SELECT count(*) FROM status_history;")"
}

# MUST FIX "exit codes from the subshell": the second rename fails and the
# old file cannot be put back. data.db is gone, so the boot must stop.
t_cutover_unrecoverable_stops_boot() {
    setup_built || { bad "setup"; return; }
    boot PB_COMPACT_SWAP=1 MV_FAIL_SRC="*/compact/data.db.new *data.db.pre-compact-*"
    check "boot exits non-zero" ne "$BOOT_RC" 0
    check "pocketbase did not start" eq "$PB_STARTED" 0
    check "no empty data.db was created" absent "$D/data.db"
    check "the old file is still there" eq "$(count_db_files "$D"/data.db.pre-compact-*)" 1
    check "swap marker kept for the next boot" present "$D/compact/swap-in-progress"
    # Next boot with the rename working again: the old file goes back.
    boot
    check "next boot exits 0" eq "$BOOT_RC" 0
    check "next boot restored data.db" eq "$(has_after_rows "$D/data.db")" 1
}

# The second rename fails but the old file can be put back: PocketBase
# starts on the old data.db (regression guard).
t_cutover_rename_fail_restores() {
    setup_built || { bad "setup"; return; }
    boot PB_COMPACT_SWAP=1 MV_FAIL_SRC="*/compact/data.db.new"
    check "boot exits 0" eq "$BOOT_RC" 0
    check "pocketbase started" eq "$PB_STARTED" 1
    check "data.db is the old file with every row" eq "$(has_after_rows "$D/data.db")" 1
    check "no swap marker left" absent "$D/compact/swap-in-progress"
    check "manifest burned" present "$(first "$D"/compact/manifest.failed-*)"
}

# MUST FIX "marker present with both files missing": exit non-zero.
t_marker_both_missing_stops_boot() {
    mkdir -p "$D/compact"
    printf 'swap\n%s\n%s\n' "$D/data.db.pre-compact-20260101T000000Z" "$D/compact/data.db.new" >"$D/compact/swap-in-progress"
    boot
    check "boot exits non-zero" ne "$BOOT_RC" 0
    check "pocketbase did not start" eq "$PB_STARTED" 0
    check "swap marker kept" present "$D/compact/swap-in-progress"
}

# The marker from an interrupted swap puts the old file back (new marker
# format: kind, where data.db went, what was to replace it).
t_marker_restores_old_file() {
    mkdir -p "$D/compact"
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    printf 'swap\n%s\n%s\n' "$D/data.db.pre-compact-20260101T000000Z" "$D/compact/data.db.new" >"$D/compact/swap-in-progress"
    : >"$D/compact/data.db.new"
    boot
    check "boot exits 0" eq "$BOOT_RC" 0
    check "data.db is the old file" eq "$(ident "$D/data.db")" old
    check "swap marker removed" absent "$D/compact/swap-in-progress"
}

# data.db is missing while compaction backups exist: PocketBase must not
# start and create an empty database next to them.
t_missing_live_with_backups_stops_boot() {
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    boot
    check "boot exits non-zero" ne "$BOOT_RC" 0
    check "pocketbase did not start" eq "$PB_STARTED" 0
}

# A fresh volume (no data.db, nothing else) boots normally.
t_fresh_volume_boots() {
    boot PB_COMPACT_SWAP=1 PB_COMPACT_ROLLBACK=1
    check "boot exits 0" eq "$BOOT_RC" 0
    check "pocketbase started" eq "$PB_STARTED" 1
}

# MUST FIX "rollback": the restore after a failed rollback rename fails too.
# data.db must not end up missing while PocketBase starts.
t_rollback_unrecoverable_stops_boot() {
    make_db "$D/data.db" live
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    boot PB_COMPACT_ROLLBACK=1 MV_FAIL_SRC="*data.db.pre-compact-* *data.db.rolled-back-*"
    # With this injection data.db was moved away and cannot come back.
    check "data.db is missing" absent "$D/data.db"
    check "boot exits non-zero" ne "$BOOT_RC" 0
    check "pocketbase did not start" eq "$PB_STARTED" 0
    check "swap marker kept for the next boot" present "$D/compact/swap-in-progress"
    check "the live file is kept as the rolled-back file" eq "$(ident "$(first "$D"/data.db.rolled-back-*)")" live
    check "the old file still exists" eq "$(ident "$D/data.db.pre-compact-20260101T000000Z")" old
}

# MUST FIX "rollback, nothing may be overwritten": the old file cannot be
# moved in. The undo must not rename over anything, and the old file's
# empty -wal must not be left behind or moved next to another file.
t_rollback_partial_move_overwrites_nothing() {
    make_db "$D/data.db" live
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    : >"$D/data.db.pre-compact-20260101T000000Z-wal"
    boot PB_COMPACT_ROLLBACK=1 MV_FAIL_SRC="*/data.db.pre-compact-20260101T000000Z"
    check "boot exits 0" eq "$BOOT_RC" 0
    check "data.db is the live file" eq "$(ident "$D/data.db")" live
    check "the old file survives" eq "$(ident "$D/data.db.pre-compact-20260101T000000Z")" old
    check "rollback reported as not done" grep_q "rollback NOT done" "$T/boot.out"
    check "no rolled-back file left" eq "$(count_db_files "$D"/data.db.rolled-back-*)" 0
    check "rollback.done removed, so a rollback can be tried again" absent "$D/compact/rollback.done"
}

# MUST FIX "rollback must be one-shot": the flag left set across two boots
# must not walk back to an older backup.
t_rollback_is_one_shot() {
    make_db "$D/data.db" current
    make_db "$D/data.db.pre-compact-20260101T000000Z" older
    make_db "$D/data.db.pre-compact-20260201T000000Z" newer
    boot PB_COMPACT_ROLLBACK=1
    check "first boot exits 0" eq "$BOOT_RC" 0
    check "first boot rolled back to the newest backup" eq "$(ident "$D/data.db")" newer
    sleep 1
    boot PB_COMPACT_ROLLBACK=1
    check "second boot exits 0" eq "$BOOT_RC" 0
    check "second boot did not roll back again" eq "$(ident "$D/data.db")" newer
    check "the older backup is untouched" eq "$(ident "$D/data.db.pre-compact-20260101T000000Z")" older
}

# MUST FIX "sqlite_sequence": live sqlite_sequence rowids have a gap. The
# swap copies it without rowids, so it must check it without rowids too.
t_swap_sqlite_sequence_rowid_gap() {
    make_db "$D/data.db" live seqgap
    run_build || { bad "setup: build failed"; return; }
    run_swap PB_COMPACT_SWAP=1
    check "swap succeeded" grep_q "COMPACTION SWAPPED IN" "$T/swap.out"
    check "sqlite_sequence matches" eq "$(q "$D/data.db" "SELECT group_concat(name || '=' || seq, ',') FROM (SELECT * FROM sqlite_sequence ORDER BY name);")" \
        "$(q "$(first "$D"/data.db.pre-compact-*)" "SELECT group_concat(name || '=' || seq, ',') FROM (SELECT * FROM sqlite_sequence ORDER BY name);")"
}

# MUST FIX "NEW_DB-wal": during the swap's checks, a reader holds a read
# transaction on the new file and another process commits a row into the
# new file's WAL, so that WAL cannot be folded in. The swap must stop and
# must not delete that WAL. The fake /proc does not list the reader, so this
# is the checkpoint's guard, not the open-file check's.
t_swap_new_wal_not_discarded() {
    setup_built || { bad "setup"; return; }
    cat >"$T/hook.sh" <<EOF
mkfifo "$T/fifo"
"$TEST_REAL_SQLITE" "$D/compact/data.db.new" <"$T/fifo" >"$T/holder.out" 2>&1 &
echo \$! >"$T/holder.pid"
( printf 'BEGIN;\nSELECT count(*) FROM sqlite_schema;\n'; exec sleep 300 ) >"$T/fifo" &
echo \$! >"$T/keeper.pid"
i=0
while [ ! -s "$T/holder.out" ] && [ \$i -lt 100 ]; do sleep 0.1; i=\$((i + 1)); done
"$TEST_REAL_SQLITE" "$D/compact/data.db.new" ".dbconfig no_ckpt_on_close on" "PRAGMA wal_autocheckpoint = 0;" "INSERT INTO kv VALUES ('late', 'x');"
EOF
    run_swap PB_COMPACT_SWAP=1 SQ_HOOK_MATCH="data.db.new SELECT 'page_size='" SQ_HOOK_DONE="$T/hook.done" SQ_HOOK_CMD="sh $T/hook.sh"
    # The reader answered its SELECT inside BEGIN, so it held a read
    # transaction while the swap ran; it is killed only now.
    check "the reader answered its SELECT inside the transaction" is_number "$(head -1 "$T/holder.out" 2>/dev/null)"
    kill -9 "$(cat "$T/holder.pid" 2>/dev/null)" "$(cat "$T/keeper.pid" 2>/dev/null)" 2>/dev/null
    check "the swap stopped at the new file's checkpoint" grep_q "the new file's WAL could not be folded in; not swapping" "$T/swap.out"
    check "no swap happened" absent "$(first "$D"/data.db.pre-compact-*)"
    check "the new file's WAL was not deleted" present "$D/compact/data.db.new-wal"
    check "data.db holds the writes made after the build" eq "$(has_after_rows "$D/data.db")" 1
    check "data.db integrity ok" eq "$(q "$D/data.db" "PRAGMA integrity_check;")" ok
}

# A bad PB_COMPACT_CUTOVER_CHECK is refused before any work, and does not
# burn the manifest.
t_swap_bad_check_setting_keeps_manifest() {
    setup_built || { bad "setup"; return; }
    run_swap PB_COMPACT_SWAP=1 PB_COMPACT_CUTOVER_CHECK=bogus
    check "swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
    check "manifest kept for a corrected retry" present "$D/compact/manifest"
}

# ---- tests: build ----------------------------------------------------------------

# MUST FIX "sqlite_sequence": the build wrote two rows for an AUTOINCREMENT
# table that sorts before sqlite_sequence.
t_build_sqlite_sequence_no_duplicates() {
    make_db "$D/data.db" live
    run_build
    check "build succeeded" present "$D/compact/manifest"
    check "one sqlite_sequence row per table" eq "$(q "$D/compact/data.db.new" "SELECT count(*) || '/' || count(DISTINCT name) FROM sqlite_sequence;")" "2/2"
    check "manifest row count matches" grep_q '^table\.sqlite_sequence\.rows=2$' "$D/compact/manifest"
}

# MUST FIX "free space": free space drops below the floor after the
# precheck. The build must stop before the volume fills, with no manifest.
t_build_low_free_space_aborts() {
    make_db "$D/data.db" live
    printf '1 999999999\n999999999 100\n' >"$T/df"
    run_build FAKE_DF_FILE="$T/df"
    check "no manifest" absent "$D/compact/manifest"
    check "partial new file removed" absent "$D/compact/data.db.new"
    check "live database untouched" eq "$(q "$D/data.db" "SELECT count(*) FROM status_history;")" "$ROWS"
}

# MUST FIX "locking": a lock taken a moment ago whose holder has not
# written its pid yet must not be taken over.
t_build_lock_without_pid_not_taken_over() {
    make_db "$D/data.db" live
    mkdir -p "$D/compact/build.lock"
    run_build
    check "second build refused" absent "$D/compact/manifest"
    check "refusal logged" grep_q "another build" "$T/build.out"
}

# MUST FIX "locking": two builds started together; exactly one runs.
t_build_concurrent_one_runs() {
    make_db "$D/data.db" live
    env PB_DATA_DIR="$D" PB_COMPACT_OUT_DIR="$D/compact" PB_COMPACT_CHUNK_ROWS=100 PB_COMPACT_PAUSE_S=0.2 PB_COMPACT_MIN_FREE_MB=1 \
        PB_COMPACT_HEADROOM_MB=1 "$TSH" "$SCRIPTS/compact-build.sh" >"$T/a.out" 2>&1 &
    _a=$!
    sleep 1
    run_build
    _brc=$?
    wait "$_a"
    _arc=$?
    check "second build refused" ne "$_brc" 0
    check "refusal says another build is running" grep_q "another build or push is running" "$T/build.out"
    check "first build finished" eq "$_arc" 0
    check "manifest present" present "$D/compact/manifest"
    check "new file integrity ok" eq "$(q "$D/compact/data.db.new" "PRAGMA integrity_check;")" ok
}

# A lock left by a build that died is taken over (regression guard, new
# lock format: a symlink to the holder's pid).
t_build_stale_lock_taken_over() {
    make_db "$D/data.db" live
    mkdir -p "$D/compact"
    sh -c 'exit 0' &
    _dead=$!
    wait "$_dead"
    ln -s "$_dead" "$D/compact/build.lock"
    run_build
    check "build succeeded" present "$D/compact/manifest"
    check "lock released" absent "$D/compact/build.lock"
}

# MUST FIX "manifest": data.db.new is flushed before the manifest that
# points at it is published.
t_build_syncs_before_manifest() {
    make_db "$D/data.db" live
    run_build SYNC_LOG="$T/sync.log" SYNC_WATCH="$D/compact/manifest"
    check "build succeeded" present "$D/compact/manifest"
    check "sync ran before the manifest existed" grep_q "sync manifest=0" "${T}/sync.log"
}

# MUST FIX "check_order": the retention hook deletes every row below the cut
# between the cut search and the order check.
t_build_check_order_with_concurrent_delete() {
    make_db "$D/data.db" live
    cat >"$T/hook.sh" <<EOF
"$TEST_REAL_SQLITE" "$D/data.db" "DELETE FROM status_history WHERE created < strftime('%Y-%m-%d %H:%M:%f', 'now', '-30 days') || 'Z';"
EOF
    run_build SQ_HOOK_MATCH='SELECT rowid FROM "status_history" ORDER BY rowid LIMIT 1;' SQ_HOOK_DONE="$T/hook.done" SQ_HOOK_CMD="sh $T/hook.sh"
    check "the delete ran" present "$T/hook.done"
    check "build succeeded" present "$D/compact/manifest"
}

# MUST FIX "settings": a malformed PB_COMPACT_PAUSE_S stops the build at
# startup, before it creates anything.
t_build_bad_pause_rejected_at_start() {
    make_db "$D/data.db" live
    run_build PB_COMPACT_PAUSE_S=1.2.3
    check "build failed" absent "$D/compact/manifest"
    check "no new file was started" absent "$D/compact/data.db.new"
    check "no new database was started" eq "$(grep -c 'new database created' "$T/build.out")" 0
}

# Other numeric settings are checked the same way.
t_build_bad_numbers_rejected_at_start() {
    make_db "$D/data.db" live
    for _kv in PB_COMPACT_CHUNK_ROWS=0100 PB_COMPACT_MIN_FREE_MB=1e3 PB_RETENTION_STATUS_HISTORY_DAYS=08 PB_COMPACT_PAUSE_S=.; do
        : >"$T/build.out"
        run_build "$_kv"
        _rc=$?
        check "$_kv refused" ne "$_rc" 0
        check "$_kv refused before the copy" eq "$(grep -c 'new database created' "$T/build.out")" 0
    done
}

# ---- tests: a crash of compact-swap.sh does not block the boot ----------------

# A copy of the scripts whose library ends the script with exit 7 when it
# is read: a crash of compact-swap.sh that is not "data.db is missing".
broken_scripts() {
    mkdir -p "$T/scripts"
    cp "$SCRIPTS"/*.sh "$T/scripts/"
    echo 'exit 7' >"$T/scripts/compact-lib.sh"
    BOOT_SCRIPTS="$T/scripts"
}

# 1 when FILE is the live file from before any swap: it still has every row
# of status_history, including the ones below the cut.
is_pre_swap_live() {
    q "$1" "SELECT (SELECT count(*) FROM status_history) = $ROWS + 1;"
}

# No -wal or -shm without its main file next to it, in pb_data or compact.
no_orphan_sidecars() {
    for _p in "$D"/*-wal "$D"/*-shm "$D"/compact/*-wal "$D"/compact/*-shm; do
        [ -e "$_p" ] || continue
        _m=${_p%-wal}
        _m=${_m%-shm}
        [ -e "$_m" ] || { echo "      $_p is left without $_m"; return 1; }
    done
}

# No flag and no interrupted swap: the script exits 0 before it reads its
# library, so nothing in it can block an ordinary boot.
t_no_flag_exits_before_library() {
    make_db "$D/data.db" live
    broken_scripts
    boot
    check "boot exits 0" eq "$BOOT_RC" 0
    check "pocketbase started" eq "$PB_STARTED" 1
    check "no crash reported" no_grep "CRASHED" "$T/boot.out"
    check "nothing was created in pb_data" absent "$D/compact"
}

# compact-swap.sh crashes during a swap boot. data.db is intact and no
# rename was in progress, so PocketBase starts on it, with a loud log.
t_crash_boots_on_intact_db() {
    setup_built || { bad "setup"; return; }
    broken_scripts
    boot PB_COMPACT_SWAP=1
    check "boot exits 0" eq "$BOOT_RC" 0
    check "pocketbase started" eq "$PB_STARTED" 1
    check "the crash is logged with its exit code" grep_q "compact-swap.sh CRASHED (exit 7)" "$T/boot.out"
    check "data.db is the live file, untouched" eq "$(is_pre_swap_live "$D/data.db")" 1
    check "the manifest is untouched" present "$D/compact/manifest"
}

# A crash while a rename may be in progress (the marker exists) stops the
# boot: the -wal next to data.db might not be its own.
t_crash_with_marker_refuses_boot() {
    make_db "$D/data.db" live
    mkdir -p "$D/compact"
    printf 'swap\n%s\n%s\n' "$D/data.db.pre-compact-20260101T000000Z" "$D/compact/data.db.new" >"$D/compact/swap-in-progress"
    broken_scripts
    boot
    check "boot exits non-zero" ne "$BOOT_RC" 0
    check "pocketbase did not start" eq "$PB_STARTED" 0
    check "the refusal names the marker" grep_q "rename was in progress" "$T/boot.out"
}

# A crash with no data.db stops the boot.
t_crash_without_db_refuses_boot() {
    broken_scripts
    boot PB_COMPACT_SWAP=1
    check "boot exits non-zero" ne "$BOOT_RC" 0
    check "pocketbase did not start" eq "$PB_STARTED" 0
}

# "data.db is missing" has its own exit status, 3, so the entrypoint can
# tell it from a crash.
t_missing_db_exit_status_is_3() {
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    run_swap
    check "compact-swap.sh exits 3" eq "$SWAP_RC" 3
}

# ---- tests: the container dies between the steps of a swap or rollback -------

# Kill points, for both directions: just before the first rename (data.db
# moves out), just after it, just before the second (the incoming file moves
# in), just after it. The next boot must leave data.db the right file, with
# no -wal or -shm next to the wrong file or left alone.
swap_kill_boot() {
    setup_built || return 1
    boot PB_COMPACT_SWAP=1 KILL_LOG="$T/kill.log" "$@"
    check "the boot was killed at the rename" present "$T/kill.log"
    check "pocketbase did not start" eq "$PB_STARTED" 0
    check "the marker records the swap" present "$D/compact/swap-in-progress"
    : >"$T/boot.out"
    boot
    check "next boot exits 0" eq "$BOOT_RC" 0
    check "next boot starts pocketbase" eq "$PB_STARTED" 1
    check "marker removed" absent "$D/compact/swap-in-progress"
    check "no -wal or -shm without its file" no_orphan_sidecars
    check "data.db integrity ok" eq "$(q "$D/data.db" "PRAGMA integrity_check;")" ok
}

swap_undone_checks() {
    check "data.db is the live file from before the swap" eq "$(is_pre_swap_live "$D/data.db")" 1
    check "the swap is not reported complete" no_grep "is complete" "$T/boot.out"
    check "manifest burned" present "$(first "$D"/compact/manifest.failed-*)"
    check "no pre-compact file left" eq "$(count_db_files "$D"/data.db.pre-compact-*)" 0
}

t_swap_killed_before_first_rename() {
    swap_kill_boot MV_KILL_SRC="*/pb_data/data.db" || { bad "setup"; return; }
    swap_undone_checks
}

t_swap_killed_after_first_rename() {
    swap_kill_boot MV_KILL_AFTER_SRC="*/pb_data/data.db" || { bad "setup"; return; }
    check "the old file was put back" grep_q "restored .* to .*data.db; the swap did not happen" "$T/boot.out"
    swap_undone_checks
}

t_swap_killed_before_second_rename() {
    swap_kill_boot MV_KILL_SRC="*/compact/data.db.new" || { bad "setup"; return; }
    swap_undone_checks
}

t_swap_killed_after_second_rename() {
    swap_kill_boot MV_KILL_AFTER_SRC="*/compact/data.db.new" || { bad "setup"; return; }
    check "the swap is reported complete" grep_q "the swap is complete" "$T/boot.out"
    check "data.db is the compacted file" eq "$(is_pre_swap_live "$D/data.db")" 0
    check "by design, the writes made after the build are not in data.db" eq "$(has_after_rows "$D/data.db")" 0
    check "the old file is kept" eq "$(is_pre_swap_live "$(first "$D"/data.db.pre-compact-*)")" 1
    check "manifest marked done" present "$(first "$D"/compact/manifest.done-*)"
}

rollback_kill_boot() {
    make_db "$D/data.db" live
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    boot PB_COMPACT_ROLLBACK=1 KILL_LOG="$T/kill.log" "$@"
    check "the boot was killed at the rename" present "$T/kill.log"
    check "pocketbase did not start" eq "$PB_STARTED" 0
    check "the marker records the rollback" present "$D/compact/swap-in-progress"
    : >"$T/boot.out"
    boot
    check "next boot exits 0" eq "$BOOT_RC" 0
    check "next boot starts pocketbase" eq "$PB_STARTED" 1
    check "marker removed" absent "$D/compact/swap-in-progress"
    check "no -wal or -shm without its file" no_orphan_sidecars
    check "data.db integrity ok" eq "$(q "$D/data.db" "PRAGMA integrity_check;")" ok
}

rollback_undone_checks() {
    check "data.db is the live file" eq "$(ident "$D/data.db")" live
    check "the old file is still there" eq "$(ident "$D/data.db.pre-compact-20260101T000000Z")" old
    check "the rollback is not reported complete" no_grep "is complete" "$T/boot.out"
    check "rollback.done removed, so the rollback can run again" absent "$D/compact/rollback.done"
}

t_rollback_killed_before_first_rename() {
    rollback_kill_boot MV_KILL_SRC="*/pb_data/data.db"
    rollback_undone_checks
}

t_rollback_killed_after_first_rename() {
    rollback_kill_boot MV_KILL_AFTER_SRC="*/pb_data/data.db"
    rollback_undone_checks
}

t_rollback_killed_before_second_rename() {
    rollback_kill_boot MV_KILL_SRC="*/data.db.pre-compact-20260101T000000Z"
    rollback_undone_checks
}

t_rollback_killed_after_second_rename() {
    rollback_kill_boot MV_KILL_AFTER_SRC="*/data.db.pre-compact-20260101T000000Z"
    check "the rollback is reported complete" grep_q "the rollback is complete" "$T/boot.out"
    check "data.db is the old file" eq "$(ident "$D/data.db")" old
    check "the live file is kept as the rolled-back file" eq "$(ident "$(first "$D"/data.db.rolled-back-*)")" live
    check "rollback.done kept, so it does not run twice" present "$D/compact/rollback.done"
}

# State left by a death between deleting data.db's empty -wal/-shm and the
# end of an older script's multi-file move: data.db is gone, its empty -wal
# and a -shm are still there. They hold no data and must not block the
# restore.
t_recover_drops_empty_orphan_sidecars() {
    mkdir -p "$D/compact"
    make_db "$D/data.db.pre-compact-20260101T000000Z" live
    : >"$D/compact/data.db.new"
    : >"$D/data.db-wal"
    echo shm >"$D/data.db-shm"
    printf 'swap\n%s\n%s\n' "$D/data.db.pre-compact-20260101T000000Z" "$D/compact/data.db.new" >"$D/compact/swap-in-progress"
    boot
    check "boot exits 0" eq "$BOOT_RC" 0
    check "pocketbase started" eq "$PB_STARTED" 1
    check "data.db is the old file, put back" eq "$(ident "$D/data.db")" live
    check "marker removed" absent "$D/compact/swap-in-progress"
    check "no -wal or -shm without its file" no_orphan_sidecars
}

# The same, but the -wal next to the missing data.db holds data: it must not
# be paired with the file put back, nor deleted. The boot stops.
t_recover_keeps_wal_with_data() {
    mkdir -p "$D/compact"
    make_db "$D/data.db.pre-compact-20260101T000000Z" live
    : >"$D/compact/data.db.new"
    echo "frames" >"$D/data.db-wal"
    printf 'swap\n%s\n%s\n' "$D/data.db.pre-compact-20260101T000000Z" "$D/compact/data.db.new" >"$D/compact/swap-in-progress"
    run_swap
    check "compact-swap.sh exits 3" eq "$SWAP_RC" 3
    check "the -wal with data is kept" eq "$(cat "$D/data.db-wal")" frames
    check "the old file is not moved" eq "$(ident "$D/data.db.pre-compact-20260101T000000Z")" live
    check "marker kept" present "$D/compact/swap-in-progress"
}

# data.db exists but neither file the marker names does: data.db was never
# moved. That is not a completed swap and must not be logged as one.
t_recover_no_false_complete() {
    make_db "$D/data.db" live
    mkdir -p "$D/compact"
    echo "not a real manifest" >"$D/compact/manifest"
    printf 'swap\n%s\n%s\n' "$D/data.db.pre-compact-20260101T000000Z" "$D/compact/data.db.new" >"$D/compact/swap-in-progress"
    boot
    check "boot exits 0" eq "$BOOT_RC" 0
    check "data.db is unchanged" eq "$(ident "$D/data.db")" live
    check "not logged as complete" no_grep "is complete" "$T/boot.out"
    check "the manifest is burned, not marked done" present "$(first "$D"/compact/manifest.failed-*)"
    check "no manifest marked done" absent "$(first "$D"/compact/manifest.done-*)"
}

# The file put in by a rollback has rows only in its WAL. It is checkpointed
# before it is renamed, so the rows come along and no -wal is left behind.
t_rollback_checkpoints_incoming_wal() {
    make_db "$D/data.db" live
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    "$TEST_REAL_SQLITE" "$D/data.db.pre-compact-20260101T000000Z" ".dbconfig no_ckpt_on_close on" \
        "PRAGMA wal_autocheckpoint = 0;" "INSERT INTO kv VALUES ('wal-only', 'x');" >/dev/null
    check "setup: the row is only in the -wal" test -s "$D/data.db.pre-compact-20260101T000000Z-wal"
    boot PB_COMPACT_ROLLBACK=1
    check "boot exits 0" eq "$BOOT_RC" 0
    check "data.db is the old file" eq "$(ident "$D/data.db")" old
    check "the row from its -wal is there" eq "$(q "$D/data.db" "SELECT count(*) FROM kv WHERE k = 'wal-only';")" 1
    check "no -wal or -shm without its file" no_orphan_sidecars
}

manifest_value() {
    sed -n "s/^$1=//p" "$D/compact/manifest"
}

# ---- tests: checks that must not pass when they cannot look -------------------

# pidof is missing (the shell's 127): "no pocketbase process" is unknown.
t_swap_missing_pidof_refused() {
    setup_built || { bad "setup"; return; }
    run_swap PB_COMPACT_SWAP=1 PIDOF_RC=127
    check "swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
    check "the reason is logged" grep_q "cannot check for a running pocketbase process (pidof exited 127" "$T/swap.out"
    check "data.db holds the writes made after the build" eq "$(has_after_rows "$D/data.db")" 1
}

t_rollback_missing_pidof_refused() {
    make_db "$D/data.db" live
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    boot PB_COMPACT_ROLLBACK=1 PIDOF_RC=127
    check "boot exits 0" eq "$BOOT_RC" 0
    check "data.db is the live file" eq "$(ident "$D/data.db")" live
    check "rollback reported as not done" grep_q "rollback NOT done: the database is in use" "$T/boot.out"
}

# No /proc: nobody can be seen holding the file, which is not "nobody holds it".
t_swap_missing_proc_refused() {
    setup_built || { bad "setup"; return; }
    run_swap PB_COMPACT_SWAP=1 PB_COMPACT_PROC_DIR="$T/no-proc"
    check "swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
    check "the reason is logged" grep_q "cannot check which processes have the database open: $T/no-proc does not exist" "$T/swap.out"
}

# /proc is there but no open file can be read in it (no permission).
t_swap_unreadable_proc_refused() {
    setup_built || { bad "setup"; return; }
    mkdir -p "$T/empty-proc/7/fd"
    run_swap PB_COMPACT_SWAP=1 PB_COMPACT_PROC_DIR="$T/empty-proc"
    check "swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
    check "the reason is logged" grep_q "no open file could be read under" "$T/swap.out"
}

# Another process has the new file, its -wal or its -shm open: the swap
# deletes the -wal and -shm, so it must stop.
t_swap_new_file_holder_refused() {
    setup_built || { bad "setup"; return; }
    cp "$D/compact/manifest" "$T/manifest.keep"
    for _s in "" -wal -shm; do
        rm -rf "$T/proc/4242" "$D"/compact/manifest.failed-*
        cp "$T/manifest.keep" "$D/compact/manifest"
        : >"$T/swap.out"
        fake_open 4242 5 "$D/compact/data.db.new$_s"
        run_swap PB_COMPACT_SWAP=1
        check "data.db.new$_s held: swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
        check "data.db.new$_s held: the holder is named" grep_q "has the live or the new database open: 4242 $D/compact/data.db.new$_s" "$T/swap.out"
        check "data.db.new$_s held: the new file is still there" present "$D/compact/data.db.new"
    done
}

# ---- tests: unchecked command failures -------------------------------------------

# The class of a table is read once, in the inventory. A second read that
# failed used to be hidden inside a test and showed up much later as "no
# snapshot id".
t_build_classifies_once() {
    make_db "$D/data.db" live
    run_build SQ_FAIL_MATCH="SELECT updateRule IS NULL FROM _collections WHERE name = 'status_history'" \
        SQ_FAIL_SKIP=1 SQ_FAIL_COUNT="$T/class.n"
    check "build succeeded" present "$D/compact/manifest"
    check "status_history was classified once" eq "$(cat "$T/class.n")" 1
    check "the class of status_history is recorded" eq "$(manifest_value 'table\.status_history\.class')" append
}

# The list of SQLite's own tables cannot be read: the build must stop and
# say so, not go on without sqlite_stat1.
t_build_sqlite_tables_query_failure() {
    make_db "$D/data.db" live
    run_build SQ_FAIL_MATCH="type = 'table' AND name LIKE 'sqlite"
    check "no manifest" absent "$D/compact/manifest"
    check "the reason is logged" grep_q "could not list SQLite's own tables" "$T/build.out"
}

# ---- tests: build lock and manifest -----------------------------------------------

# A build fails after it published its manifest (here the last sync). The
# manifest goes with the new file.
t_build_failure_after_publish_removes_manifest() {
    make_db "$D/data.db" live
    run_build SYNC_FAIL_WATCH="$D/compact/manifest"
    _rc=$?
    check "build failed" ne "$_rc" 0
    check "the manifest was removed" absent "$D/compact/manifest"
    check "the new file was removed" absent "$D/compact/data.db.new"
    check "the log says the manifest was removed" grep_q "the manifest it had published was removed" "$T/build.out"
}

# A build killed while it took over a stale lock left build.lock.takeover
# (an older build made it a directory). It must not block later builds.
t_build_stale_takeover_dir_cleared() {
    make_db "$D/data.db" live
    mkdir -p "$D/compact/build.lock.takeover"
    touch -t 202601010000 "$D/compact/build.lock.takeover"
    sh -c 'exit 0' &
    _dead=$!
    wait "$_dead"
    ln -s "$_dead" "$D/compact/build.lock"
    run_build
    check "build succeeded" present "$D/compact/manifest"
    check "the stale takeover lock is logged" grep_q "clearing a stale takeover lock" "$T/build.out"
    check "takeover lock gone" absent "$D/compact/build.lock.takeover"
}

# The same, with a takeover lock that names a dead pid.
t_build_stale_takeover_link_cleared() {
    make_db "$D/data.db" live
    mkdir -p "$D/compact"
    sh -c 'exit 0' &
    _dead=$!
    wait "$_dead"
    ln -s "$_dead" "$D/compact/build.lock"
    ln -s "$_dead" "$D/compact/build.lock.takeover"
    run_build
    check "build succeeded" present "$D/compact/manifest"
    check "the stale takeover lock is logged" grep_q "clearing a stale takeover lock" "$T/build.out"
    check "takeover lock gone" absent "$D/compact/build.lock.takeover"
}

# A takeover lock made a moment ago may belong to a build that is taking
# over right now: it is not cleared.
t_build_fresh_takeover_dir_refused() {
    make_db "$D/data.db" live
    mkdir -p "$D/compact/build.lock.takeover"
    sh -c 'exit 0' &
    _dead=$!
    wait "$_dead"
    ln -s "$_dead" "$D/compact/build.lock"
    run_build
    check "build refused" absent "$D/compact/manifest"
    check "refusal logged" grep_q "it is taking over the lock" "$T/build.out"
}

# ---- tests: a cutover killed before its renames ---------------------------------

# The cutover is killed during its checks on every boot (a healthcheck that
# fires first). Each attempt is recorded; after PB_COMPACT_MAX_ATTEMPTS the
# manifest is moved aside and PocketBase starts on the old file.
# Run by the sqlite3 shim: $PPID there is the shim, the start of the kill.
# shellcheck disable=SC2016 # expanded by the hook, not here
KILL_HOOK='kill-boot $PPID'
t_cutover_killed_retries_bounded() {
    setup_built || { bad "setup"; return; }
    for _i in 1 2; do
        rm -f "$T/hook.done" "$T/kill.log"
        boot PB_COMPACT_SWAP=1 PB_COMPACT_MAX_ATTEMPTS=2 KILL_LOG="$T/kill.log" \
            SQ_HOOK_MATCH="data.db.new SELECT 'page_size='" SQ_HOOK_DONE="$T/hook.done" SQ_HOOK_CMD="$KILL_HOOK"
        check "boot $_i was killed during the cutover" present "$T/kill.log"
        check "boot $_i: pocketbase did not start" eq "$PB_STARTED" 0
        check "boot $_i: attempt logged" grep_q "cutover attempt $_i of 2" "$T/boot.out"
        check "boot $_i: attempt recorded" eq "$(cut -d' ' -f2 "$D/compact/cutover-attempts" 2>/dev/null)" "$_i"
        check "boot $_i: the manifest is kept" present "$D/compact/manifest"
    done
    check "boot 2 says the earlier attempt did not finish" grep_q "started 1 time(s) before and did not finish" "$T/boot.out"
    rm -f "$T/hook.done" "$T/kill.log"
    boot PB_COMPACT_SWAP=1 PB_COMPACT_MAX_ATTEMPTS=2 KILL_LOG="$T/kill.log" \
        SQ_HOOK_MATCH="data.db.new SELECT 'page_size='" SQ_HOOK_DONE="$T/hook.done" SQ_HOOK_CMD="$KILL_HOOK"
    check "boot 3 was not killed: no cutover ran" absent "$T/kill.log"
    check "boot 3 exits 0" eq "$BOOT_RC" 0
    check "boot 3 starts pocketbase" eq "$PB_STARTED" 1
    check "boot 3 says why it did not try" grep_q "COMPACTION CUTOVER NOT TRIED: 2 earlier boots" "$T/boot.out"
    check "the manifest is moved aside" present "$(first "$D"/compact/manifest.failed-*)"
    check "the attempt record is removed" absent "$D/compact/cutover-attempts"
    check "data.db is the live file, untouched" eq "$(is_pre_swap_live "$D/data.db")" 1
}

# ---- tests: round 3 ----------------------------------------------------------------

# The retention window was made longer after the build. The build dropped
# rows that the longer window keeps; they exist only in the live file, so
# the swap must refuse, name the cause and leave data.db as it is.
t_swap_longer_window_refused() {
    setup_built || { bad "setup"; return; }
    check "the manifest records the cutoff of status_history" is_set "$(manifest_value 'table\.status_history\.cutoff')"
    check "the manifest records the window of probe_runs" eq "$(manifest_value 'table\.probe_runs\.window_days')" 30
    for _v in PB_RETENTION_STATUS_HISTORY_DAYS PB_RETENTION_PROBE_RUNS_DAYS; do
        rm -f "$D"/compact/manifest.failed-*
        : >"$T/swap.out"
        cp "$D/compact/manifest" "$T/manifest.keep"
        run_swap PB_COMPACT_SWAP=1 "$_v=45"
        check "$_v=45: swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
        check "$_v=45: the reason is logged" grep_q "$_v is 45 now, but the build kept only 30 days" "$T/swap.out"
        check "$_v=45: data.db is the live file, untouched" eq "$(is_pre_swap_live "$D/data.db")" 1
        cp "$T/manifest.keep" "$D/compact/manifest"
    done
}

# A shorter window is fine: the build kept more than the window needs.
t_swap_shorter_window_allowed() {
    setup_built || { bad "setup"; return; }
    run_swap PB_COMPACT_SWAP=1 PB_RETENTION_PROBE_RUNS_DAYS=20
    check "swap succeeded" grep_q "COMPACTION SWAPPED IN" "$T/swap.out"
}

# The first rename leaves both paths (its result is unclear). Recovery finds
# data.db in place and leaves it; the boot must not then claim data.db is
# missing and stop.
t_cutover_unclear_rename_recovered_boots() {
    setup_built || { bad "setup"; return; }
    boot PB_COMPACT_SWAP=1 MV_COPY_SRC="$D/data.db"
    check "boot exits 0" eq "$BOOT_RC" 0
    check "pocketbase started" eq "$PB_STARTED" 1
    check "data.db is the live file with every row" eq "$(has_after_rows "$D/data.db")" 1
    check "no false 'missing' message" no_grep "is missing. PocketBase must not start" "$T/boot.out"
    check "the unclear rename is reported" grep_q "unclear result" "$T/boot.out"
    check "the manifest is burned" present "$(first "$D"/compact/manifest.failed-*)"
}

# Runs the build in the background and kills it after $1 seconds. Returns
# the build's exit status, or 124 when it was killed.
run_build_bounded() {
    _secs=$1
    shift
    env PB_DATA_DIR="$D" PB_COMPACT_OUT_DIR="$D/compact" PB_COMPACT_CHUNK_ROWS=100 PB_COMPACT_PAUSE_S=0 PB_COMPACT_MIN_FREE_MB=1 \
        PB_COMPACT_HEADROOM_MB=1 "$@" "$TSH" "$SCRIPTS/compact-build.sh" >>"$T/build.out" 2>&1 &
    _bpid=$!
    _i=0
    while kill -0 "$_bpid" 2>/dev/null; do
        if [ "$_i" -ge "$_secs" ]; then
            kill -9 "$_bpid" 2>/dev/null
            wait "$_bpid" 2>/dev/null
            return 124
        fi
        sleep 1
        _i=$((_i + 1))
    done
    wait "$_bpid"
}

# A table with a few rows far apart in rowid (here one near the top of the
# 64-bit range). The copy must skip the empty ranges, not walk them in
# PB_COMPACT_CHUNK_ROWS steps (forever), and must not overflow.
t_build_sparse_rowids_finish() {
    make_db "$D/data.db" live
    "$TEST_REAL_SQLITE" "$D/data.db" "INSERT INTO users (rowid, id, email) VALUES (9223372036854775000, 'u-far', 'far@example.com');"
    run_build_bounded 60
    _rc=$?
    check "build finished in time and succeeded" eq "$_rc" 0
    check "manifest written" present "$D/compact/manifest"
    check "the far row was copied" eq "$(q "$D/compact/data.db.new" "SELECT rowid FROM users WHERE id = 'u-far';")" 9223372036854775000
}

# The swap's most severe messages go to stderr, where log pipelines look for
# errors.
t_swap_loud_goes_to_stderr() {
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    env PB_DATA_DIR="$D" PB_COMPACT_PROC_DIR="$T/proc" "$TSH" "$SCRIPTS/compact-swap.sh" >"$T/swap.stdout" 2>"$T/swap.stderr"
    check "the message is on stderr" grep_q "PocketBase must not start" "$T/swap.stderr"
    check "and not on stdout" no_grep "PocketBase must not start" "$T/swap.stdout"
}

# Runs a copy of entrypoint.sh that keeps its /pb_data default; the data
# directory comes from PB_DATA_DIR only. Sets BOOT_RC and PB_STARTED.
boot_data_dir_env() {
    sed -e "s|/usr/local/lib/pb-compact/compact-swap.sh|$TSH ${BOOT_SCRIPTS:-$SCRIPTS}/compact-swap.sh|" \
        -e "s|/usr/local/bin/pocketbase|$SHIM/fake-pocketbase|g" "$ENTRYPOINT" >"$T/entrypoint.sh"
    rm -f "$T/pb.log"
    env PB_DATA_DIR="$D" PB_COMPACT_PROC_DIR="$T/proc" PB_STARTED_LOG="$T/pb.log" "$@" \
        "$TSH" "$T/entrypoint.sh" serve >>"$T/boot.out" 2>&1
    BOOT_RC=$?
    PB_STARTED=0
    [ -s "$T/pb.log" ] && PB_STARTED=1
    return 0
}

# PB_DATA_DIR moves the data directory. The entrypoint must judge a crash of
# compact-swap.sh by the files there, as the swap does: data.db in place and
# no marker starts PocketBase; a marker stops the boot.
t_entrypoint_honours_data_dir() {
    setup_built || { bad "setup"; return; }
    broken_scripts
    boot_data_dir_env PB_COMPACT_SWAP=1
    check "intact data.db: boot exits 0" eq "$BOOT_RC" 0
    check "intact data.db: pocketbase started" eq "$PB_STARTED" 1
    printf 'swap\n%s\n%s\n' "$D/data.db.pre-compact-20260101T000000Z" "$D/compact/data.db.new" >"$D/compact/swap-in-progress"
    boot_data_dir_env
    check "marker: boot exits non-zero" ne "$BOOT_RC" 0
    check "marker: pocketbase did not start" eq "$PB_STARTED" 0
    check "marker: the refusal names the marker under PB_DATA_DIR" grep_q "$D/compact/swap-in-progress" "$T/boot.out"
}

# A failed build cannot remove its partial new file: the log must say so,
# not claim it was removed.
t_build_cleanup_reports_what_is_left() {
    make_db "$D/data.db" live
    run_build SYNC_FAIL_WATCH="$D/compact/manifest" RM_FAIL_MATCH="*/compact/data.db.new" \
        RM_FAIL_SKIP=1 RM_FAIL_COUNT="$T/rm.n"
    check "build failed" ne "$?" 0
    check "setup: the new file is still there" present "$D/compact/data.db.new"
    check "the log does not claim it was removed" no_grep "partial new file was removed" "$T/build.out"
    check "the log names what is left" grep_q "could NOT be removed.*data.db.new" "$T/build.out"
    check "the lock is released" no_path "$D/compact/build.lock"
}

# A log line fails (here stdout is closed; a full volume does the same).
# The cleanup must still run to the end and release the lock.
t_build_cleanup_survives_log_failure() {
    make_db "$D/data.db" live
    env PB_DATA_DIR="$D" PB_COMPACT_OUT_DIR="$D/compact" PB_COMPACT_CHUNK_ROWS=100 PB_COMPACT_PAUSE_S=0 PB_COMPACT_MIN_FREE_MB=1 \
        PB_COMPACT_HEADROOM_MB=1 "$TSH" "$SCRIPTS/compact-build.sh" 2>>"$T/build.out" >&-
    check "build failed" ne "$?" 0
    check "the lock is released" no_path "$D/compact/build.lock"
    check "no manifest" absent "$D/compact/manifest"
}

# ---- tests: off-box build and push ---------------------------------------------
# The "box" is $D (the live database and its compact directory); the off-box
# build works in $T/off. fake-remote runs the box commands on this host.

run_remote_build() {
    mkdir -p "$T/off"
    env PB_DATA_DIR="$T/off" PB_COMPACT_REMOTE=fake-remote PB_COMPACT_REMOTE_DB="$D/data.db" \
        PB_COMPACT_CHUNK_ROWS=100 PB_COMPACT_SEGMENT_ROWS=250 PB_COMPACT_PAUSE_S=0 PB_COMPACT_MIN_FREE_MB=1 \
        PB_COMPACT_HEADROOM_MB=1 "$@" "$TSH" "$SCRIPTS/compact-build.sh" >>"$T/build.out" 2>&1
}

run_push() {
    env PB_DATA_DIR="$T/off" PB_COMPACT_REMOTE=fake-remote PB_COMPACT_REMOTE_DB="$D/data.db" \
        PB_COMPACT_REMOTE_TMP="$T/boxtmp" PB_COMPACT_PIECE_MB=1 PB_COMPACT_BLOCK_MB=1 PB_COMPACT_WRITE_MBPS=1000 \
        PB_COMPACT_MIN_FREE_MB=1 "$@" "$TSH" "$SCRIPTS/compact-push.sh" >>"$T/push.out" 2>&1
}

# Every table of $1 and $2 holds the same rows at the same rowids, and the
# schema (without rootpage) is the same.
same_db() {
    _s="SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name;"
    [ "$(q "$1" "$_s")" = "$(q "$2" "$_s")" ] || { echo "      schema differs"; return 1; }
    for _t in $(q "$1" "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name;"); do
        if [ "$(q "$1" "SELECT wr FROM pragma_table_list('$_t') WHERE schema = 'main';")" = 1 ] || [ "$_t" = sqlite_sequence ]; then
            _sql="SELECT * FROM \"$_t\" ORDER BY 1;"
        else
            _sql="SELECT rowid, * FROM \"$_t\" ORDER BY rowid;"
        fi
        [ "$(q "$1" "$_sql")" = "$(q "$2" "$_sql")" ] || { echo "      $_t differs"; return 1; }
    done
}

# The manifest lines that do not depend on when or where the build ran (the
# cutoff times move with the clock; the cut rowids must not).
manifest_core() {
    grep -v -e '^built_at=' -e '^build_seconds=' -e '^snapshot_s=' -e '^sha256=' -e '^new_size=' -e '^new_sha256=' \
        -e '^new_fingerprint=' -e '\.cutoff_s=' -e '\.cutoff=' "$1"
}

# The off-box build makes the same file content and manifest as an on-box
# build of the same live database.
t_remote_build_matches_local() {
    make_db "$D/data.db" live
    run_build || { bad "setup: on-box build failed"; return; }
    run_remote_build
    check "off-box build exits 0" eq "$?" 0
    check "it wrote a manifest" present "$T/off/compact/manifest"
    check "it fetched more than one segment" eq "$(grep -c 'segment table=status_history' "$T/build.out")" 3
    check "same rows and schema as the on-box build" same_db "$T/off/compact/data.db.new" "$D/compact/data.db.new"
    check "same manifest, apart from times and size" eq "$(manifest_core "$T/off/compact/manifest")" "$(manifest_core "$D/compact/manifest")"
    check "integrity ok" eq "$(q "$T/off/compact/data.db.new" "PRAGMA integrity_check;")" ok
    check "the new file is in WAL mode" eq "$(q "$T/off/compact/data.db.new" "PRAGMA journal_mode;")" wal
    check "nothing was written next to the live file" eq "$(count_db_files "$D"/compact/segment*)" 0
}

# Off-box build, push, then the swap at boot: the swapped-in file is the
# build's file; the writes made after the build stay in the old file.
t_remote_build_push_swap() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    mutate_live
    run_push
    check "push exits 0" eq "$?" 0
    check "the new file is on the box" eq "$(cmp "$T/off/compact/data.db.new" "$D/compact/data.db.new" && echo same)" same
    check "the manifest is on the box" eq "$(cmp "$T/off/compact/manifest" "$D/compact/manifest" && echo same)" same
    check "no upload left behind" absent "$D/compact/data.db.new.upload"
    check "no piece left in the box's temp directory" eq "$(count_db_files "$T"/boxtmp/*)" 0
    cp "$D/compact/data.db.new" "$T/new-before-swap.db"
    boot PB_COMPACT_SWAP=1
    check "boot exits 0" eq "$BOOT_RC" 0
    check "swap logged success" grep_q "COMPACTION SWAPPED IN" "$T/boot.out"
    check "by design, the writes made after the build are not in data.db" eq "$(has_after_rows "$D/data.db")" 0
    check "data.db is the build's file, row for row" same_db "$D/data.db" "$T/new-before-swap.db"
    check "integrity ok" eq "$(q "$D/data.db" "PRAGMA integrity_check;")" ok
}

# A segment whose connection breaks part way is fetched again, and the rows
# end up the same.
t_remote_build_refetches_broken_segment() {
    make_db "$D/data.db" live
    run_build || { bad "setup: on-box build failed"; return; }
    run_remote_build FR_DROP_MATCH=compact-export FR_DROP_TIMES=2 FR_DROP_COUNT="$T/drop.n"
    check "off-box build exits 0" eq "$?" 0
    check "two segments broke off" eq "$(cat "$T/drop.n")" 2
    check "it said so and fetched them again" eq "$(grep -c 'did not arrive whole' "$T/build.out")" 2
    check "same rows as the on-box build" same_db "$T/off/compact/data.db.new" "$D/compact/data.db.new"
}

# Rows that arrive changed fail the hash check: no manifest, no new file.
t_remote_build_rejects_changed_rows() {
    make_db "$D/data.db" live
    run_remote_build FR_TAMPER_MATCH=compact-export FR_TAMPER_SED="s/'row 1400'/'row 14OO'/"
    check "off-box build fails" ne "$?" 0
    check "the hash check caught it" grep_q "do not hash the same" "$T/build.out"
    check "no manifest" absent "$T/off/compact/manifest"
    check "no new file" absent "$T/off/compact/data.db.new"
    check "no segment file left behind" eq "$(count_paths "$T"/off/compact/segment*)" 0
}

# A push that stops part way resumes: the pieces already on the box are not
# sent again, and the result is the same file.
t_push_resumes() {
    make_db "$D/data.db" live
    "$TEST_REAL_SQLITE" "$D/data.db" "CREATE TABLE pad (b BLOB); INSERT INTO pad VALUES (randomblob(1500000)), (randomblob(1500000));" >/dev/null
    run_remote_build || { bad "setup: off-box build failed"; return; }
    run_push FR_FAIL_MATCH="conv=notrunc,fsync" FR_FAIL_SKIP=1 FR_FAIL_COUNT="$T/fail.n"
    check "the first push fails" ne "$?" 0
    check "no manifest on the box" absent "$D/compact/manifest"
    check "no new file on the box" absent "$D/compact/data.db.new"
    check "the upload is kept" present "$D/compact/data.db.new.upload"
    run_push
    check "the second push exits 0" eq "$?" 0
    check "it skipped the piece already there" grep_q "1 of [0-9]* pieces already there" "$T/push.out"
    check "the new file is on the box" eq "$(cmp "$T/off/compact/data.db.new" "$D/compact/data.db.new" && echo same)" same
    check "the manifest is on the box" present "$D/compact/manifest"
    boot PB_COMPACT_SWAP=1
    check "swap logged success" grep_q "COMPACTION SWAPPED IN" "$T/boot.out"
}

# A connection lost while a piece is sent is tried again.
t_push_retries_lost_connection() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    run_push FR_DROP_MATCH="pb-compact-piece.0.gz" FR_DROP_TIMES=1 FR_DROP_COUNT="$T/drop.n"
    check "push exits 0" eq "$?" 0
    check "one send broke off" eq "$(cat "$T/drop.n")" 1
    check "the new file is on the box" eq "$(cmp "$T/off/compact/data.db.new" "$D/compact/data.db.new" && echo same)" same
}

# A build running on the box: the push changes nothing there.
t_push_refuses_running_build() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    mkdir -p "$D/compact"
    echo "older manifest" >"$D/compact/manifest"
    sleep 60 &
    echo $! >"$T/holder.pid"
    ln -s "$(cat "$T/holder.pid")" "$D/compact/build.lock"
    run_push
    check "push fails" ne "$?" 0
    check "it names the build" grep_q "another build or push runs on the box (held by $(cat "$T/holder.pid"))" "$T/push.out"
    check "the manifest on the box is untouched" eq "$(cat "$D/compact/manifest")" "older manifest"
    check "nothing was uploaded" absent "$D/compact/data.db.new.upload"
}

# The live schema changed after the build: the push refuses.
t_push_refuses_changed_schema() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    "$TEST_REAL_SQLITE" "$D/data.db" "CREATE TABLE added_later (x);" >/dev/null
    run_push
    check "push fails" ne "$?" 0
    check "it names the schema" grep_q "live schema changed since the build" "$T/push.out"
    check "nothing was uploaded" absent "$D/compact/data.db.new.upload"
}

# ---- tests: the cutover is a rename of the build's snapshot -----------------------
# The swap copies nothing into the new file. Rows written to the live file
# after the build snapshot are not in data.db afterwards, by design; they
# stay in data.db.pre-compact-*.

now_pb() {
    echo "strftime('%Y-%m-%d %H:%M:%f', 'now') || 'Z'"
}

# Inserts, updates and deletes after the build do not reach the swapped-in
# file: it is the build's file as it was, and nothing was copied.
t_swap_copies_nothing_after_snapshot() {
    make_db "$D/data.db" live
    run_build || { bad "setup: build failed"; return; }
    mutate_live
    "$TEST_REAL_SQLITE" "$D/data.db" >/dev/null <<SQL
UPDATE jobs SET status = 'done', updated = $(now_pb) WHERE id = 'j3';
INSERT INTO jobs (id, created, updated, status) VALUES ('j-new', $(now_pb), $(now_pb), 'queued');
SQL
    cp "$D/compact/data.db.new" "$T/new-before-swap.db"
    boot PB_COMPACT_SWAP=1
    check "swap logged success" grep_q "COMPACTION SWAPPED IN" "$T/boot.out"
    check "data.db is the build's file, row for row" same_db "$D/data.db" "$T/new-before-swap.db"
    check "a row inserted after the build is not there" eq "$(q "$D/data.db" "SELECT count(*) FROM jobs WHERE id = 'j-new';")" 0
    check "a row updated after the build has its snapshot value" eq "$(q "$D/data.db" "SELECT status FROM jobs WHERE id = 'j3';")" queued
    check "the writes made after the build are not there" eq "$(has_after_rows "$D/data.db")" 0
    check "they are in the old file" eq "$(has_after_rows "$(first "$D"/data.db.pre-compact-*)")" 1
    check "no delta SQL was written" absent "$D/compact/cutover.sql"
}

# The data.db.new in place is another build's file (an older build, here),
# paired with the newer build's manifest. The swap must refuse before it
# touches anything.
t_swap_refuses_another_builds_file() {
    make_db "$D/data.db" live
    run_build || { bad "setup: first build failed"; return; }
    cp "$D/compact/data.db.new" "$T/first.db"
    mutate_live
    run_build || { bad "setup: second build failed"; return; }
    cp "$T/first.db" "$D/compact/data.db.new"
    rm -f "$D/compact/data.db.new-wal" "$D/compact/data.db.new-shm"
    boot PB_COMPACT_SWAP=1
    check "boot exits 0" eq "$BOOT_RC" 0
    check "no swap" no_grep "COMPACTION SWAPPED IN" "$T/boot.out"
    check "the reason names the file" grep_q "it is not the file this manifest names" "$T/boot.out"
    check "data.db is the live file with every row" eq "$(has_after_rows "$D/data.db")" 1
    check "manifest burned" present "$(first "$D"/compact/manifest.failed-*)"
}

# The same size, different bytes: the size check alone would pass.
t_swap_refuses_same_size_other_bytes() {
    setup_built || { bad "setup"; return; }
    _size=$(wc -c <"$D/compact/data.db.new")
    # Header bytes 96-99 hold the SQLite version that wrote the file; the
    # file still opens with any value there.
    printf '\001\002\003\004' | dd of="$D/compact/data.db.new" bs=1 seek=96 conv=notrunc 2>/dev/null
    check "setup: same size" eq "$(wc -c <"$D/compact/data.db.new")" "$_size"
    check "setup: still a database" eq "$(q "$D/compact/data.db.new" "SELECT count(*) > 0 FROM users;")" 1
    rm -f "$D/compact/data.db.new-wal" "$D/compact/data.db.new-shm"
    boot PB_COMPACT_SWAP=1
    check "no swap" no_grep "COMPACTION SWAPPED IN" "$T/boot.out"
    check "the fingerprint check named it" grep_q "has fingerprint .* it is not the file this manifest names" "$T/boot.out"
    check "data.db is the live file with every row" eq "$(has_after_rows "$D/data.db")" 1
}

# The build records the file's identity for the swap, on the box too.
t_build_records_identity() {
    make_db "$D/data.db" live
    run_build || { bad "setup: build failed"; return; }
    check "new_sha256 is the file's sha256" eq "$(manifest_value new_sha256)" "$(sha256sum <"$D/compact/data.db.new" | cut -d' ' -f1)"
    check "new_fingerprint is recorded" is_set "$(manifest_value new_fingerprint)"
}

# sha256sum missing: say so, not "checksum mismatch".
t_swap_missing_sha256sum_named() {
    setup_built || { bad "setup"; return; }
    run_swap PB_COMPACT_SWAP=1 NO_SHA256SUM=1
    check "swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
    check "the missing tool is named" grep_q "sha256sum is not installed" "$T/swap.out"
}

# The live schema changed after the build: the difference goes to stderr,
# where log pipelines look, not stdout.
t_swap_schema_diff_on_stderr() {
    setup_built || { bad "setup"; return; }
    "$TEST_REAL_SQLITE" "$D/data.db" "CREATE TABLE added_later (x);" >/dev/null
    env PB_DATA_DIR="$D" PB_COMPACT_PROC_DIR="$T/proc" PB_COMPACT_SWAP=1 "$TSH" "$SCRIPTS/compact-swap.sh" >"$T/swap.stdout" 2>"$T/swap.stderr"
    check "swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
    check "the diff is on stderr" grep_q "added_later" "$T/swap.stderr"
    check "and not on stdout" no_grep "added_later" "$T/swap.stdout"
}

# The schema listing for that diff fails: say so.
t_swap_schema_list_failure_reported() {
    setup_built || { bad "setup"; return; }
    "$TEST_REAL_SQLITE" "$D/data.db" "CREATE TABLE added_later (x);" >/dev/null
    run_swap PB_COMPACT_SWAP=1 SQ_FAIL_MATCH="ORDER BY type, name;"
    check "swap did not happen" absent "$(first "$D"/data.db.pre-compact-*)"
    check "the failed listing is reported" grep_q "could not list the schemas" "$T/swap.out"
}

# PB_COMPACT_REMOTE left in the service env does not reach the swap.
t_swap_ignores_inherited_remote() {
    setup_built || { bad "setup"; return; }
    run_swap PB_COMPACT_SWAP=1 PB_COMPACT_REMOTE=false PB_COMPACT_REMOTE_DB=/nonexistent/data.db
    check "swap succeeded" grep_q "COMPACTION SWAPPED IN" "$T/swap.out"
}

# A rollback whose outcome is unknown (all three files exist) is not left
# recorded as done.
t_recover_unknown_rollback_clears_done() {
    make_db "$D/data.db" live
    make_db "$D/data.db.rolled-back-20260101T000000Z" rolled
    make_db "$D/data.db.pre-compact-20260101T000000Z" old
    mkdir -p "$D/compact"
    echo "rolled back at 20260101T000000Z" >"$D/compact/rollback.done"
    printf 'rollback\n%s\n%s\n' "$D/data.db.rolled-back-20260101T000000Z" "$D/data.db.pre-compact-20260101T000000Z" >"$D/compact/swap-in-progress"
    boot
    check "boot exits 0" eq "$BOOT_RC" 0
    check "data.db is unchanged" eq "$(ident "$D/data.db")" live
    check "rollback.done removed" absent "$D/compact/rollback.done"
    check "the log says why" grep_q "rollback's outcome is unknown" "$T/boot.out"
}

# A data directory whose path has ', #, ? and %: the read-only ATTACH of the
# live file must open that file.
t_build_odd_data_dir() {
    _odd="$T/pb'da#ta?x%41"
    mkdir -p "$_odd"
    make_db "$_odd/data.db" live
    env PB_DATA_DIR="$_odd" PB_COMPACT_OUT_DIR="$_odd/compact" PB_COMPACT_CHUNK_ROWS=100 PB_COMPACT_PAUSE_S=0 \
        PB_COMPACT_MIN_FREE_MB=1 PB_COMPACT_HEADROOM_MB=1 "$TSH" "$SCRIPTS/compact-build.sh" >>"$T/build.out" 2>&1
    check "build exits 0" eq "$?" 0
    check "manifest written" present "$_odd/compact/manifest"
    check "the rows came from the live file" eq "$(q "$_odd/compact/data.db.new" "SELECT v FROM kv WHERE k = 'identity';")" live
}

# A push token in build.lock holds off a build.
t_build_respects_push_lock() {
    make_db "$D/data.db" live
    mkdir -p "$D/compact"
    ln -s "push.$(($(date +%s) + 600)).other" "$D/compact/build.lock"
    run_build
    check "build refused" ne "$?" 0
    check "it names the push" grep_q "another build or push is running (lock holder push\\." "$T/build.out"
    check "no manifest" absent "$D/compact/manifest"
}

# ---- tests: the build in /tmp and the copy onto the volume -------------------------

# The default target: the build writes in PB_COMPACT_OUT_DIR, then copies the
# file onto the volume, where the swap finds it.
t_build_tmp_out_dir_lands() {
    make_db "$D/data.db" live
    run_build PB_COMPACT_OUT_DIR="$T/tmpbuild"
    check "build exits 0" eq "$?" 0
    check "it says it copied onto the volume" grep_q "copied onto the volume in" "$T/build.out"
    check "the manifest is on the volume" present "$D/compact/manifest"
    check "the new file is on the volume" present "$D/compact/data.db.new"
    check "it is the file the manifest names" eq "$(sha256sum <"$D/compact/data.db.new" | cut -d' ' -f1)" "$(manifest_value new_sha256)"
    check "the /tmp copy is removed" absent "$T/tmpbuild/data.db.new"
    check "the lock is released" no_path "$D/compact/build.lock"
    boot PB_COMPACT_SWAP=1
    check "swap logged success" grep_q "COMPACTION SWAPPED IN" "$T/boot.out"
    check "integrity ok" eq "$(q "$D/data.db" "PRAGMA integrity_check;")" ok
}

# The copy onto the volume fails: the finished build is kept in /tmp, and
# compact-push.sh copies it later.
t_build_tmp_land_failure_keeps_build() {
    make_db "$D/data.db" live
    run_build PB_COMPACT_OUT_DIR="$T/tmpbuild" PB_COMPACT_PIECE_MB=3
    check "build fails" ne "$?" 0
    check "it says the copy failed" grep_q "copying it onto the volume failed" "$T/build.out"
    check "the built file is kept" present "$T/tmpbuild/data.db.new"
    check "no manifest on the volume" absent "$D/compact/manifest"
    check "the lock is released" no_path "$D/compact/build.lock"
    env PB_DATA_DIR="$D" PB_COMPACT_OUT_DIR="$T/tmpbuild" PB_COMPACT_MIN_FREE_MB=1 PB_COMPACT_WRITE_MBPS=1000 \
        "$TSH" "$SCRIPTS/compact-push.sh" >>"$T/push.out" 2>&1
    check "compact-push.sh copies it" eq "$?" 0
    check "the manifest is on the volume" present "$D/compact/manifest"
    check "the lock is released" no_path "$D/compact/build.lock"
}

# ---- tests: the push's write steps and lock ------------------------------------------
# fake-remote's FR_DROP_MATCH runs the command to the end and then reports a
# lost connection (exit 255): the step was done, the push did not hear so.

# The manifest was published, then the connection dropped: the push reads the
# state, sees it published, and succeeds.
t_push_publish_drop_reads_state() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    run_push FR_DROP_MATCH="echo published" FR_DROP_COUNT="$T/drop.n"
    check "push exits 0" eq "$?" 0
    check "the publish dropped once" eq "$(cat "$T/drop.n")" 1
    check "it read the state" grep_q "done on the box all the same" "$T/push.out"
    check "the manifest is on the box" eq "$(cmp "$T/off/compact/manifest" "$D/compact/manifest" && echo same)" same
    check "no temp manifest left" absent "$D/compact/manifest.tmp"
}

# The file was put in place, then the connection dropped.
t_push_place_drop_reads_state() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    run_push FR_DROP_MATCH="echo placed" FR_DROP_COUNT="$T/drop.n"
    check "push exits 0" eq "$?" 0
    check "the new file is on the box" eq "$(cmp "$T/off/compact/data.db.new" "$D/compact/data.db.new" && echo same)" same
    check "the manifest is on the box" present "$D/compact/manifest"
}

# A piece was written, then the connection dropped.
t_push_piece_write_drop_reads_state() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    run_push FR_DROP_MATCH="conv=notrunc,fsync" FR_DROP_COUNT="$T/drop.n"
    check "push exits 0" eq "$?" 0
    check "the write dropped once" eq "$(cat "$T/drop.n")" 1
    check "the new file is on the box" eq "$(cmp "$T/off/compact/data.db.new" "$D/compact/data.db.new" && echo same)" same
}

# The push holds build.lock while it writes, and lets it go at the end.
t_push_holds_lock() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    run_push FR_SNOOP_MATCH="conv=notrunc,fsync" FR_SNOOP_LINK="$D/compact/build.lock" FR_SNOOP_OUT="$T/snoop"
    check "push exits 0" eq "$?" 0
    check "the lock was a push token while it wrote" grep_q "^push\\.[0-9]*\\." "$T/snoop"
    check "the lock is released" no_path "$D/compact/build.lock"
}

# build.lock names a pid that is alive but a zombie (PocketBase, PID 1, does
# not reap), or a pid reused by something else: neither holds the lock.
push_with_stale_pid_lock() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return 1; }
    sleep 60 &
    echo $! >"$T/holder.pid"
    _p=$(cat "$T/holder.pid")
    mkdir -p "$T/proc/$_p" "$D/compact"
    printf 'Name:\tsh\nState:\t%s\n' "$1" >"$T/proc/$_p/status"
    # shellcheck disable=SC2086 # the words of the command line, on purpose
    printf '%s\0' $2 >"$T/proc/$_p/cmdline"
    ln -s "$_p" "$D/compact/build.lock"
    run_push PB_COMPACT_PROC_DIR="$T/proc"
}

t_push_zombie_lock_taken_over() {
    push_with_stale_pid_lock "Z (zombie)" "sh /usr/local/lib/pb-compact/compact-build.sh"
    check "push exits 0" eq "$?" 0
    check "it took over the stale lock" grep_q "took over a stale lock held by" "$T/push.out"
    check "the manifest is on the box" present "$D/compact/manifest"
}

t_push_reused_pid_lock_taken_over() {
    push_with_stale_pid_lock "S (sleeping)" "sleep 60"
    check "push exits 0" eq "$?" 0
    check "it took over the stale lock" grep_q "took over a stale lock held by" "$T/push.out"
}

# PB_COMPACT_PIECE_MB=0 is refused with a clear message.
t_push_piece_mb_zero_refused() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    run_push PB_COMPACT_PIECE_MB=0
    check "push fails" ne "$?" 0
    check "the setting is named" grep_q "must be at least 1" "$T/push.out"
    check "nothing was uploaded" absent "$D/compact/data.db.new.upload"
}

t_push_missing_sha256sum_named() {
    make_db "$D/data.db" live
    run_remote_build || { bad "setup: off-box build failed"; return; }
    run_push NO_SHA256SUM=1
    check "push fails" ne "$?" 0
    check "the missing tool is named" grep_q "sha256sum is not installed" "$T/push.out"
}

# ---- tests: the off-box export -----------------------------------------------------

# Text with CR, LF, tab, 0x01, DEL, UTF-8 and NUL bytes arrives unchanged,
# whatever the sqlite3 CLI version (3.50+ prints control characters escaped).
t_remote_build_control_chars() {
    make_db "$D/data.db" live
    "$TEST_REAL_SQLITE" "$D/data.db" >/dev/null <<SQL
INSERT INTO diag_events (id, created, updated, data) VALUES ('de-ctl', $(now_pb), $(now_pb),
    'a' || char(13) || 'b' || char(10) || 'c' || char(9) || 'd' || char(1) || 'e' || char(127) || 'f' || char(233) || char(13) || char(10));
INSERT INTO diag_events (id, created, updated, data) VALUES ('de-nul', $(now_pb), $(now_pb), CAST(X'0d61000062000d0a01' AS TEXT));
SQL
    run_remote_build
    check "off-box build exits 0" eq "$?" 0
    _h="SELECT hex(sha3_query('SELECT rowid, * FROM diag_events WHERE id IN (''de-ctl'', ''de-nul'') ORDER BY rowid'));"
    check "the two rows hash the same on both sides" eq "$(q "$T/off/compact/data.db.new" "$_h")" "$(q "$D/data.db" "$_h")"
    check "the NUL row kept every byte" eq "$(q "$T/off/compact/data.db.new" "SELECT hex(CAST(data AS BLOB)) FROM diag_events WHERE id = 'de-nul';")" 0D61000062000D0A01
}

# A WITHOUT ROWID table with a covering secondary index: the box may read it
# in index order, the new file (no indexes yet) in key order. The hashes must
# still agree.
t_remote_build_without_rowid_order() {
    make_db "$D/data.db" live
    "$TEST_REAL_SQLITE" "$D/data.db" >/dev/null <<'SQL'
CREATE INDEX idx_kv_v ON kv (v);
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300)
INSERT INTO kv SELECT printf('k%04d', i), printf('v%04d', 1000 - i) FROM n;
ANALYZE;
SQL
    run_remote_build
    check "off-box build exits 0" eq "$?" 0
    check "kv arrived whole" eq "$(q "$T/off/compact/data.db.new" "SELECT count(*) FROM kv;")" 301
}

# sqlite3 cannot open /dev/stderr on the box (fd 2 is a socket there on some
# transports): the export must not need it.
t_remote_build_no_dev_stderr() {
    make_db "$D/data.db" live
    run_remote_build SQ_FAIL_MATCH="/dev/stderr"
    check "off-box build exits 0" eq "$?" 0
    check "it wrote a manifest" present "$T/off/compact/manifest"
}

# The build is stopped (TERM to the whole process group; an async job here
# ignores INT) while a remote
# command runs: its temp files go.
t_remote_build_interrupt_cleans_temp() {
    make_db "$D/data.db" live
    mkdir -p "$T/tmp" "$T/off"
    env TMPDIR="$T/tmp" PB_DATA_DIR="$T/off" PB_COMPACT_REMOTE=fake-remote PB_COMPACT_REMOTE_DB="$D/data.db" \
        PB_COMPACT_MIN_FREE_MB=1 PB_COMPACT_HEADROOM_MB=1 FR_SLEEP_MATCH="date +%s" FR_SLEEP_FLAG="$T/sleeping" FR_SLEEP_S=3 \
        "$TSH" "$SCRIPTS/compact-build.sh" >>"$T/build.out" 2>&1 &
    _b=$!
    _i=0
    while [ ! -e "$T/sleeping" ] && [ "$_i" -lt 300 ]; do sleep 0.1; _i=$((_i + 1)); done
    check "setup: a remote command is running" present "$T/sleeping"
    # shellcheck disable=SC2046 # one pid per word
    kill -TERM $(descendants "$_b") "$_b" 2>/dev/null
    wait "$_b"
    check "no temp file left" eq "$(count_paths "$T"/tmp/*)" 0
}

# Number of existing paths among the arguments (a glob).
count_paths() {
    _n=0
    for _p in "$@"; do
        [ -e "$_p" ] && _n=$((_n + 1))
    done
    echo "$_n"
}

descendants() {
    for _c in $(pgrep -P "$1"); do
        echo "$_c"
        descendants "$_c"
    done
}

# ---- main ------------------------------------------------------------------------
ALL=$(sed -n 's/^\(t_[a-z0-9_]*\)() {$/\1/p' "$0")
if [ $# -gt 0 ]; then
    SELECTED=""
    for _n in "$@"; do SELECTED="$SELECTED t_${_n#t_}"; done
else
    SELECTED=$ALL
fi

echo "scripts: $SCRIPTS"
echo "entrypoint: $ENTRYPOINT"
echo "shell: $TSH"
PASSED=0
FAILED=0
FAILED_NAMES=""
for _t in $SELECTED; do
    echo "--- ${_t#t_}"
    T="$ROOT/${_t#t_}"
    D="$T/pb_data"
    mkdir -p "$D"
    fake_open 1 0 /dev/null
    if (
        T_OK=1
        "$_t"
        [ "$T_OK" = 1 ]
    ); then
        PASSED=$((PASSED + 1))
    else
        FAILED=$((FAILED + 1))
        FAILED_NAMES="$FAILED_NAMES ${_t#t_}"
        for _f in "$T"/build.out "$T"/push.out "$T"/swap.out "$T"/boot.out; do
            [ -s "$_f" ] || continue
            echo "    -- tail of ${_f##*/}:"
            tail -6 "$_f" | sed 's/^/       /'
        done
    fi
    kill_holders
    rm -rf "$T"
done
echo "=== $PASSED passed, $FAILED failed${FAILED_NAMES:+:$FAILED_NAMES}"
[ "$FAILED" = 0 ]
