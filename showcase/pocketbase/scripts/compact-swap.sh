#!/bin/sh
# Cutover for the copy-and-swap compaction. entrypoint.sh runs this as root
# on every boot, before PocketBase starts, so PocketBase is not running while
# it works. With no flag set and no interrupted swap to finish, it exits 0 at
# once and touches nothing.
#
#   PB_COMPACT_SWAP=1      with a manifest from compact-build.sh present:
#                          copy the changes since the build into the new
#                          file, check it, and swap it in as data.db.
#   PB_COMPACT_ROLLBACK=1  put the newest data.db.pre-compact-<ts> back as
#                          data.db (the current file is kept as
#                          data.db.rolled-back-<ts>). Rows written after the
#                          swap are only in the rolled-back file. A rollback
#                          runs once: it writes compact/rollback.done, and
#                          while that file exists the flag does nothing. The
#                          next successful swap removes it.
#   PB_COMPACT_MAX_ATTEMPTS  how many boots may start the cutover for one
#                          manifest without it finishing (the boot was
#                          killed or timed out), default 3. After that the
#                          manifest is moved aside and data.db is not touched.
#
# Exit status:
#   0  PocketBase may start. data.db is the swapped-in file, or the file it
#      was before (any failed check leaves data.db as it was; the manifest is
#      then renamed to manifest.failed-<ts>, so the next boot does not try
#      again; run a new build first).
#   3  data.db is missing and could not be put back: a swap or rollback was
#      interrupted, or data.db is gone while compaction backups exist.
#      PocketBase must not start, or it would create an empty database in
#      place of the real one. entrypoint.sh stops the boot.
#   any other status is a crash of this script. entrypoint.sh then starts
#      PocketBase only if data.db exists and no rename was in progress.
#
# Every rename moves a main database file alone. Before it, the file's WAL is
# checkpointed with TRUNCATE and must be empty or absent, and its empty -wal
# and -shm are deleted. So a -wal can never end up next to the wrong file,
# whatever point the container dies at.
set -u

EXIT_NO_DB=3

# The common boot: no flag, no interrupted swap, data.db in place. Nothing
# below runs, not even the library, so a fault in it cannot block the boot.
_data_dir="${PB_DATA_DIR:-/pb_data}"
if [ "${PB_COMPACT_SWAP:-}" != 1 ] && [ "${PB_COMPACT_ROLLBACK:-}" != 1 ] &&
    [ ! -e "$_data_dir/compact/swap-in-progress" ] && [ ! -L "$_data_dir/compact/swap-in-progress" ] &&
    [ -e "$_data_dir/data.db" ]; then
    exit 0
fi

LIB_DIR=$(dirname "$(readlink -f "$0")")
# shellcheck source=compact-lib.sh
. "$LIB_DIR/compact-lib.sh"

TS=$(date -u +%Y%m%dT%H%M%SZ)
CHECK="${PB_COMPACT_CUTOVER_CHECK:-integrity}"
MAX_ATTEMPTS="${PB_COMPACT_MAX_ATTEMPTS:-3}"
ROLLBACK_DONE="$COMPACT_DIR/rollback.done"
# Return code of a step that may have left data.db missing. The top level
# then exits $EXIT_NO_DB so PocketBase does not start.
FATAL=3

err() {
    log "ERROR $*" >&2
}

# The most severe outcomes. On stderr, where log pipelines look for errors.
loud() {
    {
        log "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
        log "!!! $*"
        log "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    } >&2
}

# Run a command as the pocketbase user when we are root, so a -wal or -shm
# file it creates is never owned by root. Root without that user is refused,
# not run as root.
as_pb() {
    if [ "$(id -u)" != 0 ]; then
        "$@"
    elif id pocketbase >/dev/null 2>&1; then
        su-exec pocketbase:pocketbase "$@"
    else
        err "running as root but there is no pocketbase user; refusing to run $1 as root"
        return 1
    fi
}

sq() {
    as_pb sqlite3 -init /dev/null -batch -bail -noheader -cmd '.timeout 10000' -cmd '.output /dev/null' -cmd '.dbconfig dqs_ddl on' -cmd '.dbconfig dqs_dml on' -cmd '.output stdout' "$@"
}

# Renames the main database file $1 to $2, alone. $1's WAL must already be
# checkpointed: its -wal must be empty or absent. The empty -wal and the -shm
# (an index, never data) are deleted first, so no -wal is left to pair with
# the wrong file. Never overwrites: if $2, $2-wal or $2-shm exists, nothing
# happens. Returns 0 when moved, 1 when not moved, FATAL when the result is
# unclear (both or neither of the two paths exist).
move_db_file() {
    if [ ! -e "$1" ]; then
        err "cannot rename $1: it does not exist"
        return 1
    fi
    for _s in "" -wal -shm; do
        if [ -e "$2$_s" ] || [ -L "$2$_s" ]; then
            err "refusing to rename $1 to $2: $2$_s already exists"
            return 1
        fi
    done
    if [ -s "$1-wal" ]; then
        err "refusing to rename $1: its -wal is not empty (it was not checkpointed)"
        return 1
    fi
    rm -f "$1-wal" "$1-shm"
    if [ -e "$1-wal" ] || [ -e "$1-shm" ]; then
        err "could not delete the empty $1-wal or $1-shm"
        return 1
    fi
    mv "$1" "$2"
    if [ -e "$2" ] && [ ! -e "$1" ]; then
        return 0
    fi
    if [ -e "$1" ] && [ ! -e "$2" ]; then
        err "could not rename $1 to $2"
        return 1
    fi
    err "after renaming $1 to $2, $([ -e "$1" ] && echo both exist || echo neither exists)"
    return $FATAL
}

# Removes a -wal and -shm whose main file $1 does not exist. They cannot
# belong to anything. An empty -wal holds no data and a -shm never does, so
# both go. A -wal that holds data is kept, and this returns 1.
drop_orphan_sidecars() {
    [ -e "$1" ] && return 0
    if [ -s "$1-wal" ]; then
        loud "$1-wal holds data but $1 does not exist; it is kept for a manual look"
        return 1
    fi
    if [ -e "$1-wal" ] || [ -e "$1-shm" ]; then
        log "removing $1-wal/-shm left without their database file"
        rm -f "$1-wal" "$1-shm"
    fi
    return 0
}

# Writes a small file atomically (temp file, then rename). Its variable has
# its own name: sh has no local variables, and callers use _dest.
write_file() {
    _wf_path=$1
    shift
    if printf '%s\n' "$@" >"$_wf_path.tmp" && mv "$_wf_path.tmp" "$_wf_path"; then
        return 0
    fi
    rm -f "$_wf_path.tmp"
    err "could not write $_wf_path"
    return 1
}

# Nobody may have the live or the new file open. If the check itself cannot
# run (no /proc, no pidof), that is a failure too, never a pass.
no_holders() {
    _h=$(db_holders)
    _hrc=$?
    if [ "$_hrc" != 0 ]; then
        err "cannot check which processes have the database open: $_h"
        return 1
    fi
    if [ -n "$_h" ]; then
        err "another process has the live or the new database open: $(echo "$_h" | tr '\n' ' ')"
        return 1
    fi
    # pidof exits 0 when it finds a process and 1 when it finds none. Any
    # other status (127: pidof is missing) means we do not know.
    pidof pocketbase >/dev/null 2>&1
    _prc=$?
    case "$_prc" in
        0) err "a pocketbase process is running"; return 1 ;;
        1) ;;
        *) err "cannot check for a running pocketbase process (pidof exited $_prc; is it installed?)"; return 1 ;;
    esac
}

