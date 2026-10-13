# Shared helpers for compact-build.sh, compact-swap.sh and compact-push.sh.
# Sourced, not run. The variables below are read by the scripts that source
# this file.
# shellcheck shell=sh disable=SC2034
#
# Copy-and-swap compaction of the PocketBase SQLite database. The build makes
# a new file that holds only the rows we keep, while PocketBase keeps serving,
# either on the box or off it (PB_COMPACT_REMOTE, then compact-push.sh puts
# the file on the box). The swap runs from entrypoint.sh before PocketBase
# starts, copies what changed since the build snapshot, checks that, and
# renames the files.
#
# Table classes:
#   append   big, insert-only tables (and superuser-only updateRule): keep
#            rowid > cutoff. Rows at or below the build snapshot do not
#            change, so the swap copies only rows above the snapshot (plus it
#            drops rows the retention hook deleted from the bottom of the
#            kept range in the meantime).
#   mutable  big tables whose rows are updated after insert: keep rowid >
#            cutoff. The swap reads the kept range once (rowid and
#            `updated`) and copies the rows that changed since the snapshot.
#   whole    every other table, including PocketBase's own `_` tables, auth
#            and view collections, sqlite_sequence and sqlite_stat*: the swap
#            copies the rows that changed since the snapshot, the same way;
#            a table with no `updated` column is compared by hash and copied
#            again only when it differs.
# Any table that is not named in the two prune lists below is "whole".

PB_DATA_DIR="${PB_DATA_DIR:-/pb_data}"
LIVE_DB="$PB_DATA_DIR/data.db"
COMPACT_DIR="$PB_DATA_DIR/compact"
NEW_DB="$COMPACT_DIR/data.db.new"
MANIFEST="$COMPACT_DIR/manifest"
SWAP_MARKER="$COMPACT_DIR/swap-in-progress"
CUTOVER_ATTEMPTS="$COMPACT_DIR/cutover-attempts"

# Off-box build (compact-build.sh and compact-push.sh only). PB_COMPACT_REMOTE
# is a command that runs its last argument as a shell command on the
# PocketBase box: stdin and stdout passed through, the remote exit status
# returned, and exit 255 when the connection fails (as ssh does). Example:
#   PB_COMPACT_REMOTE="railway ssh -p <project> -e <env> -s <service> --"
# The live database is then read on the box, at PB_COMPACT_REMOTE_DB
# (default /pb_data/data.db), always read-only, and the new file is built on
# this machine, under PB_DATA_DIR/compact.
REMOTE="${PB_COMPACT_REMOTE:-}"
REMOTE_TRIES="${PB_COMPACT_REMOTE_TRIES:-5}"
if [ -n "$REMOTE" ]; then
    LIVE_DB="${PB_COMPACT_REMOTE_DB:-/pb_data/data.db}"
fi

# Proven insert-only (see the PR for the write-path inventory).
COMPACT_APPEND_TABLES="cvdiag_events diag_events status_history"
# probe_runs rows are updated after insert (summary, state, finished_at).
COMPACT_MUTABLE_TABLES="probe_runs"

# PB's stored datetime format, "YYYY-MM-DD HH:MM:SS.sssZ", as a GLOB.
COMPACT_DATE_GLOB='[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
# Rows are not inserted in strict `created` order (sub-second jitter on
# prod). The order checks allow this much skew, in seconds.
COMPACT_SKEW_S=5

log() {
    printf '%s [pb-compact] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
    log "ERROR $*" >&2
    exit 1
}

# sqlite3 with no rc file, errors stop the script, plain output. PB's own
# tables are declared with double-quoted string defaults (DEFAULT "base"),
# which Alpine's sqlite3 rejects unless the dqs settings are on; .dbconfig
# prints the setting, hence the .output switch around it.
sq() {
    sqlite3 -init /dev/null -batch -bail -noheader -cmd '.timeout 10000' -cmd '.output /dev/null' -cmd '.dbconfig dqs_ddl on' -cmd '.dbconfig dqs_dml on' -cmd '.output stdout' "$@"
}

# The sq command line, read-only, for a shell on the box.
REMOTE_SQ="sqlite3 -init /dev/null -batch -bail -noheader -cmd '.timeout 10000' -cmd '.output /dev/null' -cmd '.dbconfig dqs_ddl on' -cmd '.dbconfig dqs_dml on' -cmd '.output stdout' -readonly"

