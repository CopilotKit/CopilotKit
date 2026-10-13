#!/bin/sh
# Copies a finished compaction build onto the PocketBase volume. The build
# (compact-build.sh) made data.db.new and its manifest in PB_COMPACT_OUT_DIR;
# this writes them to the compact directory next to the live database, where
# the swap looks: restart PocketBase with PB_COMPACT_SWAP=1 afterwards.
#
#   on the box, after a build in /tmp (compact-build.sh runs this itself):
#     PB_COMPACT_OUT_DIR=/tmp/pbcompact compact-push.sh
#   from another machine, after an off-box build:
#     PB_COMPACT_REMOTE=... PB_DATA_DIR=<local dir> compact-push.sh
#
# The live database is never written. On the box, this writes only:
#   compact/build.lock           held for the whole copy (see compact-lib.sh)
#   compact/data.db.new.upload   the file as it arrives
#   compact/upload.id            the sha256 of the manifest it belongs to
#   compact/data.db.new, compact/manifest   at the end, by rename
#   PB_COMPACT_REMOTE_TMP/pb-compact-piece.*   off-box only: one piece at a
#                                time (default /tmp, off the volume)
# Any manifest already on the box is removed first, so a restart during the
# copy cannot swap in a half-copied file.
#
# The file goes in pieces of PB_COMPACT_PIECE_MB (default 64), written into
# the upload file PB_COMPACT_BLOCK_MB (default 4) at a time, each block
# flushed to disk (conv=fsync) and followed by a pause, so the volume sees
# about PB_COMPACT_WRITE_MBPS (default 40) MB/s and never a burst of more than
# one block. Each written piece is read back and checked by sha256, so every
# byte on the volume is checked; the whole local file is checked against the
# build's sha256 first. Off the box, each piece is first sent gzip'd to
# PB_COMPACT_REMOTE_TMP and checked by sha256 there.
#
# Every write step on the box leaves the same state when it runs twice. After
# a lost connection (exit 255) the push reads the state on the box and goes
# on when the step is done, or runs it again. A run that stops part way
# resumes on the next run: pieces already checked for this manifest are
# skipped. A different build starts the copy over.
#
# Refuses when: the manifest checksum does not match; the local file is not
# the size and sha256 the manifest says; another build or push holds the lock
# on the box; a swap is in progress there; the live schema changed since the
# build; or the box has less free space than the rest of the file plus the
# floor (PB_COMPACT_MIN_FREE_MB, default 2048, plus 10% of the live file).
set -eu

LIB_DIR=$(dirname "$(readlink -f "$0")")
# shellcheck source=compact-lib.sh
. "$LIB_DIR/compact-lib.sh"

PIECE_MB="${PB_COMPACT_PIECE_MB:-64}"
BLOCK_MB="${PB_COMPACT_BLOCK_MB:-4}"
WRITE_MBPS="${PB_COMPACT_WRITE_MBPS:-40}"
MIN_FREE_MB="${PB_COMPACT_MIN_FREE_MB:-2048}"
LOCK_TTL_S="${PB_COMPACT_LOCK_TTL_S:-600}"
RTMP="${PB_COMPACT_REMOTE_TMP:-/tmp}"
for _v in PIECE_MB BLOCK_MB WRITE_MBPS MIN_FREE_MB LOCK_TTL_S; do
    _val=""
    eval "_val=\$$_v"
    is_count "$_val" || die "PB_COMPACT_$_v=$_val is not a whole number (digits only, no leading zero)"
done
[ "$PIECE_MB" -ge 1 ] && [ "$BLOCK_MB" -ge 1 ] && [ "$WRITE_MBPS" -ge 1 ] ||
    die "PB_COMPACT_PIECE_MB, PB_COMPACT_BLOCK_MB and PB_COMPACT_WRITE_MBPS must be at least 1"
[ $((PIECE_MB % BLOCK_MB)) = 0 ] || die "PB_COMPACT_PIECE_MB must be a multiple of PB_COMPACT_BLOCK_MB"
[ "$LOCK_TTL_S" -ge 60 ] || die "PB_COMPACT_LOCK_TTL_S must be at least 60"
need_sha256sum
BLOCK=$((BLOCK_MB * 1048576))
PIECE=$((PIECE_MB * 1048576))
BLOCKS_PER_PIECE=$((PIECE_MB / BLOCK_MB))
# Pause after each block: the time one block takes at WRITE_MBPS.
BLOCK_PAUSE=$(awk -v b="$BLOCK_MB" -v r="$WRITE_MBPS" 'BEGIN { printf "%.3f\n", b / r }')

