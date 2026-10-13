#!/bin/sh
# Build a compacted copy of the PocketBase database while PocketBase serves.
#
#   compact-build.sh --detach   start in the background (survives an ssh
#                               disconnect); log: /pb_data/compact/build.log
#   compact-build.sh            run in the foreground
#
# Output: /pb_data/compact/data.db.new and /pb_data/compact/manifest. The
# swap happens later, in entrypoint.sh, on a restart with PB_COMPACT_SWAP=1.
#
# The live data.db, -wal and -shm are opened read-only (sqlite3 -readonly
# and an ATTACH with mode=ro); nothing here writes to them. A WAL reader
# still takes its read lock in the -shm, exactly as PocketBase's own readers
# do. Every read is a short transaction: one brief read records the snapshot
# point, and the copy is many small rowid-range statements with a pause
# between them, so no read transaction pins the WAL and checkpoints go on.
#
# Tuning (env):
#   PB_COMPACT_CHUNK_ROWS      rows per copy statement, default 5000
#   PB_COMPACT_PAUSE_S         pause between statements, default 0.05
#   PB_COMPACT_MIN_FREE_MB     free-disk floor, default 2048. The build stops
#                              before any copy step that starts with less
#                              than this plus 10% of the live file free.
#   PB_COMPACT_HEADROOM_MB     extra free space the precheck asks for on top
#                              of the estimated kept size and the floor,
#                              default 2048
#   PB_RETENTION_<TABLE>_DAYS  window per pruned table, default 30 (the same
#                              variables the retention hook reads)
#
# A failed build removes its partial new file and leaves no manifest, also
# when it fails after the manifest was published.
#
# Off-box build: with PB_COMPACT_REMOTE set (see compact-lib.sh), this runs
# on another machine and reads the live database on the box through that
# command, read-only. The rows come over as compressed SQL, in segments of
# PB_COMPACT_SEGMENT_ROWS rows (default 250000, one remote command each); a
# segment whose connection breaks is fetched again. Every read on the box is
# still a short transaction of PB_COMPACT_CHUNK_ROWS rows with
# PB_COMPACT_PAUSE_S between them (default 0.2 here). Each chunk carries the
# sha3_query hash of its rows, read in the same transaction, and the build
# checks it against the rows it inserted. The new file, the indexes and the
# integrity check are all on this machine; PB_DATA_DIR is a local directory
# here. compact-push.sh then puts the file and the manifest on the box.
set -eu

LIB_DIR=$(dirname "$(readlink -f "$0")")
# shellcheck source=compact-lib.sh
. "$LIB_DIR/compact-lib.sh"

CHUNK_ROWS="${PB_COMPACT_CHUNK_ROWS:-5000}"
if [ -n "$REMOTE" ]; then
    PAUSE_S="${PB_COMPACT_PAUSE_S:-0.2}"
else
    PAUSE_S="${PB_COMPACT_PAUSE_S:-0.05}"
fi
SEGMENT_ROWS="${PB_COMPACT_SEGMENT_ROWS:-250000}"
MIN_FREE_MB="${PB_COMPACT_MIN_FREE_MB:-2048}"
HEADROOM_MB="${PB_COMPACT_HEADROOM_MB:-2048}"
for _v in CHUNK_ROWS SEGMENT_ROWS MIN_FREE_MB HEADROOM_MB; do
    _val=""
    eval "_val=\$$_v"
    is_count "$_val" || die "PB_COMPACT_$_v=$_val is not a whole number (digits only, no leading zero)"
done
[ "$CHUNK_ROWS" -ge 100 ] || die "PB_COMPACT_CHUNK_ROWS must be at least 100"
is_decimal "$PAUSE_S" || die "PB_COMPACT_PAUSE_S=$PAUSE_S is not a number such as 0.05"
# The retention windows are read again later; check them before any work.
for t in $COMPACT_APPEND_TABLES $COMPACT_MUTABLE_TABLES; do
    window_days "$t" >/dev/null
done

# Run as the pocketbase user so the new files have the right owner.
if [ "$(id -u)" = 0 ] && id pocketbase >/dev/null 2>&1; then
    exec su-exec pocketbase:pocketbase "$0" "$@"
fi

if [ "${1:-}" = "--detach" ]; then
    mkdir -p "$COMPACT_DIR"
    nohup setsid "$0" >>"$COMPACT_DIR/build.log" 2>&1 </dev/null &
    pid=$!
    # A build that cannot start (lock held, bad setting, no database) exits
    # at once; say so here instead of claiming it started.
    sleep 2
    if ! kill -0 "$pid" 2>/dev/null; then
        rc=0
        wait "$pid" || rc=$?
        if [ "$rc" != 0 ]; then
            echo "compact-build exited at once (exit $rc). The end of $COMPACT_DIR/build.log:" >&2
            tail -n 20 "$COMPACT_DIR/build.log" >&2
            exit "$rc"
        fi
        echo "compact-build finished already. log: $COMPACT_DIR/build.log"
        exit 0
    fi
    echo "compact-build started in the background, pid $pid"
    echo "log: $COMPACT_DIR/build.log"
    exit 0
fi

if [ -n "$REMOTE" ]; then
    _there=$(remote_q "if [ -f $(shq "$LIVE_DB") ]; then echo yes; else echo no; fi") ||
        die "could not run a command on the box with PB_COMPACT_REMOTE ($REMOTE)"
    [ "$_there" = yes ] || die "no live database at $LIVE_DB on the box"
    [ -r "$LIB_DIR/compact-export.sh" ] || die "missing $LIB_DIR/compact-export.sh"
