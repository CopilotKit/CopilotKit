#!/bin/bash
# lgp-rss-sampler.sh (2026-09-23) plus an abort line, as the ADK run used:
# every 2 s, sums the RSS of all descendants of the root PIDs listed in $1
# (AIMock boot, stack boot, each D6 runner incl. Playwright's Chromium),
# records the largest process and the 1-minute load, and appends to $2.
# Stops when $3 exists. If the sum reaches 10.5 GB (decimal; the audit's hard
# cap is 11 GB) it sends SIGTERM to the runner whose PID is in $4.
roots_file=$1; out=$2; stop=$3; runner_pid_file=$4
ABORT_KB=10253906   # 10.5e9 bytes / 1024
tmp=$(mktemp /private/tmp/claude-501/lgts-ps.XXXX)
echo "# RSS samples (KiB), every 2 s: all descendants of the roots in $roots_file. Abort (SIGTERM to the runner) at >= ${ABORT_KB} KiB (10.5 GB). Other agents' processes are excluded by ancestry. Started $(date -u +%FT%TZ)" >> "$out"
while [ ! -e "$stop" ]; do
  ps -axo pid=,ppid=,rss=,comm= > "$tmp" 2>/dev/null
  roots=$(grep -E '^[0-9]+$' "$roots_file" 2>/dev/null | tr '\n' ' ')
  line=$(awk -v roots="$roots" '
    { pid=$1; ppid[$1]=$2; rss[$1]=$3; $1=$2=$3=""; sub(/^ +/,""); n=split($0,a,"/"); comm[pid]=a[n] }
    END {
      nr=split(roots, r, " "); total=0; top=0; topc="";
      for (p in rss) {
        q=p; hit="";
        for (i=0;i<64 && q>1;i++){ for (j=1;j<=nr;j++) if (q==r[j]) {hit=r[j]; break}; if (hit!="") break; q=ppid[q] }
        if (hit!="") { total+=rss[p]; per[hit]+=rss[p]; if (rss[p]>top){top=rss[p]; topc=comm[p]} }
      }
      s=sprintf("total_kb=%d", total); for (j=1;j<=nr;j++) if (per[r[j]]>0) s=s sprintf(" root%s_kb=%d", r[j], per[r[j]]);
      printf "%s top=%s:%d", s, topc, top
    }' "$tmp")
  load=$(sysctl -n vm.loadavg | awk '{print $2}')
  tot=$(echo "$line" | sed -E 's/total_kb=([0-9]+).*/\1/')
  flag=""
  if [ "${tot:-0}" -ge "$ABORT_KB" ]; then
    rp=$(cat "$runner_pid_file" 2>/dev/null)
    if [ -n "$rp" ] && kill -0 "$rp" 2>/dev/null; then kill -TERM "$rp"; flag=" ABORT: SIGTERM runner $rp"; else flag=" OVER-ABORT-LINE (no runner)"; fi
  fi
  echo "$(date -u +%H:%M:%S) $line load=$load$flag" >> "$out"
  sleep 2
done
rm -f "$tmp"
echo "# sampler stopped $(date -u +%FT%TZ)" >> "$out"