SRC_DB="$OUT_DIR/data.db.new"
SRC_MAN="$OUT_DIR/manifest"
RDIR="$(dirname "$LIVE_DB")/compact"
R_UP="$RDIR/data.db.new.upload"
R_ID="$RDIR/upload.id"
R_NEW="$RDIR/data.db.new"
R_MAN="$RDIR/manifest"
R_LOCK="$RDIR/build.lock"
R_PIECE="$RTMP/pb-compact-piece"
DONE_FILE="$OUT_DIR/push.done"
L_PIECE="$OUT_DIR/push.piece"
# Set by compact-build.sh, which holds the lock and runs this to land its
# build: the lock is then the build's (its pid), not taken again here.
LOCK_HELD="${PB_COMPACT_LOCK_HELD:-}"

if [ -z "$REMOTE" ]; then
    [ -d "$RDIR" ] || mkdir -p "$RDIR"
    _src=$(cd "$OUT_DIR" 2>/dev/null && pwd -P) || die "no build directory $OUT_DIR"
    _dst=$(cd "$RDIR" && pwd -P)
    [ "$_src" != "$_dst" ] || die "the build in $OUT_DIR is already in the compact directory; there is nothing to copy"
    WHERE="to $RDIR"
else
    WHERE="to $RDIR on the box (via $REMOTE)"
fi