checkpoint_truncate() {
    # Folds the WAL into the main file and empties it. Same data, so this is
    # what PocketBase itself would do on a clean shutdown.
    _r=$(sq "$1" "PRAGMA main.wal_checkpoint(TRUNCATE);") || { err "wal_checkpoint(TRUNCATE) on $1 failed"; return 1; }
    case "$_r" in
        0\|*) ;;
        *) err "wal_checkpoint(TRUNCATE) on $1 returned '$_r' (busy)"; return 1 ;;
    esac
    [ "$(file_size "$1-wal")" = 0 ] || { err "$1-wal is not empty after the checkpoint"; return 1; }
}

# A query result that must be a whole number. $1 is live_q or new_q.
q_int() {
    _v=$("$1" "$2") || { err "query failed: $2"; return 1; }
    is_int "$_v" || { err "query returned '$_v', not a number: $2"; return 1; }
    echo "$_v"
}

# sha3 of a query's rows. $1 is live_q or new_q.
q_sha3() {
    _v=$("$1" "SELECT hex(sha3_query('$2'));") || { err "hash query failed: $2"; return 1; }
    is_sha3 "$_v" || { err "hash query returned '$_v': $2"; return 1; }
    echo "$_v"
}

# A datetime in PB's format for a unix time, checked.
pb_time_checked() {
    _pt=$(pb_time "$1") || return 1
    # shellcheck disable=SC2254 # the pattern is a glob on purpose
    case "$_pt" in
        $COMPACT_DATE_GLOB) echo "$_pt" ;;
        *) return 1 ;;
    esac
}

