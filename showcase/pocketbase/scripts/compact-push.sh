#!/bin/sh
# Puts an off-box build on the PocketBase box. compact-build.sh with
# PB_COMPACT_REMOTE made PB_DATA_DIR/compact/data.db.new and its manifest on
# this machine; this copies both to the compact directory next to the live
# database on the box (PB_COMPACT_REMOTE_DB, default /pb_data/data.db). The
# swap then happens as for an on-box build: restart PocketBase with
# PB_COMPACT_SWAP=1.
#
#   PB_COMPACT_REMOTE=... PB_DATA_DIR=<local dir> compact-push.sh
#
# The live database is never written. On the box, this writes only:
#   compact/data.db.new.upload   the file as it arrives
#   compact/upload.id            the sha256 of the manifest it belongs to
#   compact/data.db.new, compact/manifest   at the end, by rename
#   PB_COMPACT_REMOTE_TMP/pb-compact-piece.*   one piece at a time (default
#                                /tmp, off the volume)
# Any manifest already on the box is removed first, so a restart during the
# push cannot swap in a half-copied file.
#
# The file goes in pieces of PB_COMPACT_PIECE_MB (default 64). Each piece is
# sent gzip'd to PB_COMPACT_REMOTE_TMP and checked by sha256 there, then
# written into the upload file PB_COMPACT_BLOCK_MB (default 4) at a time, each
# block flushed to disk (conv=fsync) and followed by a pause, so the volume
# sees about PB_COMPACT_WRITE_MBPS (default 15) MB/s and never a burst of
# more than one block. The written piece is read back and checked by sha256.
# A run that stops part way (lost connection, ^C) resumes on the next run:
# pieces already checked for this manifest are skipped. A different build
# starts the upload over.
#
# Refuses when: the manifest checksum does not match; the local file is not
# the size the manifest says; a build runs on the box (live build.lock); a
# swap is in progress there; the live schema changed since the build; or the
# box has less free space than the rest of the file plus the floor
# (PB_COMPACT_MIN_FREE_MB, default 2048, plus 10% of the live file).
set -eu

LIB_DIR=$(dirname "$(readlink -f "$0")")
# shellcheck source=compact-lib.sh
. "$LIB_DIR/compact-lib.sh"

[ -n "$REMOTE" ] || die "PB_COMPACT_REMOTE is not set; compact-push.sh copies an off-box build to the box"

PIECE_MB="${PB_COMPACT_PIECE_MB:-64}"
BLOCK_MB="${PB_COMPACT_BLOCK_MB:-4}"
WRITE_MBPS="${PB_COMPACT_WRITE_MBPS:-15}"
MIN_FREE_MB="${PB_COMPACT_MIN_FREE_MB:-2048}"
RTMP="${PB_COMPACT_REMOTE_TMP:-/tmp}"
for _v in PIECE_MB BLOCK_MB WRITE_MBPS MIN_FREE_MB; do
    _val=""
    eval "_val=\$$_v"
    is_count "$_val" || die "PB_COMPACT_$_v=$_val is not a whole number (digits only, no leading zero)"
done
[ "$BLOCK_MB" -ge 1 ] && [ "$WRITE_MBPS" -ge 1 ] || die "PB_COMPACT_BLOCK_MB and PB_COMPACT_WRITE_MBPS must be at least 1"
[ $((PIECE_MB % BLOCK_MB)) = 0 ] || die "PB_COMPACT_PIECE_MB must be a multiple of PB_COMPACT_BLOCK_MB"
BLOCK=$((BLOCK_MB * 1048576))
PIECE=$((PIECE_MB * 1048576))
BLOCKS_PER_PIECE=$((PIECE_MB / BLOCK_MB))
# Pause after each block: the time one block takes at WRITE_MBPS.
BLOCK_PAUSE=$(awk -v b="$BLOCK_MB" -v r="$WRITE_MBPS" 'BEGIN { printf "%.3f\n", b / r }')

RDIR="$(dirname "$LIVE_DB")/compact"
R_UP="$RDIR/data.db.new.upload"
R_ID="$RDIR/upload.id"
R_NEW="$RDIR/data.db.new"
R_MAN="$RDIR/manifest"
R_PIECE="$RTMP/pb-compact-piece"
DONE_FILE="$COMPACT_DIR/push.done"
L_PIECE="$COMPACT_DIR/push.piece"

# Runs shell command $2 on the box with file $1 as its stdin. Every command
# sent this way can run twice with the same result, so a lost connection
# (exit 255) is tried again.
remote_in() {
    _ri_try=0
    while :; do
        _ri_try=$((_ri_try + 1))
        _ri_rc=0
        # shellcheck disable=SC2086 # $REMOTE is a command line
        _ri_out=$($REMOTE "$2" <"$1") || _ri_rc=$?
        if [ "$_ri_rc" != 255 ] || [ "$_ri_try" -ge "$REMOTE_TRIES" ]; then
            printf '%s\n' "$_ri_out"
            return "$_ri_rc"
        fi
        log "the remote command lost its connection (exit 255), try $_ri_try of $REMOTE_TRIES; trying again" >&2
        sleep 2
    done
}