OWN_LOCK=0
on_exit() {
    _rc=$?
    set +e
    rm -f "$L_PIECE.raw" "$L_PIECE.gz"
    if [ "$OWN_LOCK" = 1 ]; then
        remote_q "$(lock_sh); release" >/dev/null 2>&1 ||
            log "could not release $R_LOCK on the box; it expires within ${LOCK_TTL_S}s" >&2
    fi
    rq_cleanup
    [ "$_rc" = 0 ] || log "ERROR push stopped (exit $_rc). The live database is untouched and no manifest was published by this run; run compact-push.sh again to resume." >&2
    return 0
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
rq_init

# Runs shell command $2 on the box with file $1 as its stdin. Every command
# sent this way can run twice with the same result, so a lost connection
# (exit 255) is tried again.
remote_in() {
    _ri_try=0
    while :; do
        _ri_try=$((_ri_try + 1))
        _ri_rc=0
        # shellcheck disable=SC2086 # $REMOTE_RUN is a command line
        _ri_out=$($REMOTE_RUN "$2" <"$1") || _ri_rc=$?
        if [ "$_ri_rc" != 255 ] || [ "$_ri_try" -ge "$REMOTE_TRIES" ]; then
            printf '%s\n' "$_ri_out"
            return "$_ri_rc"
        fi
        log "the remote command lost its connection (exit 255), try $_ri_try of $REMOTE_TRIES; trying again" >&2
        sleep 2
    done
}

# A write step on the box: $2 is a command that leaves the same state when it
# runs twice and prints $4 when the state is reached; $3 is a read-only
# command that prints $4 when the state is already there. $1 names the step.
# The step runs once per try. After a lost connection (exit 255) the box is
# asked: if the state is there the step is done, otherwise it runs again.
# Any other failure stops the push.
remote_step() {
    _rs_try=0
    while :; do
        _rs_try=$((_rs_try + 1))
        _rs_rc=0
        # shellcheck disable=SC2086 # $REMOTE_RUN is a command line
        _rs_out=$($REMOTE_RUN "$2" </dev/null) || _rs_rc=$?
        if [ "$_rs_rc" = 0 ] && [ "$_rs_out" = "$4" ]; then
            return 0
        fi
        [ "$_rs_rc" = 255 ] || die "$1 failed on the box (exit $_rs_rc): $(printf '%s' "$_rs_out" | tail -n 3 | tr '\n' ' ')"
        log "$1: the connection was lost (exit 255); reading the state on the box" >&2
        _rs_state=$(remote_q "$3") || _rs_state=""
        if [ "$_rs_state" = "$4" ]; then
            log "$1: done on the box all the same" >&2
            return 0
        fi
        [ "$_rs_try" -lt "$REMOTE_TRIES" ] || die "$1: the connection was lost $_rs_try times and the box is not in the expected state"
        log "$1: not done on the box; running it again (try $((_rs_try + 1)) of $REMOTE_TRIES)" >&2
        sleep 2
    done
}

# The box's size of file $1, as a shell expression for a command on the box.
r_size() {
    echo "\$(stat -c %s $(shq "$1") 2>/dev/null || stat -f %z $(shq "$1"))"
}

# ---- the lock -----------------------------------------------------------------------
# Shell text for the box: the lock functions and one action ($1 of the text).
# A push's lock target is push.<expiry>.<id>; "mine" is any target with this
# run's id, so a refresh that ran just before a lost connection still counts.
LOCK_ID="$(date +%s)x$$"
lock_sh() {
    cat <<EOF
$LOCK_FUNCS
L=$(shq "$R_LOCK")
TK=\$L.takeover
held=$(shq "$LOCK_HELD")
newtok() { echo "push.\$((\$(date +%s) + $LOCK_TTL_S)).$LOCK_ID"; }
mine() {
    if [ -n "\$held" ]; then [ "\$(readlink "\$L" 2>/dev/null)" = "\$held" ]; return; fi
    case "\$(readlink "\$L" 2>/dev/null)" in push.*.$LOCK_ID) return 0 ;; esac
    return 1
}
refresh() {
    mine || { echo "the lock is no longer this push's: \$(readlink "\$L" 2>/dev/null || echo none)"; exit 3; }
    [ -z "\$held" ] || return 0
    ln -s "\$(newtok)" "\$L.$LOCK_ID.tmp" && mv -f "\$L.$LOCK_ID.tmp" "\$L"
}
take() {
    mkdir -p "\$(dirname "\$L")"
    if mine; then refresh; echo locked; return; fi
    if ln -s "\$(newtok)" "\$L" 2>/dev/null; then echo locked; return; fi
    if [ -e "\$L" ] && [ ! -L "\$L" ]; then echo "held: \$L is not a symlink (an older build); remove it by hand if no build runs"; return; fi
    h=\$(readlink "\$L" 2>/dev/null) || h=""
    if holder_alive "\$h"; then echo "held by \$h"; return; fi
    if [ -d "\$TK" ] && [ ! -L "\$TK" ]; then echo "held: a build is taking over the lock (\$TK)"; return; fi
    if ! ln -s "\$(newtok)" "\$TK" 2>/dev/null; then
        t=\$(readlink "\$TK" 2>/dev/null) || t=""
        if holder_alive "\$t"; then echo "held: \$t is taking over the lock"; return; fi
        rm -f "\$TK"
        ln -s "\$(newtok)" "\$TK" 2>/dev/null || { echo "held: another process is taking over the lock"; return; }
    fi
    now=\$(readlink "\$L" 2>/dev/null) || now=""
    if [ "\$now" = "\$h" ] && ! holder_alive "\$now"; then rm -f "\$L"; fi
    ln -s "\$(newtok)" "\$L" 2>/dev/null || true
    case "\$(readlink "\$TK" 2>/dev/null)" in push.*.$LOCK_ID) rm -f "\$TK" ;; esac
    if mine; then echo "locked (took over a stale lock held by \${h:-unknown})"; else echo "held by \$(readlink "\$L" 2>/dev/null || echo unknown)"; fi
}
release() {
    [ -z "\$held" ] || { echo released; return; }
    if mine; then rm -f "\$L"; fi
    echo released
}
EOF
}

# ---- local checks ----------------------------------------------------------------
[ -f "$SRC_MAN" ] || die "no manifest at $SRC_MAN; run compact-build.sh first"
[ -f "$SRC_DB" ] || die "no new database at $SRC_DB"
MSUM=$(sed -n '$s/^sha256=//p' "$SRC_MAN")
_have=$(sed '$d' "$SRC_MAN" | sha256_of)
[ -n "$MSUM" ] && [ "$MSUM" = "$_have" ] || die "manifest checksum mismatch (want '$MSUM', have '$_have')"
# manifest_get (compact-lib.sh) reads $MANIFEST.
MANIFEST=$SRC_MAN
SIZE=$(file_size "$SRC_DB")
_want_size=$(manifest_get new_size) || die "the manifest has no new_size"
[ "$SIZE" = "$_want_size" ] || die "$SRC_DB is $SIZE bytes, the manifest says $_want_size"
_want_sha=$(manifest_get new_sha256) || die "the manifest has no new_sha256"
# macOS's sqlite3 keeps an empty -wal and a -shm after a clean close; a
# -wal with data or a -journal means the file is open or was not closed.
if [ -s "$SRC_DB-wal" ] || [ -e "$SRC_DB-journal" ]; then
    die "$SRC_DB has a -wal with data or a -journal; the new file is open or was not closed cleanly"
