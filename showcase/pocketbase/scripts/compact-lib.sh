# Shared helpers for compact-build.sh, compact-swap.sh and compact-push.sh.
# Sourced, not run. The variables below are read by the scripts that source
# this file.
# shellcheck shell=sh disable=SC2034
#
# Copy-and-swap compaction of the PocketBase SQLite database. The build makes
# a new file that holds only the rows we keep, as of one snapshot, while
# PocketBase keeps serving. It writes that file off the live volume
# (PB_COMPACT_OUT_DIR, default /tmp/pbcompact on the box; or on another
# machine with PB_COMPACT_REMOTE), then compact-push.sh copies it into the
# compact directory next to the live database at a capped write rate. The
# swap runs from entrypoint.sh before PocketBase starts: it checks that the
# file there is the one the manifest names, and renames the files. Nothing is
# copied at the swap, so rows written between the snapshot and the swap are
# not in the new file. That loss of telemetry is accepted.
#
# Table classes (the build keeps rowid > cut for the pruned ones):
#   append   big, insert-only tables (superuser-only updateRule)
#   mutable  big tables whose rows are updated after insert
#   whole    every other table, including PocketBase's own `_` tables, auth
#            and view collections, sqlite_sequence and sqlite_stat*
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
# The command remote_q runs. Without PB_COMPACT_REMOTE, compact-push.sh
# copies a build made on this machine, and its "box" commands run here.
REMOTE_RUN="${REMOTE:-sh -c}"

# Where compact-build.sh writes the new file and its manifest. On the box the
# default is /tmp/pbcompact, a different device from the live volume, so the
# build's writes (rows, indexes, integrity check) do not compete with
# PocketBase's for the volume; the build then copies the file onto the volume
# (compact-push.sh). Off the box (PB_COMPACT_REMOTE) it is PB_DATA_DIR/compact
# on this machine. PB_COMPACT_OUT_DIR=PB_DATA_DIR/compact builds in place.
if [ -n "$REMOTE" ]; then
    OUT_DIR="${PB_COMPACT_OUT_DIR:-$COMPACT_DIR}"
else
    OUT_DIR="${PB_COMPACT_OUT_DIR:-/tmp/pbcompact}"
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

# This run's private temp directory, made by rq_init and removed by
# rq_cleanup from the scripts' exit traps. remote_q runs inside $( ), so a
# temp file it made on its own would be unknown to the trap and left behind
# by a ^C.
RQ_DIR=""
rq_init() {
    RQ_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pb-compact.XXXXXX") || die "could not make a temp directory"
}
rq_cleanup() {
    [ -z "$RQ_DIR" ] || rm -rf "$RQ_DIR"
    return 0
}

# Runs the shell command $1 on the box and prints its output. Only for
# commands that change nothing there, or that leave the same state when run
# twice: a lost connection (exit 255) is tried again, up to
# PB_COMPACT_REMOTE_TRIES times. A try's output goes to a file and is printed
# only when the try is the last, so a try that broke off part way prints
# nothing.
remote_q() {
    [ -n "$RQ_DIR" ] || die "remote_q: no temp directory (rq_init was not called)"
    _rq_out="$RQ_DIR/remote.out"
    _rq_try=0
    while :; do
        _rq_try=$((_rq_try + 1))
        _rq_rc=0
        # $REMOTE_RUN is a command line; it is split into words on purpose.
        # shellcheck disable=SC2086
        $REMOTE_RUN "$1" </dev/null >"$_rq_out" || _rq_rc=$?
        if [ "$_rq_rc" != 255 ] || [ "$_rq_try" -ge "$REMOTE_TRIES" ]; then
            cat "$_rq_out"
            rm -f "$_rq_out"
            return "$_rq_rc"
        fi
        log "the remote command lost its connection (exit 255), try $_rq_try of $REMOTE_TRIES; trying again" >&2
        sleep 2
    done
}

# ---- the build lock ------------------------------------------------------------
# PB_DATA_DIR/compact/build.lock (and build.lock.takeover) is a symlink whose
# target names its holder:
#   <pid>                 compact-build.sh, running on the box
#   push.<expiry>.<id>    compact-push.sh, which may run on another machine;
#                         it holds the lock until <expiry> (unix seconds, the
#                         box's clock) and moves that on after every piece
# holder_alive is defined from this text here, and the push sends the same
# text with its lock commands, so both sides judge a holder the same way. A
# pid holds the lock only while it is a live compact-build process: a zombie
# (PocketBase is PID 1 and does not reap) or a reused pid does not.
# shellcheck disable=SC2016 # expanded where the function runs
LOCK_FUNCS='
holder_alive() {
    case "$1" in
        push.*)
            _ha_e=${1#push.}
            _ha_e=${_ha_e%%.*}
            case "$_ha_e" in "" | *[!0-9]*) return 1 ;; esac
            [ "$(date +%s)" -lt "$_ha_e" ]
            return
            ;;
        "" | *[!0-9]*) return 1 ;;
    esac
    _ha_proc=${PB_COMPACT_PROC_DIR:-/proc}
    if [ -d "$_ha_proc/1" ]; then
        [ -r "$_ha_proc/$1/status" ] || return 1
        grep -q "^State:[[:space:]]*Z" "$_ha_proc/$1/status" && return 1
        tr "\0" " " <"$_ha_proc/$1/cmdline" 2>/dev/null | grep -q compact-build
        return
    fi
    kill -0 "$1" 2>/dev/null
}'
eval "$LOCK_FUNCS"

# ---- checksums ------------------------------------------------------------------
# sha256sum must exist: a missing one would make every checksum an empty
# string, which reads as a mismatch (or worse, two empty strings as a match).
need_sha256sum() {
    _ns=$(printf x | sha256sum 2>/dev/null | cut -d' ' -f1) || _ns=""
    [ "$_ns" = 2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881 ] ||
        die "sha256sum is not installed or does not work (on macOS: brew install coreutils); it checks the manifest and the new file"
}

sha256_of() {
    sha256sum | cut -d' ' -f1
}

# Cheap identity of a database file: sha256 of its size and of 65 blocks of
# 64 KiB (64 spread over the file, and the last). It reads 4 MiB, not the
# file. It tells one build's file from another's (their rows, and so their
# pages, differ); it does not prove every byte, which the full sha256 does
# when the file is copied (compact-push.sh).
FP_BLOCK=65536
file_fingerprint() {
    _fp_size=$(file_size "$1") || return 1
    is_int "$_fp_size" && [ "$_fp_size" -gt 0 ] || return 1
    _fp_n=$(((_fp_size + FP_BLOCK - 1) / FP_BLOCK))
    {
        echo "$_fp_size"
        _fp_i=0
        while [ "$_fp_i" -lt 64 ]; do
            dd if="$1" bs=$FP_BLOCK skip=$((_fp_n * _fp_i / 64)) count=1 2>/dev/null || exit 1
            _fp_i=$((_fp_i + 1))
        done
        dd if="$1" bs=$FP_BLOCK skip=$((_fp_n - 1)) count=1 2>/dev/null
    } | sha256_of
}

# $1 as the path of a file: URI inside an SQL string literal. %, ? and # are
# percent-encoded (URI syntax), ' is doubled (SQL).
sql_uri_path() {
    printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/?/%3f/g' -e 's/#/%23/g' -e "s/'/''/g"
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

# Class of a table in the live database. Both pruned classes keep rowid >
# cut; the class is recorded in the manifest. A table in the insert-only list
# is treated as mutable when its PocketBase collection lets API clients
# update records (updateRule is not NULL, so not superuser-only).
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