else
    [ -f "$LIVE_DB" ] || die "no live database at $LIVE_DB"
fi
mkdir -p "$COMPACT_DIR"

# ---- one build at a time -------------------------------------------------------
# The lock is a symlink whose target is the holder's pid. Creating it is one
# atomic step that also records the owner, so the lock never exists without
# a pid. A lock whose holder is gone is taken over under a second lock,
# $LOCK.takeover, also a symlink to its holder's pid, so two builds cannot
# both take it over. A build killed while it held the takeover lock leaves
# it behind; a takeover lock whose holder is gone is cleared the same way.
LOCK="$COMPACT_DIR/build.lock"
TAKEOVER="$LOCK.takeover"
OWN_LOCK=0
OWN_TAKEOVER=0

build_alive() {
    is_int "$1" || return 1
    if [ -d /proc/self ]; then
        [ -r "/proc/$1/status" ] || return 1
        # PocketBase is PID 1 and does not reap children, so a build that
        # died stays as a zombie; a zombie does not hold the lock.
        grep -q "^State:[[:space:]]*Z" "/proc/$1/status" && return 1
        # Nor does an unrelated process that reused the pid.
        tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null | grep -q compact-build
        return
    fi
    kill -0 "$1" 2>/dev/null
}

# Takes $TAKEOVER, clearing it once if its holder is gone. An older build
# made it a directory with no pid; such a directory is stale once it is more
# than a minute old (the takeover itself takes milliseconds).
take_takeover() {
    # A directory first: `ln -s` onto a directory would make the link
    # inside it and report success.
    if [ -d "$TAKEOVER" ] && [ ! -L "$TAKEOVER" ]; then
        [ -n "$(find "$TAKEOVER" -maxdepth 0 -mmin +1 2>/dev/null)" ] || return 1
        log "clearing a stale takeover lock $TAKEOVER (a directory left by a killed build, more than a minute old)"
        rmdir "$TAKEOVER" 2>/dev/null || return 1
    fi
    if ln -s "$$" "$TAKEOVER" 2>/dev/null; then
        OWN_TAKEOVER=1
        return 0
    fi
    [ -L "$TAKEOVER" ] || return 1
    _tk=$(readlink "$TAKEOVER" 2>/dev/null) || _tk=""
    build_alive "$_tk" && return 1
    log "clearing a stale takeover lock $TAKEOVER (pid ${_tk:-unknown} is not running; a build was killed while it took over the lock)"
    rm -f "$TAKEOVER"
    ln -s "$$" "$TAKEOVER" 2>/dev/null || return 1
    OWN_TAKEOVER=1
}

release_takeover() {
    if [ "$OWN_TAKEOVER" = 1 ] && [ "$(readlink "$TAKEOVER" 2>/dev/null)" = "$$" ]; then
        rm -f "$TAKEOVER"
    fi
    OWN_TAKEOVER=0
}

take_lock() {
    if [ -e "$LOCK" ] && [ ! -L "$LOCK" ]; then
        die "another build is running or $LOCK was left by an older build; if no build runs, remove $LOCK by hand"
    fi
    if ln -s "$$" "$LOCK" 2>/dev/null; then
        OWN_LOCK=1
        return
    fi
    _holder=$(readlink "$LOCK" 2>/dev/null) || _holder=""
    build_alive "$_holder" && die "another build is running (pid $_holder)"
    take_takeover ||
        die "another build is running (it is taking over the lock); if none runs, remove $TAKEOVER by hand"
    # Look again under the takeover lock: the holder may have changed.
    _now=$(readlink "$LOCK" 2>/dev/null) || _now=""
    if [ "$_now" = "$_holder" ] && ! build_alive "$_now"; then
        log "taking over a stale build lock (pid ${_holder:-unknown})"
        rm -f "$LOCK"
    fi
    ln -s "$$" "$LOCK" 2>/dev/null && OWN_LOCK=1
    release_takeover
    [ "$OWN_LOCK" = 1 ] || die "another build is running (pid $(readlink "$LOCK" 2>/dev/null || echo unknown))"
}