fi
_schema=$(manifest_get schema_sha3) || die "the manifest has no schema_sha3"
PIECES=$(((SIZE + PIECE - 1) / PIECE))
started=$(date +%s)
if [ -n "$LOCK_HELD" ]; then
    log "push: $SRC_DB was hashed by the build that runs this push; not hashing it again"
else
    _sha=$(sha256_of <"$SRC_DB")
    [ "$_sha" = "$_want_sha" ] || die "$SRC_DB has sha256 $_sha, the manifest says $_want_sha"
    log "push: $SRC_DB matches the manifest's sha256 ($(($(date +%s) - started))s)"
fi
log "push start: $SRC_DB $(human "$SIZE") in $PIECES pieces of $(human "$PIECE") $WHERE, about $WRITE_MBPS MB/s"

# ---- lock and box checks -------------------------------------------------------------
_lk=$(remote_q "$(lock_sh); take") || die "could not take $R_LOCK on the box"
case "$_lk" in
    locked*)
        [ -n "$LOCK_HELD" ] || OWN_LOCK=1
        log "lock: $_lk"
        ;;
    *)
        if [ -n "$LOCK_HELD" ]; then
            die "the build's lock $R_LOCK is not held by pid $LOCK_HELD: $_lk"
        fi
        die "another build or push runs on the box ($_lk); not pushing"
        ;;
esac
STATE=$(remote_q "
    if [ ! -f $(shq "$LIVE_DB") ]; then echo 'nolive'; exit 0; fi
    if [ -e $(shq "$RDIR/swap-in-progress") ]; then echo 'swapping'; exit 0; fi
    mkdir -p $(shq "$RDIR")
    echo \"free \$(df -Pk $(shq "$RDIR") | awk 'NR == 2 { printf \"%.0f\", \$4 * 1024 }')\"
    if [ -f $(shq "$R_UP") ]; then echo \"upload $(r_size "$R_UP")\"; else echo 'upload 0'; fi
    if [ -f $(shq "$R_NEW") ]; then echo \"new $(r_size "$R_NEW")\"; else echo 'new 0'; fi
    if [ -f $(shq "$R_ID") ]; then echo \"id \$(cat $(shq "$R_ID"))\"; else echo 'id none'; fi
") || die "could not read the state of the box"
case "$STATE" in
    nolive*) die "no live database at $LIVE_DB on the box" ;;
    swapping*) die "a swap is in progress on the box ($RDIR/swap-in-progress); not pushing" ;;
esac
FREE=$(printf '%s\n' "$STATE" | sed -n 's/^free //p')
UP_SIZE=$(printf '%s\n' "$STATE" | sed -n 's/^upload //p')
OLD_NEW=$(printf '%s\n' "$STATE" | sed -n 's/^new //p')
UP_ID=$(printf '%s\n' "$STATE" | sed -n 's/^id //p')
is_int "$FREE" || die "could not read the free space on the box: '$FREE'"
is_int "$UP_SIZE" || die "could not read the size of $R_UP: '$UP_SIZE'"
is_int "$OLD_NEW" || die "could not read the size of $R_NEW: '$OLD_NEW'"

_ls=$(schema_hash "$LIVE_DB") || die "could not hash the live schema"
[ "$_ls" = "$_schema" ] || die "the live schema changed since the build (manifest $_schema, live $_ls); run a new build"

# Resume only the same build, and only when the upload file still holds
# every piece recorded as done.
done_pieces=""
if [ "$UP_ID" = "$MSUM" ] && [ -f "$DONE_FILE" ]; then
    done_pieces=$(sed -n "s/^$MSUM //p" "$DONE_FILE")
    for _i in $done_pieces; do
        _end=$(((_i + 1) * PIECE))
        [ "$_end" -le "$SIZE" ] || _end=$SIZE
        if [ "$UP_SIZE" -lt "$_end" ]; then
            log "the upload on the box is shorter than the pieces recorded as done; starting over"
            done_pieces=""
            break
        fi
    done
