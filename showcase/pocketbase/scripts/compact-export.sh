#!/bin/sh
# Streams the rows of one table out of the live database, for a build that
# runs off the box (compact-build.sh with PB_COMPACT_REMOTE). compact-build.sh
# sends this script over the remote command; it is not run by hand.
#
#   compact-export.sh DB TABLE SEL ROWSQL LO HI CHUNK_ROWS PAUSE_S
#       the rows with LO < rowid <= HI, in rowid order, CHUNK_ROWS rows per
#       read transaction, with PAUSE_S between them
#   compact-export.sh DB TABLE SEL ROWSQL all
#       every row, in one read transaction (WITHOUT ROWID tables and
#       sqlite_sequence, which have no rowid ranges to walk)
#
# SEL is the column list of the rows (with rowid for a rowid table). ROWSQL
# is an SQL expression over those columns that makes one INSERT statement per
# row, printable ASCII only (compact-build.sh hex-encodes any text that is
# not), so the sqlite3 CLI prints it unchanged whatever its version. The hash
# below proves every value arrives as it was.
#
# stdout: the INSERT statements, one row each.
# stderr: one line per read transaction, "chunk|LO|HI|ROWS|SHA3|NEXT".
#   ROWS and SHA3 are the row count and the sha3_query hash of
#   "SELECT SEL FROM TABLE WHERE rowid > LO AND rowid <= HI ORDER BY rowid"
#   ("SELECT SEL FROM TABLE ORDER BY 1, 2, ..., n" over every column for
#   "all"), read in the same transaction as the rows. The builder runs the same query on what it inserted. NEXT
#   is where the next read starts: just below the next rowid above HI, so a
#   sparse table skips its empty ranges, as compact-build.sh does.
#
# The database is opened with sqlite3 -readonly; nothing here writes to it.
set -eu

DB=$1
T=$2
SEL=$3
ROWSQL=$4
LO=$5

# The check line is written to this file, then printed to stderr by the
# shell: sqlite3 opening /dev/stderr fails where fd 2 is a socket.
CHK=$(mktemp "${TMPDIR:-/tmp}/pb-compact-export.XXXXXX")
trap 'rm -f "$CHK"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# The same sqlite3 settings as compact-lib.sh's sq. stdin is closed: when
# this script itself comes in on stdin, sqlite3 must not read it.
rq() {
    sqlite3 -init /dev/null -batch -bail -noheader -cmd '.timeout 10000' -cmd '.output /dev/null' \
        -cmd '.dbconfig dqs_ddl on' -cmd '.dbconfig dqs_dml on' -cmd '.output stdout' -readonly "$DB" "$@" </dev/null
}

# One read transaction: the rows to stdout, then the check line to stderr.
# $1 is the WHERE clause, $2 the ORDER BY clause, $3 the start, $4 the end,
# $5 the query for NEXT.
read_range() {
    # sha3_query hashes the SQL text too: this must be the builder's text,
    # character for character.
    _q="SELECT $SEL FROM \"$T\"${1:+ $1}${2:+ $2}"
    _hq=$(printf '%s' "$_q" | sed "s/'/''/g")
    : >"$CHK"
    rq "BEGIN;" \
        "SELECT $ROWSQL FROM \"$T\" $1 $2;" \
        ".output '$CHK'" \
        "SELECT 'chunk|$3|$4|' || count(*) || '|' || hex(sha3_query('$_hq')) || '|' || ($5) FROM (SELECT 1 FROM \"$T\" $1);" \
        ".output stdout" \
        "COMMIT;" || return 1
    cat "$CHK" >&2
}

if [ "$LO" = all ]; then
    # A whole-table read is ordered by every column: rows are unique, so
    # this is one order on both sides, whichever index either side scans.
    read_range "" "ORDER BY $SEL" all all "'all'"
    exit 0
fi

HI=$6
CHUNK=$7
PAUSE=$8
pos=$LO
while [ "$pos" -lt "$HI" ]; do
    if [ "$pos" -ge $((HI - CHUNK)) ]; then
        nxt=$HI
    else
        nxt=$((pos + CHUNK))
    fi
    # NEXT and the rows come from the same read, so a row inserted between
    # two reads cannot fall in a gap.
    line=$(read_range "WHERE rowid > $pos AND rowid <= $nxt" "ORDER BY rowid" "$pos" "$nxt" \
        "SELECT COALESCE((SELECT rowid FROM \"$T\" WHERE rowid > $nxt AND rowid <= $HI ORDER BY rowid LIMIT 1) - 1, $HI)" 2>&1 >&3) || {
        echo "$line" >&2
        exit 1
    }
    echo "$line" >&2
    pos=${line##*|}
    case "$pos" in '' | *[!0-9]*) echo "compact-export: bad next rowid in '$line'" >&2; exit 1 ;; esac
    [ "$pos" -ge "$nxt" ] || { echo "compact-export: the next rowid above $nxt is $pos; would not move forward" >&2; exit 1; }
    [ "$PAUSE" = 0 ] || sleep "$PAUSE"
done 3>&1