# A failed build removes everything it made: the partial new file and the
# manifest, also when it had been published already (a failure after the
# publish, such as the final sync or a log write on a full volume). This
# build removed any older manifest when it started, so a manifest here is
# this build's.
on_exit() {
    _rc=$?
    # Every step below runs even when one fails, such as a log line on a
    # full volume: the lock must still be released.
    set +e
    release_takeover
    [ "$OWN_LOCK" = 1 ] || return 0
    if [ "$_rc" != 0 ]; then
        _what="there is no manifest"
        if [ -e "$MANIFEST" ]; then
            if rm -f "$MANIFEST"; then
                _what="the manifest it had published was removed"
            else
                _what="the manifest it had published could NOT be removed; delete $MANIFEST by hand"
            fi
        fi
        _left=""
        for _f in "$NEW_DB" "$NEW_DB-journal" "$NEW_DB-wal" "$NEW_DB-shm" "$MANIFEST.tmp"; do
            rm -f "$_f"
            if [ -e "$_f" ] || [ -L "$_f" ]; then
                _left="$_left $_f"
            fi
        done
        if [ -z "$_left" ]; then
            _new="no partial new file is left"
        else
            _new="these files could NOT be removed; delete them by hand:$_left"
        fi
        log "ERROR build stopped (exit $_rc); the live database is untouched, $_what, and $_new"
    fi
    # A line match, not a $( ) compare: after a failed write, bash (as sh)
    # can leak the unwritten log text into the next command substitution.
    if readlink "$LOCK" 2>/dev/null | grep -qx "$$"; then
        rm -f "$LOCK"
    fi
    return 0
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
take_lock

build_started=$(date +%s)
log "build start: live=$LIVE_DB${REMOTE:+ (on the box, via $REMOTE)} size=$(human "$(live_file_size "$LIVE_DB")") wal=$(human "$(live_file_size "$LIVE_DB-wal")")"

# The old manifest goes first, so a restart during this build cannot swap in
# a half-built file.
if [ -e "$MANIFEST" ]; then
    log "removing the previous manifest; this build replaces it"
    rm -f "$MANIFEST"
fi
rm -f "$NEW_DB" "$NEW_DB-journal" "$NEW_DB-wal" "$NEW_DB-shm"

# ---- inventory -------------------------------------------------------------
INVENTORY=$(table_inventory "$LIVE_DB")
for t in $COMPACT_APPEND_TABLES $COMPACT_MUTABLE_TABLES; do
    printf '%s\n' "$INVENTORY" | grep -q "^$t|" || die "pruned table $t is not in the live database"
done
log "tables: $(printf '%s\n' "$INVENTORY" | awk -F'|' '{ printf "%s%s(%s)", sep, $1, $2; sep = " " }')"

# ---- cutoff per pruned table ----------------------------------------------
# Binary search over rowid (rowid order follows `created`); each probe is a
# rowid b-tree seek, so this needs no index on `created`.
now_s=$(live_now)
is_int "$now_s" || die "could not read the time on the box: '$now_s'"

# "rowid|is_old|well_formed" for the first row with rowid >= $2.
probe_row() {
    live_q "SELECT rowid, created < '$3', created GLOB '$COMPACT_DATE_GLOB'
            FROM \"$1\" WHERE rowid >= $2 ORDER BY rowid LIMIT 1;"
}

find_cut() {
    _t=$1
    _cutoff=$2
    _first=$(probe_row "$_t" -9223372036854775807 "$_cutoff")
    if [ -z "$_first" ]; then
        echo 0
        return
    fi
    _last=$(live_q "SELECT rowid, created < '$_cutoff', created GLOB '$COMPACT_DATE_GLOB'
                    FROM \"$_t\" ORDER BY rowid DESC LIMIT 1;")
    [ -n "$_last" ] || die "table $_t: no last row (the table was emptied during the search); run the build again"
    _lo=${_first%%|*}
    _hi=${_last%%|*}
    for _row in "$_first" "$_last"; do
        [ "${_row##*|}" = 1 ] || die "table $_t: malformed created at rowid ${_row%%|*}; compaction refuses to guess"
    done
    _first_old=$(echo "$_first" | cut -d'|' -f2)
    _last_old=$(echo "$_last" | cut -d'|' -f2)
    if [ "$_first_old" = 0 ]; then
        echo $((_lo - 1))
        return
    fi
    if [ "$_last_old" = 1 ]; then
        echo "$_hi"
        return
    fi
    # Invariant: row _lo is older than the cutoff; the first row at or above
    # _hi is not.
    while [ $((_hi - _lo)) -gt 1 ]; do
        _mid=$((_lo + (_hi - _lo) / 2))
        _row=$(probe_row "$_t" "$_mid" "$_cutoff")
        [ -n "$_row" ] || die "table $_t: no row at or above rowid $_mid (rows deleted during the search); run the build again"
        [ "${_row##*|}" = 1 ] || die "table $_t: malformed created at rowid ${_row%%|*}; compaction refuses to guess"
        if [ "$(echo "$_row" | cut -d'|' -f2)" = 1 ]; then
            _lo=${_row%%|*}
        else
            _hi=$_mid
        fi
    done
    echo "$_lo"
}

# Sample 17 rows (the lowest rowid, 15 between, and the cut) up to the cut:
# each must be older than the window (plus skew). The first row above the
# cut must not be older than the window minus skew. The same order check the
# retention hook makes. The hook keeps deleting the oldest rows meanwhile, so
# a sample whose range [r, cut] is already gone is skipped, not failed.
check_order() {
    _t=$1
    _cut=$2
    _cutoff_s=$3
    _late=$(pb_time $((_cutoff_s + COMPACT_SKEW_S))) || die "could not compute the order-check time for $_t"
    _early=$(pb_time $((_cutoff_s - COMPACT_SKEW_S))) || die "could not compute the order-check time for $_t"
    _first=$(live_q "SELECT rowid FROM \"$_t\" ORDER BY rowid LIMIT 1;")
    [ -n "$_first" ] || return 0
    if [ "$_cut" -ge "$_first" ]; then
        _i=0
        _skipped=0
        while [ "$_i" -le 16 ]; do
            _r=$((_first + (_cut - _first) * _i / 16))
            _ok=$(live_q "SELECT created < '$_late' AND created GLOB '$COMPACT_DATE_GLOB'
                          FROM \"$_t\" WHERE rowid BETWEEN $_r AND $_cut ORDER BY rowid LIMIT 1;")
            if [ -z "$_ok" ]; then
                _skipped=$((_skipped + 1))
            else
                [ "$_ok" = 1 ] || die "table $_t: sampled row at or after rowid $_r is not older than the window; rowid order does not follow created"
            fi
            _i=$((_i + 1))
        done
        [ "$_skipped" = 0 ] || log "table $_t: $_skipped of 17 order samples skipped; those rows were deleted meanwhile (retention)"
    fi
    _above=$(live_q "SELECT created >= '$_early' FROM \"$_t\" WHERE rowid > $_cut ORDER BY rowid LIMIT 1;")
    if [ -n "$_above" ] && [ "$_above" != 1 ]; then
        die "table $_t: the row above cut rowid $_cut is older than the window; rowid order does not follow created"
    fi
}

CUTS=""
CUTOFFS=""
for line in $INVENTORY; do
    t=${line%%|*}
    cls=$(echo "$line" | cut -d'|' -f2)
    [ "$cls" = whole ] && continue
    days=$(window_days "$t")
    cutoff_s=$((now_s - days * 86400))
    cutoff=$(pb_time "$cutoff_s") || die "could not compute the cutoff time for $t"
    started=$(date +%s)
    cut=$(find_cut "$t" "$cutoff")
    check_order "$t" "$cut" "$cutoff_s"
    log "cutoff table=$t class=$cls window_days=$days cutoff=\"$cutoff\" cut_rowid=$cut search_s=$(($(date +%s) - started))"
    CUTS="$CUTS $t=$cut"
    CUTOFFS="$CUTOFFS $t=$cutoff_s"
done

# Value for table $1 in a list of table=value pairs ($2).
pair_of() {
    for _p in $2; do
        [ "${_p%%=*}" = "$1" ] && { echo "${_p#*=}"; return; }
    done
    echo ""
}

cut_of() {
    pair_of "$1" "$CUTS"
}

# ---- snapshot point ---------------------------------------------------------
# One brief read transaction: the schema and every table's top rowid (and its
# id, for the pruned tables). Each max is its own statement; SQLite only
# optimizes a lone min() or max() to a b-tree seek. The time just before it
# goes into the manifest: a row whose `created` is later was written after
# the snapshot, which is how the swap tells a reused rowid from a kept row.
SNAP_SQL="BEGIN;
SELECT 'schema|' || hex(sha3_query('$SCHEMA_LIST_SQL'));
"
for line in $INVENTORY; do
    t=${line%%|*}
    cls=$(echo "$line" | cut -d'|' -f2)
    wr=$(echo "$line" | cut -d'|' -f3)
    if [ "$wr" = 1 ]; then
        SNAP_SQL="$SNAP_SQL SELECT 'max|$t|0|';
"
    else
        # The class comes from the inventory. Classifying again here would
        # put the query inside a test, where set -e does not see a failure.
        id_expr="''"
        [ "$cls" = whole ] || id_expr="id"
        SNAP_SQL="$SNAP_SQL SELECT 'max|$t|' || COALESCE((SELECT rowid FROM \"$t\" ORDER BY rowid DESC LIMIT 1), 0)
    || '|' || COALESCE((SELECT $id_expr FROM \"$t\" ORDER BY rowid DESC LIMIT 1), '');
"
    fi
done
SNAP_SQL="${SNAP_SQL}COMMIT;"
snap_started=$(live_now)
is_int "$snap_started" || die "could not read the time on the box: '$snap_started'"
SNAP=$(live_q "$SNAP_SQL") || die "could not take the snapshot"
SNAP_SCHEMA=$(printf '%s\n' "$SNAP" | sed -n 's/^schema|//p')
is_sha3 "$SNAP_SCHEMA" || die "the snapshot has no schema hash: '$SNAP_SCHEMA'"
schema_list "$LIVE_DB" >"$COMPACT_DIR/schema.live"
live_schema=$(schema_hash "$LIVE_DB")
[ "$live_schema" = "$SNAP_SCHEMA" ] || die "the schema changed while the snapshot was taken; run the build again"
log "snapshot taken, schema sha3=$SNAP_SCHEMA"

snap_max() {
    printf '%s\n' "$SNAP" | awk -F'|' -v t="$1" '$1 == "max" && $2 == t { print $3 }'
}
snap_id() {
    printf '%s\n' "$SNAP" | awk -F'|' -v t="$1" '$1 == "max" && $2 == t { print $4 }'
}

# ---- free disk ---------------------------------------------------------------
# The new file is on the same volume as the live database. If the volume
# filled, PocketBase's own writes would fail. So every copy step first checks
# that at least FLOOR bytes are free: PB_COMPACT_MIN_FREE_MB plus 10% of the
# live file. One step adds at most PB_COMPACT_CHUNK_ROWS rows.
live_size=$(live_file_size "$LIVE_DB")
is_int "$live_size" || die "could not read the size of $LIVE_DB"
FLOOR=$((MIN_FREE_MB * 1048576 + live_size / 10))

check_free() {
    _free=$(free_bytes "$COMPACT_DIR")
    is_int "$_free" || die "could not read the free disk space of $COMPACT_DIR (got '$_free')"
    [ "$_free" -ge "$FLOOR" ] ||
        die "free disk is $(human "$_free") before $1, below the floor of $(human "$FLOOR") (PB_COMPACT_MIN_FREE_MB plus 10% of the live file); stopping so the volume does not fill"
}

# Precheck: the kept share of the pruned tables' rows, applied to the whole
# file. Rows are not all the same size, so this is an estimate; check_free
# stops the copy if the estimate is wrong.
kept_rows=0
total_rows=0
for line in $INVENTORY; do
    t=${line%%|*}
    cls=$(echo "$line" | cut -d'|' -f2)
    [ "$cls" = whole ] && continue
    mx=$(snap_max "$t")
    mn=$(live_q "SELECT COALESCE((SELECT rowid FROM \"$t\" ORDER BY rowid LIMIT 1), 1);")
    cut=$(cut_of "$t")
    [ "$mx" -ge "$mn" ] && total_rows=$((total_rows + mx - mn + 1))
    [ "$mx" -gt "$cut" ] && kept_rows=$((kept_rows + mx - cut))
done
if [ "$total_rows" -gt 0 ]; then
    est=$(awk -v s="$live_size" -v k="$kept_rows" -v n="$total_rows" 'BEGIN { printf "%.0f\n", s * k / n }')
else
    est=$live_size
fi
need=$((est + FLOOR + HEADROOM_MB * 1048576))
free=$(free_bytes "$COMPACT_DIR")
is_int "$free" || die "could not read the free disk space of $COMPACT_DIR (got '$free')"
log "disk precheck: live=$(human "$live_size") estimated_new=$(human "$est") floor=$(human "$FLOOR") need=$(human "$need") free=$(human "$free")"
[ "$free" -ge "$need" ] || die "not enough free disk: need $(human "$need"), have $(human "$free")"

# ---- new database: header pragmas and tables ---------------------------------
PS=$(live_q "PRAGMA page_size;")
AV=$(live_q "PRAGMA auto_vacuum;")
ENC=$(live_q "PRAGMA encoding;")
UV=$(live_q "PRAGMA user_version;")
AID=$(live_q "PRAGMA application_id;")
for v in "$PS" "$AV" "$UV" "$AID"; do
    is_int "$v" || die "unexpected pragma value from the live database: $v"
done
case "$ENC" in UTF-8 | UTF-16le | UTF-16be) ;; *) die "unexpected encoding $ENC" ;; esac

# Table DDL from the live schema, in creation order. SQLite's own tables
# (sqlite_sequence, sqlite_stat1) cannot be created by hand; they are made
# further down, the way SQLite makes them.
live_q "SELECT sql || ';' FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\' ORDER BY rowid;" \
    >"$COMPACT_DIR/schema.tables.sql"
live_q "SELECT sql || ';' FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL ORDER BY rowid;" \
    >"$COMPACT_DIR/schema.indexes.sql"
live_q "SELECT sql || ';' FROM sqlite_schema WHERE type = 'view' ORDER BY rowid;" \
    >"$COMPACT_DIR/schema.views.sql"
live_q "SELECT sql || ';' FROM sqlite_schema WHERE type = 'trigger' ORDER BY rowid;" \
    >"$COMPACT_DIR/schema.triggers.sql"

{
    echo "PRAGMA page_size = $PS;"
    echo "PRAGMA auto_vacuum = $AV;"
    echo "PRAGMA encoding = '$ENC';"
    echo "PRAGMA journal_mode = OFF;"
    echo "BEGIN;"
    cat "$COMPACT_DIR/schema.tables.sql"
    echo "COMMIT;"
    echo "PRAGMA user_version = $UV;"
    echo "PRAGMA application_id = $AID;"
} | sq "$NEW_DB" >/dev/null
# sqlite_sequence appears with the first AUTOINCREMENT table. sqlite_stat1
# appears with the first ANALYZE; its rows are copied with the other tables.
# Read into a variable first: a failed query in a for list only makes the
# loop run zero times.
SQLITE_TABLES=$(live_q "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'sqlite\_%' ESCAPE '\';") ||
    die "could not list SQLite's own tables (sqlite_sequence, sqlite_stat1) in the live database"
for t in $SQLITE_TABLES; do
    case "$t" in
        sqlite_sequence) ;;
        sqlite_stat1)
            first_user=$(live_q "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\' ORDER BY rowid LIMIT 1;")
            new_q "ANALYZE \"$first_user\"; DELETE FROM sqlite_stat1;" >/dev/null
            ;;
        *) die "SQLite table $t is not supported by this compaction" ;;
    esac
    [ "$(new_q "SELECT count(*) FROM sqlite_schema WHERE name = '$t';")" = 1 ] || die "could not create $t in the new database"