fi
if [ -z "$done_pieces" ]; then
    rm -f "$DONE_FILE"
    UP_SIZE=0
fi
n_done=0
for _i in $done_pieces; do n_done=$((n_done + 1)); done

live_size=$(live_file_size "$LIVE_DB")
is_int "$live_size" || die "could not read the size of $LIVE_DB on the box"
FLOOR=$((MIN_FREE_MB * 1048576 + live_size / 10))
# An older data.db.new of another build is removed below; its space counts.
_reclaim=0
[ "$UP_ID" = "$MSUM" ] || _reclaim=$OLD_NEW
need=$((SIZE - UP_SIZE + FLOOR - _reclaim))
log "box: free=$(human "$FREE") need=$(human "$need") (rest of the file plus a floor of $(human "$FLOOR")); $n_done of $PIECES pieces already there"
[ "$FREE" -ge "$need" ] || die "not enough free space on the box: need $(human "$need"), have $(human "$FREE")"

# The old manifest goes first: from here on, a restart finds no manifest.
# upload.id ties the upload file to this build; another build's upload and
# data.db.new go.
remote_q "set -e
    rm -f $(shq "$R_MAN") $(shq "$R_MAN.tmp")
    if [ \"\$(cat $(shq "$R_ID") 2>/dev/null)\" != $(shq "$MSUM") ]; then
        rm -f $(shq "$R_UP") $(shq "$R_NEW") $(shq "$R_NEW-wal") $(shq "$R_NEW-shm")
        printf '%s\n' $(shq "$MSUM") >$(shq "$R_ID.tmp")
        mv $(shq "$R_ID.tmp") $(shq "$R_ID")
    fi
    sync" >/dev/null || die "could not prepare $RDIR on the box"

# ---- pieces -------------------------------------------------------------------------
sent=0
i=0
while [ "$i" -lt "$PIECES" ]; do
    if in_list "$i" "$done_pieces"; then
        i=$((i + 1))
        continue
    fi
    p_started=$(date +%s)
    len=$PIECE
    [ $(((i + 1) * PIECE)) -le "$SIZE" ] || len=$((SIZE - i * PIECE))
    dd if="$SRC_DB" bs=1048576 skip=$((i * PIECE_MB)) count="$PIECE_MB" 2>/dev/null >"$L_PIECE.raw"
    [ "$(file_size "$L_PIECE.raw")" = "$len" ] || die "could not read piece $i of $SRC_DB"
    raw_sum=$(sha256_of <"$L_PIECE.raw")
    base=$((i * BLOCKS_PER_PIECE))
    nblocks=$(((len + BLOCK - 1) / BLOCK))
    readback="dd if=$(shq "$R_UP") bs=$BLOCK skip=$base count=$nblocks 2>/dev/null | head -c $len | sha256sum | cut -d' ' -f1"

    if [ -n "$REMOTE" ]; then
        # 1. The gzip'd piece to the box's temp directory, off the volume,
        # under this piece's own name (a temp name, then a rename), so a
        # retry, or a try still running after its connection was lost,
        # never reads a half-written or another piece's file.
        gzip -1 -c "$L_PIECE.raw" >"$L_PIECE.gz"
        gz_sum=$(sha256_of <"$L_PIECE.gz")
        _pg="$R_PIECE.$i.gz"
        _got=$(remote_in "$L_PIECE.gz" "set -e
            mkdir -p $(shq "$RTMP")
            rm -f $(shq "$R_PIECE").*
            cat >$(shq "$_pg").\$\$
            mv $(shq "$_pg").\$\$ $(shq "$_pg")
            sha256sum $(shq "$_pg") | cut -d' ' -f1") || die "could not send piece $i to the box"
        [ "$_got" = "$gz_sum" ] || die "piece $i arrived damaged (sha256 $_got, sent $gz_sum)"
        rm -f "$L_PIECE.gz"
        _src="$R_PIECE.$i.raw"
        _prep="if [ ! -f $(shq "$_src") ]; then gzip -dc $(shq "$_pg") >$(shq "$_src").\$\$; mv $(shq "$_src").\$\$ $(shq "$_src"); fi
            [ $(r_size "$_src") = $len ]"
        _skip0=0
    else
        _src=$SRC_DB
        _prep=":"
        _skip0=$base
    fi
    rm -f "$L_PIECE.raw"

    # 2. Into the upload file, one block at a time, each flushed, with a
    # pause after it; then the written range is read back and hashed. The
    # same bytes go to the same place each time, so a second run of this
    # step changes nothing. The lock is renewed first.
    remote_step "writing piece $i" "set -e
        $(lock_sh)
        refresh
        $_prep
        k=0
        while [ \$k -lt $nblocks ]; do
            dd if=$(shq "$_src") of=$(shq "$R_UP") bs=$BLOCK skip=\$(($_skip0 + k)) seek=\$(($base + k)) count=1 conv=notrunc,fsync 2>/dev/null
            k=\$((k + 1))
            sleep $BLOCK_PAUSE
        done
        $readback" "$readback" "$raw_sum"
    echo "$MSUM $i" >>"$DONE_FILE"
    sent=$((sent + len))
    log "piece $((i + 1))/$PIECES ok: $(human "$len") in $(($(date +%s) - p_started))s, $(human "$sent") written in $(($(date +%s) - started))s"
    i=$((i + 1))
done
if [ -n "$REMOTE" ]; then
    remote_q "rm -f $(shq "$R_PIECE").*" >/dev/null || log "could not remove $R_PIECE.* on the box" >&2
fi

# ---- publish ------------------------------------------------------------------------
# The upload must be exactly the file; then it becomes data.db.new, owned by
# the user PocketBase runs as. Run twice, the step finds the upload already
# renamed and checks data.db.new instead.
# shellcheck disable=SC2016 # runs on the box
_chown='if [ "$(id -u)" = 0 ] && id pocketbase >/dev/null 2>&1; then chown pocketbase:pocketbase'
_placed="[ ! -e $(shq "$R_UP") ] && [ $(r_size "$R_NEW") = $SIZE ] && [ \"\$(cat $(shq "$R_ID") 2>/dev/null)\" = $(shq "$MSUM") ]"
remote_step "placing $R_NEW" "set -e
    $(lock_sh)
    refresh
    if [ -f $(shq "$R_UP") ]; then
        [ $(r_size "$R_UP") = $SIZE ]
        rm -f $(shq "$R_NEW-wal") $(shq "$R_NEW-shm") $(shq "$R_NEW-journal")
        mv $(shq "$R_UP") $(shq "$R_NEW")
    fi
    $_placed
    $_chown $(shq "$R_NEW"); fi
    sync
    echo placed" "if $_placed; then echo placed; fi" placed

# The manifest goes to a temp name, then is renamed: the swap only acts on
# a manifest that is whole, and on its sha256 line.
_msha=$(sha256_of <"$SRC_MAN")
_got=$(remote_in "$SRC_MAN" "set -e
    cat >$(shq "$R_MAN.tmp").\$\$
    mv $(shq "$R_MAN.tmp").\$\$ $(shq "$R_MAN.tmp")
    sha256sum $(shq "$R_MAN.tmp") | cut -d' ' -f1") || die "could not send the manifest"
[ "$_got" = "$_msha" ] || die "the manifest arrived damaged"
_published="[ ! -e $(shq "$R_MAN.tmp") ] && [ -f $(shq "$R_MAN") ] && [ \"\$(sha256sum $(shq "$R_MAN") | cut -d' ' -f1)\" = $_msha ]"
remote_step "publishing $R_MAN" "set -e
    $(lock_sh)
    refresh
    [ $(r_size "$R_NEW") = $SIZE ]
    if [ -f $(shq "$R_MAN.tmp") ]; then
        [ \"\$(sha256sum $(shq "$R_MAN.tmp") | cut -d' ' -f1)\" = $_msha ]
        $_chown $(shq "$R_MAN.tmp"); fi
        sync
        mv $(shq "$R_MAN.tmp") $(shq "$R_MAN")
    fi
    $_published
    sync
    echo published" "if $_published; then echo published; fi" published
remote_q "rm -f $(shq "$R_ID")" >/dev/null || log "could not remove $R_ID on the box (harmless)" >&2
rm -f "$DONE_FILE"
log "push done in $(($(date +%s) - started))s: $R_NEW and $R_MAN are in place. To swap: restart the pocketbase service with PB_COMPACT_SWAP=1."