sha256_of() {
    sha256sum | cut -d' ' -f1
}

# ---- local checks ----------------------------------------------------------------
[ -f "$MANIFEST" ] || die "no manifest at $MANIFEST; run compact-build.sh with PB_COMPACT_REMOTE first"
[ -f "$NEW_DB" ] || die "no new database at $NEW_DB"
MSUM=$(sed -n '$s/^sha256=//p' "$MANIFEST")
_have=$(sed '$d' "$MANIFEST" | sha256_of)
[ -n "$MSUM" ] && [ "$MSUM" = "$_have" ] || die "manifest checksum mismatch (want '$MSUM', have '$_have')"
SIZE=$(file_size "$NEW_DB")
_want_size=$(manifest_get new_size) || die "the manifest has no new_size"
[ "$SIZE" = "$_want_size" ] || die "$NEW_DB is $SIZE bytes, the manifest says $_want_size"
# macOS's sqlite3 keeps an empty -wal and a -shm after a clean close; a
# -wal with data or a -journal means the file is open or was not closed.
if [ -s "$NEW_DB-wal" ] || [ -e "$NEW_DB-journal" ]; then
    die "$NEW_DB has a -wal with data or a -journal; the new file is open or was not closed cleanly"
fi
_schema=$(manifest_get schema_sha3) || die "the manifest has no schema_sha3"
PIECES=$(((SIZE + PIECE - 1) / PIECE))
log "push start: $NEW_DB $(human "$SIZE") in $PIECES pieces of $(human "$PIECE") to $R_NEW on the box (via $REMOTE), about $WRITE_MBPS MB/s"

# ---- box checks -------------------------------------------------------------------
_lock="$RDIR/build.lock"
STATE=$(remote_q "
    if [ ! -f $(shq "$LIVE_DB") ]; then echo 'nolive'; exit 0; fi
    if [ -e $(shq "$RDIR/swap-in-progress") ]; then echo 'swapping'; exit 0; fi
    if [ -L $(shq "$_lock") ] && kill -0 \"\$(readlink $(shq "$_lock"))\" 2>/dev/null; then echo \"building \$(readlink $(shq "$_lock"))\"; exit 0; fi
    mkdir -p $(shq "$RDIR") $(shq "$RTMP")
    echo \"free \$(df -Pk $(shq "$RDIR") | awk 'NR == 2 { printf \"%.0f\", \$4 * 1024 }')\"
    if [ -f $(shq "$R_UP") ]; then echo \"upload \$(stat -c %s $(shq "$R_UP") 2>/dev/null || stat -f %z $(shq "$R_UP"))\"; else echo 'upload 0'; fi
    if [ -f $(shq "$R_ID") ]; then echo \"id \$(cat $(shq "$R_ID"))\"; else echo 'id none'; fi
") || die "could not read the state of the box"
case "$STATE" in
    nolive*) die "no live database at $LIVE_DB on the box" ;;
    swapping*) die "a swap is in progress on the box ($RDIR/swap-in-progress); not pushing" ;;
    building*) die "a compaction build runs on the box (pid ${STATE#building }); not pushing" ;;
esac
FREE=$(printf '%s\n' "$STATE" | sed -n 's/^free //p')
UP_SIZE=$(printf '%s\n' "$STATE" | sed -n 's/^upload //p')
UP_ID=$(printf '%s\n' "$STATE" | sed -n 's/^id //p')
is_int "$FREE" || die "could not read the free space on the box: '$FREE'"
is_int "$UP_SIZE" || die "could not read the size of $R_UP: '$UP_SIZE'"

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
need=$((SIZE - UP_SIZE + FLOOR))
log "box: free=$(human "$FREE") need=$(human "$need") (rest of the file plus a floor of $(human "$FLOOR")); $n_done of $PIECES pieces already there"
[ "$FREE" -ge "$need" ] || die "not enough free space on the box: need $(human "$need"), have $(human "$FREE")"