# ---- an interrupted swap or rollback -------------------------------------------
# Both are two renames, recorded first in $SWAP_MARKER, one item per line:
# the kind (swap or rollback), where data.db is moved to ($old), and the file
# that then becomes data.db ($incoming). Each rename moves a main file alone
# (see move_db_file), so the container can die in these states:
#
#   data.db  $old    $incoming  meaning
#   yes      no      any        the first rename did not happen: undone
#   no       yes     any        data.db was moved, the second rename did not
#                               happen: move $old back, undone
#   yes      yes     no         both renames happened: complete
#   yes      yes     yes        not a state the renames make: left as it is
#   no       no      any        data.db is lost: stop, fix by hand
#
# A -wal or -shm with no main file next to it is removed when it is empty
# (it was emptied before the rename that left it), and kept with a loud
# message when it holds data.
#
# Returns 0 when data.db is in place, FATAL when it is missing and could not
# be put back (the marker is then kept for the next boot).
recover_interrupted_swap() {
    [ -e "$SWAP_MARKER" ] || return 0
    _kind=$(sed -n 1p "$SWAP_MARKER")
    _old=$(sed -n 2p "$SWAP_MARKER")
    _incoming=$(sed -n 3p "$SWAP_MARKER")
    loud "found $SWAP_MARKER from an interrupted ${_kind:-swap} (data.db was to move to '$_old'; '$_incoming' was to become data.db)"
    case "$_kind" in swap | rollback) ;; *) _kind="" ;; esac
    case "$_old" in "$PB_DATA_DIR"/data.db.pre-compact-* | "$PB_DATA_DIR"/data.db.rolled-back-*) ;; *) _old="" ;; esac
    case "$_incoming" in "$NEW_DB" | "$PB_DATA_DIR"/data.db.pre-compact-*) ;; *) _incoming="" ;; esac
    if [ ! -e "$LIVE_DB" ]; then
        if [ -z "$_kind" ] || [ -z "$_old" ] || [ ! -e "$_old" ]; then
            loud "data.db is missing and the file it was moved to is not there to put back. Fix this by hand; $SWAP_MARKER is kept. PocketBase must not start."
            return $FATAL
        fi
        if ! drop_orphan_sidecars "$LIVE_DB"; then
            loud "data.db is missing and $LIVE_DB-wal holds data, so $_old cannot be put back next to it. Fix this by hand; $SWAP_MARKER is kept. PocketBase must not start."
            return $FATAL
        fi
        # Only an older version of this script moved a -wal along.
        if [ -s "$_old-wal" ] && ! checkpoint_truncate "$_old"; then
            loud "could not checkpoint $_old before putting it back. Fix this by hand; $SWAP_MARKER is kept. PocketBase must not start."
            return $FATAL
        fi
        if ! move_db_file "$_old" "$LIVE_DB" || [ ! -e "$LIVE_DB" ]; then
            loud "could not restore $_old to $LIVE_DB. Fix this by hand; $SWAP_MARKER is kept. PocketBase must not start."
            return $FATAL
        fi
        loud "restored $_old to $LIVE_DB; the $_kind did not happen"
        _outcome=undone
    elif [ -z "$_kind" ]; then
        loud "$SWAP_MARKER is not readable; data.db exists and stays as it is. The marker is kept as $SWAP_MARKER.bad-$TS."
        mv "$SWAP_MARKER" "$SWAP_MARKER.bad-$TS" || rm -f "$SWAP_MARKER"
        return 0
    elif [ -z "$_old" ] || [ ! -e "$_old" ]; then
        log "data.db was not moved; it is the file from before the $_kind, which did not happen"
        _outcome=undone
    elif [ -n "$_incoming" ] && [ ! -e "$_incoming" ]; then
        log "both renames had finished; the $_kind is complete"
        _outcome=complete
    else
        loud "data.db, $_old and ${_incoming:-the incoming file} all exist; the renames do not leave this state. data.db stays as it is and nothing is moved; the marker is kept as $SWAP_MARKER.bad-$TS."
        _outcome=unknown
    fi
    for _p in "$_old" "$_incoming"; do
        [ -n "$_p" ] && { drop_orphan_sidecars "$_p" || true; }
    done
    case "$_kind.$_outcome" in
        swap.complete)
            if [ -e "$MANIFEST" ]; then
                mv "$MANIFEST" "$COMPACT_DIR/manifest.done-$TS" || err "could not rename $MANIFEST to manifest.done-$TS"
            fi
            rm -f "$ROLLBACK_DONE"
            ;;
        swap.undone | swap.unknown)
            if [ -e "$MANIFEST" ]; then
                mv "$MANIFEST" "$MANIFEST.failed-$TS" || err "could not rename $MANIFEST to manifest.failed-$TS"
            fi
            ;;
        rollback.undone)
            rm -f "$ROLLBACK_DONE"
            ;;
    esac
    rm -f "$CUTOVER_ATTEMPTS"
    if [ "$_outcome" = unknown ]; then
        mv "$SWAP_MARKER" "$SWAP_MARKER.bad-$TS" || rm -f "$SWAP_MARKER"
    else
        rm -f "$SWAP_MARKER" || err "could not remove $SWAP_MARKER"
    fi
    sync
    return 0
}

# ---- rollback ----------------------------------------------------------------
# Returns 0 when rolled back or not needed, 1 when not done (data.db is as it
# was), FATAL when data.db may be missing.
rollback() {
    if [ -e "$ROLLBACK_DONE" ]; then
        loud "PB_COMPACT_ROLLBACK=1 but a rollback was already done ($(head -1 "$ROLLBACK_DONE")); doing nothing. Unset PB_COMPACT_ROLLBACK."
        return 0
    fi
    # The glob sorts by name, and the names end in a UTC timestamp, so the
    # last match is the newest.
    _prev=""
    for _f in "$PB_DATA_DIR"/data.db.pre-compact-*; do
        case "$_f" in *-wal | *-shm) continue ;; esac
        [ -e "$_f" ] && _prev=$_f
    done
    if [ -z "$_prev" ]; then
        log "PB_COMPACT_ROLLBACK=1 but there is no data.db.pre-compact-* file; nothing to roll back"
        return 0
    fi
    if [ ! -f "$LIVE_DB" ]; then
        loud "rollback NOT done: there is no $LIVE_DB"
        return $FATAL
    fi
    no_holders || { loud "rollback NOT done: the database is in use"; return 1; }
    # Both files are renamed below; each must have an empty WAL first.
    for _f in "$LIVE_DB" "$_prev"; do
        if ! checkpoint_truncate "$_f"; then
            loud "rollback NOT done: could not checkpoint $_f"
            return 1
        fi
    done
    _dest="$PB_DATA_DIR/data.db.rolled-back-$TS"
    if [ ! -d "$COMPACT_DIR" ]; then
        # The build later writes here as the pocketbase user.
        as_pb mkdir -p "$COMPACT_DIR" || { loud "rollback NOT done: could not create $COMPACT_DIR"; return 1; }
    fi
    # rollback.done goes first: if the boot dies part way, the next boot
    # must not start a second rollback. An undone rollback removes it.
    write_file "$ROLLBACK_DONE" "rolled back at $TS to $_prev; the file it replaced is $_dest" ||
        { loud "rollback NOT done: could not record it"; return 1; }
    if ! write_file "$SWAP_MARKER" rollback "$_dest" "$_prev"; then
        rm -f "$ROLLBACK_DONE"
        loud "rollback NOT done: could not write $SWAP_MARKER"
        return 1
    fi
    sync
    move_db_file "$LIVE_DB" "$_dest"
    _rc=$?
    if [ "$_rc" = 0 ]; then
        move_db_file "$_prev" "$LIVE_DB"
        _rc=$?
        [ "$_rc" = 0 ] || _what="could not rename $_prev to $LIVE_DB"
    else
        _what="could not rename $LIVE_DB"
    fi
    if [ "$_rc" != 0 ]; then
        [ "$_rc" = "$FATAL" ] && return $FATAL
        recover_interrupted_swap || return $FATAL
        loud "rollback NOT done: $_what; data.db is the file it was before"
        return 1
    fi
    sync
    rm -f "$SWAP_MARKER" || err "could not remove $SWAP_MARKER"
    sync
    loud "ROLLED BACK: $LIVE_DB is now $_prev; the file it replaced is $_dest. Unset PB_COMPACT_ROLLBACK."
    return 0
}