# $1 as one single-quoted word for a shell command line.
shq() {
    printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# Runs the shell command $1 on the box and prints its output. Only for
# commands that change nothing there: a lost connection (exit 255) is tried
# again, up to PB_COMPACT_REMOTE_TRIES times. A try's output goes to a file
# and is printed only when the try is the last, so a try that broke off part
# way prints nothing.
remote_q() {
    _rq_out=$(mktemp "${TMPDIR:-/tmp}/pb-compact-remote.XXXXXX") || die "could not make a temp file"
    _rq_try=0
    while :; do
        _rq_try=$((_rq_try + 1))
        _rq_rc=0
        # $REMOTE is a command line; it is split into words on purpose.
        # shellcheck disable=SC2086
        $REMOTE "$1" </dev/null >"$_rq_out" || _rq_rc=$?
        if [ "$_rq_rc" != 255 ] || [ "$_rq_try" -ge "$REMOTE_TRIES" ]; then
            cat "$_rq_out"
            rm -f "$_rq_out"
            return "$_rq_rc"
        fi
        log "the remote command lost its connection (exit 255), try $_rq_try of $REMOTE_TRIES; trying again" >&2
        sleep 2
    done
}

# Read-only query on the live database. The live file is never written.
live_q() {
    if [ -n "$REMOTE" ]; then
        remote_q "$REMOTE_SQ $(shq "$LIVE_DB") $(shq "$1")"
    else
        sq -readonly "$LIVE_DB" "$1"
    fi
}

# Size of the live database or its -wal, 0 when absent.
live_file_size() {
    if [ -n "$REMOTE" ]; then
        remote_q "if [ -e $(shq "$1") ]; then stat -c %s $(shq "$1") 2>/dev/null || stat -f %z $(shq "$1"); else echo 0; fi"
    else
        file_size "$1"
    fi
}

# The box's clock, in unix seconds. The cutoffs and the snapshot time are
# compared with `created` values that the box wrote with its own clock.
live_now() {
    if [ -n "$REMOTE" ]; then
        remote_q "date +%s"
    else
        date +%s
    fi
}

new_q() {
    sq "$NEW_DB" "$1"
}

# Query on a database file: read-only for the live file, read-write for any
# other (the new file is ours). A read-only open of a WAL file can fail when
# its -shm does not exist yet, so only the live file needs that mode.
db_q() {
    if [ "$1" = "$LIVE_DB" ]; then
        live_q "$2"
    else
        sq "$1" "$2"
    fi
}

is_int() {
    case "$1" in
        '' | - | *[!0-9-]* | ?*-*) return 1 ;;
    esac
    return 0
}

# A setting that must be a whole number: digits only, no leading zero (the
# shell reads 08 as octal), at most 9 digits so arithmetic cannot overflow.
is_count() {
    case "$1" in
        '' | *[!0-9]* | 0?*) return 1 ;;
    esac
    [ "${#1}" -le 9 ]
}

# A setting that must be a plain decimal number, such as 0.05 or 2.
is_decimal() {
    case "$1" in
        '' | *[!0-9.]* | *.*.*) return 1 ;;
        *[0-9]*) return 0 ;;
    esac
    return 1
}

# sha3_query output: 64 hex digits (SHA3-256).
is_sha3() {
    case "$1" in
        '' | *[!0-9A-F]*) return 1 ;;
    esac
    [ "${#1}" = 64 ]
}

# Names go into SQL as quoted identifiers, so allow only plain ones.
is_ident() {
    case "$1" in
        '' | [0-9]* | *[!A-Za-z0-9_]*) return 1 ;;
    esac
    return 0
}

in_list() {
    for _x in $2; do
        [ "$_x" = "$1" ] && return 0
    done
    return 1
}

# Class of a table in the live database. A table in the insert-only list is
# treated as mutable when its PocketBase collection lets API clients update
# records (updateRule is not NULL, so not superuser-only): no code path may
# update it, but the API would accept it, so the swap copies its kept rows
# again. Superuser edits through the admin UI are the one update path this
# cannot see; the swap's count and top-row checks do not catch an edited value.
table_class() {
    if in_list "$1" "$COMPACT_APPEND_TABLES"; then
        _rule=$(live_q "SELECT updateRule IS NULL FROM _collections WHERE name = '$1';") ||
            die "could not read the updateRule of $1"
        if [ "$_rule" = 1 ]; then
            echo append
        else
            echo mutable
        fi
    elif in_list "$1" "$COMPACT_MUTABLE_TABLES"; then
        echo mutable
    else
        echo whole
    fi
}

file_size() {
    if [ -e "$1" ]; then
        # GNU and busybox stat. BSD stat (an off-box build on macOS) spells
        # it -f %z.
        stat -c %s "$1" 2>/dev/null || stat -f %z "$1"
    else
        echo 0
    fi
}

free_bytes() {
    df -Pk "$1" | awk 'NR == 2 { printf "%.0f\n", $4 * 1024 }'
}

human() {
    awk -v b="$1" 'BEGIN {
        split("B KB MB GB TB", u, " "); i = 1
        while (b >= 1024 && i < 5) { b /= 1024; i++ }
        printf "%.1f%s\n", b, u[i]
    }'
}

# Retention window for a pruned table, the same env the retention hook reads.
window_days() {
    _var="PB_RETENTION_$(echo "$1" | tr '[:lower:]' '[:upper:]')_DAYS"
    _days=""
    eval "_days=\${$_var:-30}"
    is_count "$_days" || die "$_var=$_days is not an integer in 1..3650"
    if [ "$_days" -lt 1 ] || [ "$_days" -gt 3650 ]; then
        die "$_var=$_days is not an integer in 1..3650"
    fi
    echo "$_days"
}