# The old manifest goes first: from here on, a restart finds no manifest.
# upload.id ties the upload file to this build.
remote_q "rm -f $(shq "$R_MAN") $(shq "$R_MAN.tmp") &&
    if [ \"\$(cat $(shq "$R_ID") 2>/dev/null)\" != $(shq "$MSUM") ]; then
        rm -f $(shq "$R_UP") && printf '%s\n' $(shq "$MSUM") >$(shq "$R_ID.tmp") && mv $(shq "$R_ID.tmp") $(shq "$R_ID")
    fi && sync" >/dev/null || die "could not prepare $RDIR on the box"

# ---- pieces -------------------------------------------------------------------------
started=$(date +%s)
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
    dd if="$NEW_DB" bs=1048576 skip=$((i * PIECE_MB)) count="$PIECE_MB" 2>/dev/null >"$L_PIECE.raw"
    [ "$(file_size "$L_PIECE.raw")" = "$len" ] || die "could not read piece $i of $NEW_DB"
    raw_sum=$(sha256_of <"$L_PIECE.raw")
    gzip -1 -c "$L_PIECE.raw" >"$L_PIECE.gz"
    gz_sum=$(sha256_of <"$L_PIECE.gz")
    rm -f "$L_PIECE.raw"

    # 1. The gzip'd piece to the box's temp directory, off the volume.
    _got=$(remote_in "$L_PIECE.gz" "cat >$(shq "$R_PIECE.gz") && sha256sum $(shq "$R_PIECE.gz") | cut -d' ' -f1") ||
        die "could not send piece $i to the box"
    [ "$_got" = "$gz_sum" ] || die "piece $i arrived damaged (sha256 $_got, sent $gz_sum)"

    # 2. Into the upload file, one block at a time, each flushed, with a
    # pause after it. Then the written range is read back and hashed.
    base=$((i * BLOCKS_PER_PIECE))
    nblocks=$(((len + BLOCK - 1) / BLOCK))
    _got=$(remote_q "set -e
        gzip -dc $(shq "$R_PIECE.gz") >$(shq "$R_PIECE.raw")
        [ \"\$(stat -c %s $(shq "$R_PIECE.raw") 2>/dev/null || stat -f %z $(shq "$R_PIECE.raw"))\" = $len ]
        k=0
        while [ \$k -lt $nblocks ]; do
            dd if=$(shq "$R_PIECE.raw") of=$(shq "$R_UP") bs=$BLOCK skip=\$k seek=\$(($base + k)) count=1 conv=notrunc,fsync 2>/dev/null
            k=\$((k + 1))
            sleep $BLOCK_PAUSE
        done
        rm -f $(shq "$R_PIECE.raw") $(shq "$R_PIECE.gz")
        dd if=$(shq "$R_UP") bs=$BLOCK skip=$base count=$nblocks 2>/dev/null | head -c $len | sha256sum | cut -d' ' -f1") ||
        die "could not write piece $i on the box"
    [ "$_got" = "$raw_sum" ] || die "piece $i reads back wrong on the box (sha256 $_got, sent $raw_sum)"
    echo "$MSUM $i" >>"$DONE_FILE"
    rm -f "$L_PIECE.gz"
    sent=$((sent + len))
    log "piece $((i + 1))/$PIECES ok: $(human "$len") in $(($(date +%s) - p_started))s, $(human "$sent") sent in $(($(date +%s) - started))s"
    i=$((i + 1))
done

# ---- publish ------------------------------------------------------------------------
# The upload must be exactly the file; then it becomes data.db.new, owned by
# the user PocketBase runs as, and the manifest goes last.
_fin=$(remote_q "set -e
    [ \"\$(stat -c %s $(shq "$R_UP") 2>/dev/null || stat -f %z $(shq "$R_UP"))\" = $SIZE ]
    rm -f $(shq "$R_NEW-wal") $(shq "$R_NEW-shm") $(shq "$R_NEW-journal")
    mv $(shq "$R_UP") $(shq "$R_NEW")
    if [ \"\$(id -u)\" = 0 ] && id pocketbase >/dev/null 2>&1; then chown pocketbase:pocketbase $(shq "$R_NEW"); fi
    sync
    echo placed") || die "could not put $R_NEW in place on the box"
[ "$_fin" = placed ] || die "could not put $R_NEW in place on the box: $_fin"
_got=$(remote_in "$MANIFEST" "cat >$(shq "$R_MAN.tmp") && sha256sum $(shq "$R_MAN.tmp") | cut -d' ' -f1") ||
    die "could not send the manifest"
_msha=$(sha256_of <"$MANIFEST")
[ "$_got" = "$_msha" ] || die "the manifest arrived damaged"
_fin=$(remote_q "set -e
    if [ \"\$(id -u)\" = 0 ] && id pocketbase >/dev/null 2>&1; then chown pocketbase:pocketbase $(shq "$R_MAN.tmp"); fi
    sync
    mv $(shq "$R_MAN.tmp") $(shq "$R_MAN")
    rm -f $(shq "$R_ID")
    sync
    echo published") || die "could not publish the manifest on the box"
[ "$_fin" = published ] || die "could not publish the manifest on the box: $_fin"
rm -f "$DONE_FILE"
log "push done in $(($(date +%s) - started))s: $R_NEW and $R_MAN are on the box. To swap: restart the pocketbase service with PB_COMPACT_SWAP=1."