# A pruned table must not have a row written after the build at a rowid at
# or below the build's top rowid. SQLite gives a new row max(rowid) + 1, so
# once every row above some point was deleted, new rows reuse rowids there.
# Such rows sit below the copy range (a mutable table copies rowid > cut, an
# insert-only one rowid > snapshot top), so they would be dropped without a
# trace. A reused rowid is always above every older row that is left, so
# the top row at or below the snapshot top tells: it is the snapshot's own
# top row (same id), or a row written before the snapshot, or there is none.
# Returns 1, with the reason logged, otherwise. A NULL id or `created` cannot
# tell, so it also returns 1.
check_rowid_reuse() {
    _t=$1
    _snap=$2
    _sid=$3
    _before=$4
    [ "$_snap" -gt 0 ] || return 0
    # Each field is COALESCEd: one NULL would make the whole line NULL, which
    # the CLI prints as an empty line, the same as "no row".
    _top=$(live_q "SELECT rowid || '|' || COALESCE(created >= '$_before', 'null') || '|' || COALESCE(created GLOB '$COMPACT_DATE_GLOB', 'null')
                          || '|' || (id IS NULL) || '|' || COALESCE(id, '')
                   FROM \"$_t\" WHERE rowid <= $_snap ORDER BY rowid DESC LIMIT 1;") ||
        { err "could not read the top row of $_t at or below rowid $_snap"; return 1; }
    if [ -z "$_top" ]; then
        # No row at or below the snapshot top. Asked again on its own, so an
        # empty answer for any other reason is not taken as "none".
        _any=$(q_int live_q "SELECT EXISTS (SELECT 1 FROM \"$_t\" WHERE rowid <= $_snap);") || return 1
        [ "$_any" = 0 ] && return 0
        err "could not read the top row of $_t at or below rowid $_snap (empty result, but rows exist); not swapping"
        return 1
    fi
    _r=${_top%%|*}
    _rest=${_top#*|}
    _late=${_rest%%|*}
    _rest=${_rest#*|}
    _wf=${_rest%%|*}
    _rest=${_rest#*|}
    _idnull=${_rest%%|*}
    _id=${_rest#*|}
    if [ "$_idnull" != 0 ]; then
        err "$_t rowid $_r (at or below the build's top rowid $_snap) has a NULL id, so a reused rowid cannot be ruled out; not swapping"
        return 1
    fi
    if [ "$_r" = "$_snap" ]; then
        [ -n "$_sid" ] && [ "$_id" = "$_sid" ] && return 0
        err "$_t rowid $_snap is '$_id' in live but was '$_sid' at the build: the rowid was reused after the build. Rows at reused rowids would be lost; not swapping"
        return 1
    fi
    # The snapshot's top row is gone (the retention hook ages it out on a
    # quiet table). The row now on top must be older than the snapshot.
    if [ "$_late" = null ] || [ "$_wf" = null ]; then
        err "$_t rowid $_r (below the build's top rowid $_snap, which is gone) has a NULL created, so it may have been written after the build at a reused rowid. Rows at reused rowids would be lost; not swapping"
        return 1
    fi
    if [ "$_wf" != 1 ] || [ "$_late" != 0 ]; then
        err "$_t rowid $_r (below the build's top rowid $_snap, which is gone) was written after the build: its rowid was reused. Rows at reused rowids would be lost; not swapping"
        return 1
    fi
    return 0
}

# The build dropped the rows of table $1 created before (build time - $2
# days). A longer window now would keep some of those rows; they are only in
# the live file, so the swap would lose them. A shorter window is fine: the
# retention hook deletes the extra rows later.
check_window() {
    _now_days=$(window_days "$1") || { err "could not read the retention window of $1"; return 1; }
    if [ "$_now_days" -gt "$2" ]; then
        _wvar="PB_RETENTION_$(echo "$1" | tr '[:lower:]' '[:upper:]')_DAYS"
        _wcut=$(manifest_get "table.$1.cutoff") || _wcut="(not recorded)"
        err "$_wvar is $_now_days now, but the build kept only $2 days of $1 (it dropped the rows created before $_wcut). Those rows would be lost; not swapping. Run a new build with the new window"
        return 1
    fi
    return 0
}

# ---- cutover -----------------------------------------------------------------
# Returns 0 when swapped in, 1 when not (data.db is as it was), FATAL when
# data.db may be missing.
cutover() {
    started=$(date +%s)
    log "cutover start (manifest $MANIFEST)"

    # The manifest's last line is the sha256 of every line above it.
    _want=$(sed -n '$s/^sha256=//p' "$MANIFEST")
    _have=$(sed '$d' "$MANIFEST" | sha256sum | cut -d' ' -f1)
    [ -n "$_want" ] && [ "$_want" = "$_have" ] || { err "manifest checksum mismatch (want '$_want', have '$_have')"; return 1; }
    [ -f "$NEW_DB" ] || { err "$NEW_DB is missing"; return 1; }
    [ -f "$LIVE_DB" ] || { err "$LIVE_DB is missing"; return 1; }
    no_holders || return 1

    checkpoint_truncate "$LIVE_DB" || return 1
    checkpoint_truncate "$NEW_DB" || return 1
    log "checkpointed live and new; live=$(human "$(file_size "$LIVE_DB")") new=$(human "$(file_size "$NEW_DB")")"

    # The schema (every table, index, view and trigger, plus PB's own `_`
    # tables) must match the build's snapshot and the new file exactly.
    _ms=$(manifest_get schema_sha3) || { err "manifest has no schema_sha3"; return 1; }
    is_sha3 "$_ms" || { err "manifest schema_sha3 is not a hash: '$_ms'"; return 1; }
    _ls=$(schema_hash "$LIVE_DB") || { err "could not hash the live schema"; return 1; }
    _ns=$(schema_hash "$NEW_DB") || { err "could not hash the new schema"; return 1; }
    if [ "$_ls" != "$_ms" ] || [ "$_ns" != "$_ms" ]; then
        err "schema changed since the build (manifest $_ms, live $_ls, new $_ns)"
        schema_list "$LIVE_DB" >"$COMPACT_DIR/schema.live.cutover"
        schema_list "$NEW_DB" >"$COMPACT_DIR/schema.new.cutover"
        diff "$COMPACT_DIR/schema.live.cutover" "$COMPACT_DIR/schema.new.cutover" | head -40
        return 1
    fi
    _lh=$(header_pragmas "$LIVE_DB") || { err "could not read the live header pragmas"; return 1; }
    _nh=$(header_pragmas "$NEW_DB") || { err "could not read the new header pragmas"; return 1; }
    [ -n "$_lh" ] && [ "$_lh" = "$_nh" ] || { err "header pragmas differ: live=[$_lh] new=[$_nh]"; return 1; }

    # The live tables and the manifest's tables must be the same set: each
    # live table is looked up in the manifest below, and the counts match.
    inventory=$(table_inventory "$LIVE_DB") || return 1
    [ -n "$inventory" ] || { err "the live database lists no tables"; return 1; }
    _n_live=$(printf '%s\n' "$inventory" | grep -c .)
    _n_man=$(grep -c '^table\.[A-Za-z0-9_]*\.class=' "$MANIFEST")
    [ "$_n_live" = "$_n_man" ] || { err "the live database has $_n_live tables, the manifest $_n_man"; return 1; }
    now_s=$(date +%s)
    # Rows written after the snapshot have a `created` at or after this
    # (the order checks allow COMPACT_SKEW_S of jitter).
    _snap_s=$(manifest_get snapshot_s) || { err "manifest has no snapshot_s"; return 1; }
    is_int "$_snap_s" || { err "manifest snapshot_s is not a number: '$_snap_s'"; return 1; }
    _reuse_before=$(pb_time_checked $((_snap_s - COMPACT_SKEW_S))) ||
        { err "could not compute the build snapshot time for the rowid reuse check"; return 1; }

    # Build one transaction: drop the triggers (so the copies do not fire
    # them), copy, put the triggers back from the live schema.
    sql="$COMPACT_DIR/cutover.sql"
    _drops=$(new_q "SELECT 'DROP TRIGGER \"' || name || '\";' FROM sqlite_schema WHERE type = 'trigger';") ||
        { err "could not list the triggers of the new file"; return 1; }
    _trg=$(live_q "SELECT sql || ';' FROM sqlite_schema WHERE type = 'trigger' ORDER BY rowid;") ||
        { err "could not read the live triggers"; return 1; }
    {
        echo "PRAGMA foreign_keys = OFF;"
        echo "ATTACH 'file:$LIVE_DB?mode=ro' AS live;"
        echo "BEGIN IMMEDIATE;"
        printf '%s\n' "$_drops"
    } >"$sql" || return 1

    has_sequence=0
    for line in $inventory; do
        t=${line%%|*}
        cls=$(echo "$line" | cut -d'|' -f2)
        wr=$(echo "$line" | cut -d'|' -f3)
        _mcls=$(manifest_get "table.$t.class") || { err "table $t is not in the manifest"; return 1; }
        [ "$_mcls" = "$cls" ] || { err "table $t class changed ($_mcls -> $cls)"; return 1; }
        if [ "$t" = sqlite_sequence ]; then
            # Copied after every other table, see below.
            has_sequence=1
            continue
        fi
        cols=$(column_list "$LIVE_DB" "$t") || return 1
        if [ "$wr" = 1 ]; then
            rc="$cols"
        else
            rc="rowid,$cols"
        fi
        case "$cls" in
        whole)
            echo "DELETE FROM main.\"$t\";"
            echo "INSERT INTO main.\"$t\" ($rc) SELECT $rc FROM live.\"$t\";"
            ;;
        mutable)
            cut=$(manifest_get "table.$t.cut_rowid")
            snap=$(manifest_get "table.$t.snapshot_max_rowid")
            sid=$(manifest_get "table.$t.snapshot_id")
            days=$(manifest_get "table.$t.window_days")
            for _v in "$cut" "$snap" "$days"; do
                is_int "$_v" || { err "bad manifest value for $t: '$_v'"; return 1; }
            done
            check_window "$t" "$days" || return 1
            check_rowid_reuse "$t" "$snap" "$sid" "$_reuse_before" || return 1
            echo "DELETE FROM main.\"$t\" WHERE rowid > $cut;"
            echo "INSERT INTO main.\"$t\" ($rc) SELECT $rc FROM live.\"$t\" WHERE rowid > $cut ORDER BY rowid;"
            ;;
        append)
            cut=$(manifest_get "table.$t.cut_rowid")
            snap=$(manifest_get "table.$t.snapshot_max_rowid")
            sid=$(manifest_get "table.$t.snapshot_id")
            days=$(manifest_get "table.$t.window_days")
            for _v in "$cut" "$snap" "$days"; do
                is_int "$_v" || { err "bad manifest value for $t: '$_v'"; return 1; }
            done
            check_window "$t" "$days" || return 1
            # Rows up to the snapshot top are not copied again, so none of
            # them may be a row written since the build at a reused rowid.
            # The snapshot top row itself may be gone: the retention hook
            # ages it out of a quiet table, and the band below handles that.
            check_rowid_reuse "$t" "$snap" "$sid" "$_reuse_before" || return 1
            # The retention hook keeps deleting the oldest rows while the
            # build waits. Those deletes fall in a band just above the cut:
            # up to (now - window + 10 min). Drop from the new file every row
            # of that band that the live file no longer has. Any other
            # delete shows up in the count check below and stops the swap.
            band_ts=$(pb_time_checked $((now_s - days * 86400 + 600))) ||
                { err "could not compute the retention band time for $t"; return 1; }
            band_hi=$(live_q "SELECT COALESCE((SELECT rowid FROM \"$t\" WHERE rowid > $cut AND created >= '$band_ts' ORDER BY rowid LIMIT 1), $snap);")
            is_int "$band_hi" || { err "band search failed for $t"; return 1; }
            [ "$band_hi" -gt "$snap" ] && band_hi=$snap
            echo "DELETE FROM main.\"$t\" WHERE rowid > $cut AND rowid <= $band_hi AND rowid NOT IN (SELECT rowid FROM live.\"$t\" WHERE rowid > $cut AND rowid <= $band_hi);"
            echo "INSERT INTO main.\"$t\" ($rc) SELECT $rc FROM live.\"$t\" WHERE rowid > $snap ORDER BY rowid;"
            ;;
        esac >>"$sql"
    done
    {
        # sqlite_sequence last: the explicit-rowid inserts into AUTOINCREMENT
        # tables above write their own rows into it. Copied by name, without
        # rowid, and checked the same way.
        if [ "$has_sequence" = 1 ]; then
            echo "DELETE FROM main.sqlite_sequence;"
            echo "INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM live.sqlite_sequence;"
        fi
        printf '%s\n' "$_trg"
        echo "COMMIT;"
    } >>"$sql" || return 1

    delta_started=$(date +%s)
    as_pb sqlite3 -init /dev/null -batch -bail -noheader -cmd '.timeout 10000' -cmd '.output /dev/null' -cmd '.dbconfig dqs_ddl on' -cmd '.dbconfig dqs_dml on' -cmd '.output stdout' "$NEW_DB" <"$sql" >/dev/null || { err "the delta copy failed"; return 1; }
    log "delta copied in $(($(date +%s) - delta_started))s"

    # ---- verify ----
    # Every query result is checked: a failed query is a failed check, never
    # an empty string that equals another empty string.
    verify_started=$(date +%s)
    _ns=$(schema_hash "$NEW_DB") || { err "could not hash the new schema after the delta copy"; return 1; }
    [ "$_ns" = "$_ms" ] || { err "the new schema changed during the delta copy"; return 1; }
    _nh=$(header_pragmas "$NEW_DB") || { err "could not read the new header pragmas after the delta copy"; return 1; }
    [ "$_nh" = "$_lh" ] || { err "header pragmas differ after the delta copy"; return 1; }
    _verified=0
    for line in $inventory; do
        t=${line%%|*}
        cls=$(echo "$line" | cut -d'|' -f2)
        wr=$(echo "$line" | cut -d'|' -f3)
        case "$cls" in
        whole)
            if [ "$t" = sqlite_sequence ]; then
                q="SELECT name, seq FROM sqlite_sequence ORDER BY name"
            elif [ "$wr" = 1 ]; then
                q="SELECT * FROM \"$t\""
            else
                q="SELECT rowid,* FROM \"$t\" ORDER BY rowid"
            fi
            lc=$(q_int live_q "SELECT count(*) FROM \"$t\";") || return 1
            nc=$(q_int new_q "SELECT count(*) FROM \"$t\";") || return 1
            lh=$(q_sha3 live_q "$q") || return 1
            nh=$(q_sha3 new_q "$q") || return 1
            [ "$lc" = "$nc" ] && [ "$lh" = "$nh" ] || { err "$t differs: live rows=$lc sha3=$lh, new rows=$nc sha3=$nh"; return 1; }
            log "verified table=$t class=whole rows=$nc sha3=$(echo "$nh" | cut -c1-16)"
            ;;
        mutable | append)
            cut=$(manifest_get "table.$t.cut_rowid")
            snap=$(manifest_get "table.$t.snapshot_max_rowid")
            if ! is_int "$cut" || ! is_int "$snap"; then
                err "bad manifest values for $t: cut '$cut' snapshot '$snap'"
                return 1
            fi
            # Counted on the primary-key index: it holds every rowid and is
            # far smaller than the table, so this does not read row data.
            pk=$(pk_index "$LIVE_DB" "$t") || { err "could not read the primary key index of $t"; return 1; }
            by=""
            is_ident "$pk" && by="INDEXED BY \"$pk\""
            lc=$(q_int live_q "SELECT count(*) FROM \"$t\" $by WHERE rowid > $cut;") || return 1
            nc=$(q_int new_q "SELECT count(*) FROM \"$t\" $by WHERE rowid > $cut;") || return 1
            [ "$lc" = "$nc" ] || { err "$t kept rows differ: live=$lc new=$nc (rowid > $cut)"; return 1; }
            old=$(q_int new_q "SELECT count(*) FROM \"$t\" WHERE rowid <= $cut;") || return 1
            [ "$old" = 0 ] || { err "$t new file has $old rows at or below the cut"; return 1; }
            # Content hash of the part this cutover copied: every kept row
            # of a mutable table, the rows above the snapshot of an
            # insert-only one.
            from=$cut
            [ "$cls" = append ] && from=$snap
            q="SELECT rowid,* FROM \"$t\" WHERE rowid > $from ORDER BY rowid"
            lh=$(q_sha3 live_q "$q") || return 1
            nh=$(q_sha3 new_q "$q") || return 1
            [ "$lh" = "$nh" ] || { err "$t rows above rowid $from differ in content"; return 1; }
            # The top kept row. Empty only when no row is kept, on both sides.
            ltop=$(live_q "SELECT rowid || ':' || id FROM \"$t\" WHERE rowid > $cut ORDER BY rowid DESC LIMIT 1;") || { err "could not read the top row of $t (live)"; return 1; }
            ntop=$(new_q "SELECT rowid || ':' || id FROM \"$t\" WHERE rowid > $cut ORDER BY rowid DESC LIMIT 1;") || { err "could not read the top row of $t (new)"; return 1; }
            [ -n "$ltop" ] || [ "$lc" = 0 ] || { err "$t has $lc kept rows but no top row"; return 1; }
            [ "$ltop" = "$ntop" ] || { err "$t top row differs: live=$ltop new=$ntop"; return 1; }
            log "verified table=$t class=$cls kept_rows=$nc (rowid > $cut) copied_now_from_rowid=$from"
            ;;
        *)
            err "table $t has an unknown class '$cls'"
            return 1
            ;;
        esac
        _verified=$((_verified + 1))
    done
    [ "$_verified" = "$_n_live" ] && [ "$_verified" -gt 0 ] || { err "verified $_verified of $_n_live tables"; return 1; }
    case "$CHECK" in
        integrity) ic=$(new_q "PRAGMA integrity_check;") ;;
        *) ic=$(new_q "PRAGMA quick_check;") ;;
    esac || { err "${CHECK}_check on the new file failed to run"; return 1; }
    [ "$ic" = ok ] || { err "${CHECK}_check on the new file: $(echo "$ic" | head -5)"; return 1; }
    jm=$(new_q "PRAGMA journal_mode;") || { err "could not read the journal mode of the new file"; return 1; }
    [ "$jm" = wal ] || { err "the new file is not in WAL mode"; return 1; }
    log "verified $_verified tables in $(($(date +%s) - verify_started))s (${CHECK}_check ok)"

    # ---- swap ----
    # Nobody may hold either file, or any -wal or -shm of them, open: the
    # empty -wal and -shm are deleted by the renames below.
    no_holders || { err "not swapping"; return 1; }
    # Both files are renamed below. Each one's WAL is folded into it and
    # must be empty: the verified rows may still be in the new file's WAL.
    checkpoint_truncate "$LIVE_DB" || { err "the live file's WAL could not be folded in; not swapping"; return 1; }
    checkpoint_truncate "$NEW_DB" || { err "the new file's WAL could not be folded in; not swapping"; return 1; }
    old="$PB_DATA_DIR/data.db.pre-compact-$TS"
    write_file "$SWAP_MARKER" swap "$old" "$NEW_DB" || return 1
    sync
    move_db_file "$LIVE_DB" "$old"
    _rc=$?
    if [ "$_rc" = 0 ]; then
        move_db_file "$NEW_DB" "$LIVE_DB"
        _rc=$?
    fi
    if [ "$_rc" != 0 ]; then
        [ "$_rc" = "$FATAL" ] && return $FATAL
        recover_interrupted_swap || return $FATAL
        return 1
    fi
    # The renames reach the disk before the marker that records them goes.
    sync
    rm -f "$SWAP_MARKER" "$ROLLBACK_DONE" || err "could not remove $SWAP_MARKER or $ROLLBACK_DONE"
    sync
    if [ "$(id -u)" = 0 ]; then
        chown pocketbase:pocketbase "$LIVE_DB" || err "could not chown $LIVE_DB to pocketbase; PocketBase may fail to open it"
    fi
    mv "$MANIFEST" "$COMPACT_DIR/manifest.done-$TS" ||
        err "could not rename $MANIFEST to manifest.done-$TS; a later boot with PB_COMPACT_SWAP=1 will find no new file and burn it"
    loud "COMPACTION SWAPPED IN: data.db $(human "$(file_size "$old")") -> $(human "$(file_size "$LIVE_DB")") in $(($(date +%s) - started))s; old file kept as $old. Unset PB_COMPACT_SWAP."
    return 0
}