# Datetime in PB's stored format for a unix time.
pb_time() {
    sq ':memory:' "SELECT strftime('%Y-%m-%d %H:%M:%f', $1, 'unixepoch') || 'Z';"
}

# Column list of a table, quoted and comma separated, from the given db file.
column_list() {
    _cols=$(db_q "$1" "SELECT name FROM pragma_table_info('$2');") || die "could not read the columns of $2"
    _out=""
    for _c in $_cols; do
        is_ident "$_c" || die "table $2 has a column name we do not handle: $_c"
        _out="${_out:+$_out,}\"$_c\""
    done
    [ -n "$_out" ] || die "table $2 has no columns"
    echo "$_out"
}

# 1 when the table is WITHOUT ROWID.
without_rowid() {
    db_q "$1" "SELECT wr FROM pragma_table_list('$2') WHERE schema = 'main';"
}

# Name of the index that backs the table's PRIMARY KEY (the id column).
pk_index() {
    db_q "$1" "SELECT name FROM pragma_index_list('$2') WHERE origin = 'pk' LIMIT 1;"
}

# Every schema object except rootpage, which differs between files by design.
SCHEMA_LIST_SQL="SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name"

schema_list() {
    db_q "$1" "$SCHEMA_LIST_SQL;"
}

schema_hash() {
    db_q "$1" "SELECT hex(sha3_query('$SCHEMA_LIST_SQL'));"
}

# The database header values a copy must keep.
header_pragmas() {
    db_q "$1" "SELECT 'page_size=' || (SELECT page_size FROM pragma_page_size)
        || ' auto_vacuum=' || (SELECT auto_vacuum FROM pragma_auto_vacuum)
        || ' encoding=' || (SELECT encoding FROM pragma_encoding)
        || ' user_version=' || (SELECT user_version FROM pragma_user_version)
        || ' application_id=' || (SELECT application_id FROM pragma_application_id);"
}

# Tables to copy, in schema order: "name|class|without_rowid". Any failed
# query, or no tables at all, stops the caller: an empty or partial list
# would make the copy and its checks cover nothing.
table_inventory() {
    _names=$(db_q "$1" "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY rowid;") ||
        die "could not list the tables of $1"
    [ -n "$_names" ] || die "$1 has no tables"
    for _t in $_names; do
        is_ident "$_t" || die "table name we do not handle: $_t"
        _virt=$(db_q "$1" "SELECT sql LIKE 'CREATE VIRTUAL%' FROM sqlite_schema WHERE type = 'table' AND name = '$_t';") ||
            die "could not read the schema of $_t"
        [ "$_virt" = 0 ] || die "virtual table $_t is not supported by this compaction (or its schema could not be read: '$_virt')"
        _wr=$(without_rowid "$1" "$_t") || die "could not read whether $_t is WITHOUT ROWID"
        case "$_wr" in 0 | 1) ;; *) die "unexpected WITHOUT ROWID flag for $_t: '$_wr'" ;; esac
        _cls=$(table_class "$_t") || die "could not classify $_t"
        if [ "$_cls" != whole ] && [ "$_wr" = 1 ]; then
            die "pruned table $_t is WITHOUT ROWID; rowid pruning needs a rowid table"
        fi
        echo "$_t|$_cls|$_wr"
    done
}

# Where db_holders looks for open files. Only the tests point it elsewhere.
PROC_DIR="${PB_COMPACT_PROC_DIR:-/proc}"

# Prints "<pid> <path>" for every process other than this shell that has the
# live database or the new file open, or the -wal or -shm of either. Inside a
# ( ) subshell $$ is still the parent's pid, so the subshell itself is not
# excluded; it never holds either file open while this runs.
#
# Returns 2 when it could not look: no $PROC_DIR, or not one open file could
# be read there (this shell always has some open). "Could not look" must
# never read as "nobody has it open".
db_holders() {
    if [ ! -d "$PROC_DIR" ]; then
        echo "$PROC_DIR does not exist"
        return 2
    fi
    _seen=0
    for _fd in "$PROC_DIR"/[0-9]*/fd/*; do
        _target=$(readlink "$_fd" 2>/dev/null) || continue
        _seen=$((_seen + 1))
        case "$_target" in
            "$LIVE_DB" | "$LIVE_DB-wal" | "$LIVE_DB-shm" | "$NEW_DB" | "$NEW_DB-wal" | "$NEW_DB-shm")
                _pid=${_fd#"$PROC_DIR"/}
                _pid=${_pid%%/*}
                [ "$_pid" = "$$" ] && continue
                echo "$_pid $_target"
                ;;
        esac
    done
    if [ "$_seen" = 0 ]; then
        echo "no open file could be read under $PROC_DIR/*/fd"
        return 2
    fi
    return 0
}

# key=value lookup in the manifest (already checksum-verified).
manifest_get() {
    _line=$(grep -m 1 "^$1=" "$MANIFEST") || return 1
    echo "${_line#*=}"
}
