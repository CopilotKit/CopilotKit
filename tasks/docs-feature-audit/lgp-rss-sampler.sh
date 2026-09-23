#!/bin/bash
# Samples, every 5 s, the summed RSS of all descendants of the root PIDs listed
# (one per line) in $1, plus the largest process and the 1-minute load.
# Appends to $2. Stops when $3 exists. Warns at >= 11.5 GiB.
roots_file=$1; out=$2; stop=$3
echo "# RSS samples (KiB), every 5 s: all descendants of the roots in $roots_file (AIMock boot, LGP stack boot, D6 runner incl. Playwright Chromium). Other agents' processes are excluded by ancestry." >> "$out"
while [ ! -e "$stop" ]; do
  ps -axo pid=,ppid=,rss=,comm= > /tmp/.lgp-ps.$$ 2>/dev/null
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
      s=sprintf("total_kb=%d", total); for (j=1;j<=nr;j++) s=s sprintf(" root%s_kb=%d", r[j], per[r[j]]);
      printf "%s top=%s:%d", s, topc, top
    }' /tmp/.lgp-ps.$$)
  load=$(sysctl -n vm.loadavg | awk '{print $2}')
  tot=$(echo "$line" | sed -E 's/total_kb=([0-9]+).*/\1/')
  warn=""; [ "${tot:-0}" -ge 12058624 ] && warn=" WARN>=11.5GiB"
  echo "$(date -u +%H:%M:%S) $line load=$load$warn" >> "$out"
  sleep 5
done
rm -f /tmp/.lgp-ps.$$
echo "# sampler stopped $(date -u +%FT%TZ)" >> "$out"