# data.db must exist whenever compaction left files behind; if it does not,
# PocketBase would create an empty database next to them.
require_live_db() {
    [ -e "$LIVE_DB" ] && return 0
    for _f in "$PB_DATA_DIR"/data.db.pre-compact-* "$PB_DATA_DIR"/data.db.rolled-back-* "$SWAP_MARKER"; do
        if [ -e "$_f" ]; then
            loud "$LIVE_DB is missing but compaction files exist ($_f). PocketBase must not start; put the right file back as data.db by hand."
            exit $EXIT_NO_DB
        fi
    done
    return 0
}

recover_interrupted_swap || exit $EXIT_NO_DB
require_live_db

if [ "${PB_COMPACT_ROLLBACK:-}" = 1 ]; then
    if [ "${PB_COMPACT_SWAP:-}" = 1 ]; then
        log "PB_COMPACT_SWAP=1 is ignored because PB_COMPACT_ROLLBACK=1 is set"
    fi
    rollback
    [ $? = "$FATAL" ] && exit $EXIT_NO_DB
    require_live_db
    exit 0
fi

[ "${PB_COMPACT_SWAP:-}" = 1 ] || exit 0
if [ ! -e "$MANIFEST" ]; then
    log "PB_COMPACT_SWAP=1 but there is no manifest at $MANIFEST; nothing to swap"
    exit 0