done
log "new database created: page_size=$PS auto_vacuum=$AV encoding=$ENC user_version=$UV application_id=$AID"

# ---- copy rows ---------------------------------------------------------------
# " live_wal=<size>" for the log lines. Not read off-box: one more remote
# command per line for a number that does not change what the build does.
wal_note() {
    [ -n "$REMOTE" ] || echo " live_wal=$(human "$(file_size "$LIVE_DB-wal")")"
}

# Off-box copy of table $1 into the new file. $2 is the column list of the
# rows (with rowid for a rowid table), $3 the target column list, $4 the
# first rowid to skip ("all" for one read of the whole table), $5 the
# snapshot top rowid. Prints the number of chunks.
#
# The rows of each segment of PB_COMPACT_SEGMENT_ROWS rowids come over one
# remote command as gzip'd INSERT statements (compact-export.sh, sent with
# the command), with one check line per chunk on stderr. The segment is used
# only when its chunks cover it end to end and the gzip stream is whole;
# otherwise it is fetched again (the reads change nothing on the box). After
# the insert, each chunk's row count and sha3 are checked against what the
# box read in the same transaction.
remote_copy() {
    _t=$1
    _sel=$2
    _tcols=$3
    _rowsql="'INSERT INTO \"$_t\" ($_tcols) VALUES(' || "
    _first=1
    _oldifs=$IFS
    IFS=,
    for _c in $_sel; do
        [ "$_first" = 1 ] || _rowsql="$_rowsql || ',' || "
        _rowsql="${_rowsql}quote($_c)"
        _first=0
    done
    IFS=$_oldifs
    _rowsql="$_rowsql || ');'"
    _script=$(cat "$LIB_DIR/compact-export.sh") || die "could not read compact-export.sh"
    _seg="$COMPACT_DIR/segment"
    _pos=$4
    _chunks=0
    while :; do
        if [ "$_pos" = all ]; then
            _end=all
            _args="all"
        else
            [ "$_pos" -lt "$5" ] || break
            if [ "$_pos" -ge $(($5 - SEGMENT_ROWS)) ]; then
                _end=$5
            else
                _end=$((_pos + SEGMENT_ROWS))
            fi
            _args="$_pos $_end $CHUNK_ROWS $PAUSE_S"
        fi
        check_free "copying $_t rowids ($_pos,$_end]"
        _try=0
        while :; do
            _try=$((_try + 1))
            _seg_started=$(date +%s)
            _rc=0
            # shellcheck disable=SC2086 # $REMOTE and $_args are split on purpose
            $REMOTE "sh -c $(shq "$_script") compact-export $(shq "$LIVE_DB") $(shq "$_t") $(shq "$_sel") $(shq "$_rowsql") $_args | gzip -1" \
                </dev/null >"$_seg.gz" 2>"$_seg.err" || _rc=$?
            # The chunk lines must run from the start to the end with no gap:
            # each one starts where the one before said the next read starts.
            _cover=$(awk -F'|' -v want="$_pos" -v end="$_end" '
                $1 == "chunk" { n++; if ($2 != want) bad = 1; want = $6 }
                END { if (n == 0 || bad || want != end) print "no"; else print "yes" }' "$_seg.err")
            if [ "$_rc" = 0 ] && [ "$_cover" = yes ] && gzip -t "$_seg.gz" 2>/dev/null; then
                break
            fi
            log "segment $_t ($_pos,$_end] did not arrive whole (exit $_rc, chunks cover it: $_cover), try $_try of $REMOTE_TRIES: $(grep -v '^chunk|' "$_seg.err" | tail -n 3 | tr '\n' ' ')" >&2
            [ "$_try" -lt "$REMOTE_TRIES" ] || die "could not fetch $_t rowids ($_pos,$_end] from the box"
            sleep 2
        done
        _gz=$(file_size "$_seg.gz")
        {
            echo "PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF; BEGIN;"
            [ "$_t" = sqlite_sequence ] && echo "DELETE FROM main.sqlite_sequence;"
            gzip -dc "$_seg.gz"
            echo "COMMIT;"
        } | sq "$NEW_DB" >/dev/null || die "inserting $_t rowids ($_pos,$_end] into the new file failed"
        # The same queries the box hashed, on the inserted rows.
        awk -F'|' -v t="$_t" -v sel="$_sel" '
            $1 != "chunk" { next }
            {
                if ($2 == "all") q = "SELECT " sel " FROM \"" t "\""
                else q = "SELECT " sel " FROM \"" t "\" WHERE rowid > " $2 " AND rowid <= " $3 " ORDER BY rowid"
                hq = q; gsub(/\x27/, "\x27\x27", hq)
                printf "SELECT %s || \x27|\x27 || count(*) || \x27|\x27 || hex(sha3_query(\x27%s\x27)) FROM (%s);\n", "\x27" $2 "|" $3 "\x27", hq, q
            }' "$_seg.err" >"$_seg.check.sql"
        sq "$NEW_DB" <"$_seg.check.sql" >"$_seg.check.new" || die "could not hash $_t rowids ($_pos,$_end] in the new file"
        awk -F'|' '$1 == "chunk" { print $2 "|" $3 "|" $4 "|" $5 }' "$_seg.err" >"$_seg.check.box"
        if ! cmp -s "$_seg.check.box" "$_seg.check.new"; then
            diff "$_seg.check.box" "$_seg.check.new" | head -6 >&2 || true
            die "table $_t rowids ($_pos,$_end]: the rows in the new file do not hash the same as the rows the box sent"
        fi
        _n=$(grep -c . "$_seg.check.box")
        _chunks=$((_chunks + _n))
        [ "$_end" = all ] || log "segment table=$_t rowids=($_pos,$_end] chunks=$_n gz=$(human "$_gz") s=$(($(date +%s) - _seg_started)) new=$(human "$(file_size "$NEW_DB")")" >&2
        rm -f "$_seg.gz" "$_seg.err" "$_seg.check.sql" "$_seg.check.new" "$_seg.check.box"
        [ "$_end" = all ] && break
        _pos=$_end
    done
    echo "$_chunks"
}

# sqlite_sequence is copied last, after every AUTOINCREMENT table: inserting
# rows with explicit rowids into such a table writes its own sqlite_sequence
# row, so an earlier copy would leave two rows for one table.
copied_total=0
has_sequence=0
for line in $INVENTORY; do
    t=${line%%|*}
    cls=$(echo "$line" | cut -d'|' -f2)
    wr=$(echo "$line" | cut -d'|' -f3)
    if [ "$t" = sqlite_sequence ]; then
        has_sequence=1
        continue
    fi
    cols=$(column_list "$LIVE_DB" "$t")
    t_started=$(date +%s)
    if [ "$wr" = 1 ] && [ -n "$REMOTE" ]; then
        remote_copy "$t" "$cols" "$cols" all >/dev/null
        rows=$(new_q "SELECT count(*) FROM \"$t\";")
        log "copied table=$t class=$cls rows=$rows (without rowid) s=$(($(date +%s) - t_started))"
        continue
    fi
    if [ "$wr" = 1 ]; then
        # WITHOUT ROWID tables are copied in one statement (no rowid ranges).
        check_free "copying $t"
        sq "$NEW_DB" "PRAGMA journal_mode = OFF; ATTACH 'file:$LIVE_DB?mode=ro' AS live;
                      INSERT INTO main.\"$t\" ($cols) SELECT $cols FROM live.\"$t\";" >/dev/null
        rows=$(new_q "SELECT count(*) FROM \"$t\";")
        log "copied table=$t class=$cls rows=$rows (without rowid) s=$(($(date +%s) - t_started))"
        continue
    fi
    hi=$(snap_max "$t")
    is_int "$hi" || die "no snapshot rowid for $t: '$hi'"
    if [ "$cls" = whole ]; then
        lo=$(live_q "SELECT COALESCE((SELECT rowid FROM \"$t\" ORDER BY rowid LIMIT 1) - 1, 0);")
    else
        lo=$(cut_of "$t")
        mn=$(live_q "SELECT COALESCE((SELECT rowid FROM \"$t\" ORDER BY rowid LIMIT 1) - 1, 0);")
        is_int "$mn" || die "could not read the lowest rowid of $t: '$mn'"
        [ "$mn" -gt "$lo" ] && lo=$mn
    fi
    is_int "$lo" || die "no start rowid for $t: '$lo'"
    pos=$lo
    chunks=0
    if [ -n "$REMOTE" ]; then
        chunks=$(remote_copy "$t" "rowid,$cols" "rowid,$cols" "$lo" "$hi")
        pos=$hi
    fi
    while [ "$pos" -lt "$hi" ]; do
        # Compared before adding, so pos + CHUNK_ROWS cannot overflow near
        # the top of the rowid range.
        if [ "$pos" -ge $((hi - CHUNK_ROWS)) ]; then
            nxt=$hi
        else
            nxt=$((pos + CHUNK_ROWS))
        fi
        check_free "copying $t rowids ($pos,$nxt]"
        # One autocommit statement: one short read transaction on the live
        # file. journal_mode=MEMORY keeps statement rollback on the new file.
        # The last line of the output is where the next range starts: just
        # below the next rowid above this range, or $hi when there is none.
        # So a sparse table (a few rows far apart) skips its empty ranges
        # instead of walking them CHUNK_ROWS at a time.
        out=$(sq "$NEW_DB" "PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF;
                      ATTACH 'file:$LIVE_DB?mode=ro' AS live;
                      INSERT INTO main.\"$t\" (rowid,$cols)
                      SELECT rowid,$cols FROM live.\"$t\" WHERE rowid > $pos AND rowid <= $nxt ORDER BY rowid;
                      SELECT COALESCE((SELECT rowid FROM live.\"$t\" WHERE rowid > $nxt AND rowid <= $hi ORDER BY rowid LIMIT 1) - 1, $hi);")
        pos=$(printf '%s\n' "$out" | tail -n 1)
        is_int "$pos" || die "could not read the next rowid of $t above $nxt: '$pos'"
        [ "$pos" -ge "$nxt" ] || die "table $t: the next rowid above $nxt is $pos; the copy would not move forward"
        chunks=$((chunks + 1))
        if [ $((chunks % 50)) = 0 ]; then
            log "progress table=$t rowid=$pos/$hi new=$(human "$(file_size "$NEW_DB")") live_wal=$(human "$(file_size "$LIVE_DB-wal")") free=$(human "$(free_bytes "$COMPACT_DIR")")"
        fi
        sleep "$PAUSE_S"
    done
    rows=$(new_q "SELECT count(*) FROM \"$t\";")
    copied_total=$((copied_total + rows))
    log "copied table=$t class=$cls rowids=($lo,$hi] rows=$rows chunks=$chunks s=$(($(date +%s) - t_started))$(wal_note)"
done
if [ "$has_sequence" = 1 ]; then
    # Replaces the rows the AUTOINCREMENT copies wrote. The swap copies this
    # table again; this keeps the build artifact and its manifest right.
    check_free "copying sqlite_sequence"
    if [ -n "$REMOTE" ]; then
        # remote_copy deletes the rows first, in the same transaction.
        remote_copy sqlite_sequence "name,seq" "name,seq" all >/dev/null
    else
        sq "$NEW_DB" "PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF;
                      ATTACH 'file:$LIVE_DB?mode=ro' AS live;
                      BEGIN;
                      DELETE FROM main.sqlite_sequence;
                      INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM live.sqlite_sequence;
                      COMMIT;" >/dev/null
    fi
    rows=$(new_q "SELECT count(*) FROM sqlite_sequence;")
    copied_total=$((copied_total + rows))
    log "copied table=sqlite_sequence class=whole rows=$rows"
fi

# ---- indexes, views, triggers (after the rows) ------------------------------
# A UNIQUE index can fail here on a whole table: its rows are copied in many
# short reads, so two rows that swapped a unique value between two chunks
# can both carry it. The build then stops with no manifest; run it again.
check_free "creating indexes"
idx_started=$(date +%s)
{
    echo "PRAGMA journal_mode = OFF;"
    cat "$COMPACT_DIR/schema.indexes.sql" "$COMPACT_DIR/schema.views.sql" "$COMPACT_DIR/schema.triggers.sql"
} | sq "$NEW_DB" >/dev/null
log "indexes, views and triggers created in $(($(date +%s) - idx_started))s"

# ---- checks -----------------------------------------------------------------
schema_list "$NEW_DB" >"$COMPACT_DIR/schema.new"
if ! cmp -s "$COMPACT_DIR/schema.live" "$COMPACT_DIR/schema.new"; then
    diff "$COMPACT_DIR/schema.live" "$COMPACT_DIR/schema.new" | head -40 >&2 || true
    die "schema of the new database differs from the live snapshot"
fi
live_schema=$(schema_hash "$LIVE_DB")
[ "$live_schema" = "$SNAP_SCHEMA" ] || die "the live schema changed during the build; run the build again"
live_header=$(header_pragmas "$LIVE_DB")
new_header=$(header_pragmas "$NEW_DB")
[ -n "$live_header" ] && [ "$live_header" = "$new_header" ] || die "header pragmas differ: live=[$live_header] new=[$new_header]"

ic_started=$(date +%s)
ic=$(new_q "PRAGMA integrity_check;")
[ "$ic" = ok ] || die "integrity_check on the new database failed: $(echo "$ic" | head -5)"
log "integrity_check ok in $(($(date +%s) - ic_started))s"

# WAL is a persistent setting in the file header, like the live database.
jm=$(new_q "PRAGMA journal_mode = WAL;")
[ "$jm" = wal ] || die "could not set WAL mode on the new database"

# ---- manifest ---------------------------------------------------------------
# Every value is read into a variable first, so a failed query stops the
# build (set -e does not see a failure inside an echo argument).
new_size=$(file_size "$NEW_DB")
is_int "$new_size" || die "could not read the size of $NEW_DB"
tmp="$MANIFEST.tmp"
{
    echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "build_seconds=$(($(date +%s) - build_started))"
    echo "live_size=$live_size"
    echo "new_size=$new_size"
    echo "schema_sha3=$SNAP_SCHEMA"
    echo "snapshot_s=$snap_started"
    echo "header=$new_header"
    for line in $INVENTORY; do
        t=${line%%|*}
        cls=$(echo "$line" | cut -d'|' -f2)
        smax=$(snap_max "$t")
        is_int "$smax" || die "no snapshot rowid for $t: '$smax'"
        rows=$(new_q "SELECT count(*) FROM \"$t\";")
        is_int "$rows" || die "could not count the rows of $t in the new database: '$rows'"
        echo "table.$t.class=$cls"
        echo "table.$t.snapshot_max_rowid=$smax"
        if [ "$cls" != whole ]; then
            cut=$(cut_of "$t")
            is_int "$cut" || die "no cut rowid for $t: '$cut'"
            days=$(window_days "$t")
            cutoff_s=$(pair_of "$t" "$CUTOFFS")
            is_int "$cutoff_s" || die "no cutoff time for $t: '$cutoff_s'"
            cutoff=$(pb_time "$cutoff_s") || die "could not compute the cutoff time for $t"
            echo "table.$t.cut_rowid=$cut"
            # The swap refuses a longer window than this: the rows created
            # before the cutoff are not in the new file.
            echo "table.$t.window_days=$days"
            echo "table.$t.cutoff_s=$cutoff_s"
            echo "table.$t.cutoff=$cutoff"
        fi
        if [ "$cls" != whole ]; then
            sid=$(snap_id "$t")
            [ -n "$sid" ] || [ "$smax" = 0 ] || die "no snapshot id for $t"
            echo "table.$t.snapshot_id=$sid"
        fi
        echo "table.$t.rows=$rows"
    done
} >"$tmp"
# The last line is the sha256 of every line above it. The swap refuses a
# manifest whose checksum does not match.
sum=$(sha256sum "$tmp" | cut -d' ' -f1)
is_sha256=$(printf '%s' "$sum" | grep -c '^[0-9a-f]\{64\}$' || true)
[ "$is_sha256" = 1 ] || die "could not checksum the manifest"
echo "sha256=$sum" >>"$tmp"
# The new file was written with synchronous=OFF and journal_mode=OFF. Flush
# it, and the manifest, to disk before the manifest is published: after a
# crash, a manifest must not point at a file whose pages were lost.
sync
mv "$tmp" "$MANIFEST"
sync

log "build done in $(($(date +%s) - build_started))s: new=$(human "$new_size") (live $(human "$live_size")) rows=$copied_total$(wal_note)"
log "manifest: $MANIFEST. To swap: restart the pocketbase service with PB_COMPACT_SWAP=1."