fi
case "$CHECK" in
    integrity | quick) ;;
    *)
        loud "PB_COMPACT_CUTOVER_CHECK=$CHECK is not integrity or quick; no swap. The manifest is kept; fix the setting and restart."
        exit 0
        ;;
esac
if ! is_count "$MAX_ATTEMPTS" || [ "$MAX_ATTEMPTS" -lt 1 ]; then
    loud "PB_COMPACT_MAX_ATTEMPTS=$MAX_ATTEMPTS is not a whole number of at least 1; no swap. The manifest is kept; fix the setting and restart."
    exit 0
fi

# ---- attempt record ------------------------------------------------------------
# A cutover that is killed before its renames (a healthcheck or stop timeout
# during the delta copy or integrity_check) leaves no marker, and the
# manifest stays. Without a record every boot would start it again, maybe
# forever. $CUTOVER_ATTEMPTS holds the manifest's checksum and how many boots
# started a cutover for it; it is removed when a cutover returns.
_msum=$(sed -n '$s/^sha256=//p' "$MANIFEST")
_tried=0
if [ -f "$CUTOVER_ATTEMPTS" ]; then
    _rec=$(head -1 "$CUTOVER_ATTEMPTS")
    if [ -n "$_msum" ] && [ "${_rec%% *}" = "$_msum" ] && is_count "${_rec#* }"; then
        _tried=${_rec#* }
    else
        log "ignoring $CUTOVER_ATTEMPTS: it is for another manifest ('$_rec')"
    fi
fi
if [ "$_tried" -ge "$MAX_ATTEMPTS" ]; then
    _note="manifest moved to manifest.failed-$TS"
    mv "$MANIFEST" "$MANIFEST.failed-$TS" || _note="the manifest could NOT be moved aside"
    rm -f "$CUTOVER_ATTEMPTS"
    loud "COMPACTION CUTOVER NOT TRIED: $_tried earlier boots started it for this manifest and none finished (the boot was killed or timed out). data.db is unchanged and PocketBase starts on it. $_note. Find out what stops the boot (healthcheck, stop timeout) before building again."
    exit 0
fi
if [ "$_tried" -gt 0 ]; then
    loud "the cutover for this manifest was started $_tried time(s) before and did not finish (the boot was killed or timed out)"
fi
_try=$((_tried + 1))
if ! write_file "$CUTOVER_ATTEMPTS" "$_msum $_try"; then
    loud "could not record the cutover attempt in $CUTOVER_ATTEMPTS, so retries could not be bounded; no swap. data.db is unchanged. The manifest is kept."
    exit 0
fi
sync
log "cutover attempt $_try of $MAX_ATTEMPTS"

# Subshell, so a `die` inside a helper ends only the cutover.
(cutover)
rc=$?
rm -f "$CUTOVER_ATTEMPTS"
if [ "$rc" != 0 ]; then
    # A step that failed between the renames left the marker behind.
    recover_interrupted_swap || exit $EXIT_NO_DB
    # Decided on what recovery left, not on rc: a rename with an unclear
    # result (FATAL) may have left data.db in place, or recovery put it back.
    if [ ! -e "$LIVE_DB" ]; then
        loud "COMPACTION CUTOVER FAILED and $LIVE_DB is missing. PocketBase must not start."
        exit $EXIT_NO_DB
    fi
    if [ "$rc" = "$FATAL" ]; then
        loud "a rename during the cutover had an unclear result; $LIVE_DB is in place after the recovery above"
    fi
    note="the manifest was already moved aside"
    if [ -e "$MANIFEST" ]; then
        if mv "$MANIFEST" "$MANIFEST.failed-$TS"; then
            note="manifest moved to manifest.failed-$TS"
        else
            note="the manifest could NOT be moved aside, so the next boot with PB_COMPACT_SWAP=1 tries again"
        fi
    fi
    loud "COMPACTION CUTOVER FAILED; data.db is the file from before the swap and PocketBase starts on it. $note; run a new build before trying again."
fi
exit 0
