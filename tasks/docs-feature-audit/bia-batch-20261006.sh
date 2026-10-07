#!/bin/bash
# bia-batch-20261006.sh <tag> <batch...>: strands-batch-20261006.sh for the
# Built-in Agent. A batch is A1|A2|B1|B2|B3, or NAME=demo,demo,... for an
# ad-hoc subset (logs are named after NAME). For each batch: fresh boot -> pre-warm the batch's pages and
# every API route -> AIMock journal reset -> runner -> journal dump -> stop.
set -u
cd /Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit
S=./bia-stack-20261006.sh
tag=$1; shift
B_A1=beautiful-chat,cli-start,agentic-chat,prebuilt-sidebar,prebuilt-popup,chat-slots,chat-customization-css,headless-simple
B_A2=headless-complete,reasoning-custom,reasoning-default,frontend-tools,frontend-tools-async,gen-ui-tool-based,hitl-in-app,hitl-in-chat,declarative-gen-ui,a2ui-fixed-schema,a2ui-recovery
B_B1=mcp-apps,gen-ui-agent,tool-rendering-default-catchall,tool-rendering-custom-catchall,tool-rendering
B_B2=shared-state-read,shared-state-read-write,readonly-state-agent-context,subagents,multimodal
B_B3=auth,declarative-hashbrown,declarative-json-render,open-gen-ui,open-gen-ui-advanced,voice,agent-config,threadid-frontend-tool-roundtrip
waitload() { while :; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$l" -le 15 ] && break; echo "load $l > 15, waiting"; sleep 20; done; }
for b in "$@"; do
  if [[ "$b" == *=* ]]; then demos=${b#*=}; b=${b%%=*}; else v="B_$b"; demos=${!v}; fi
  echo "=== $tag $b $(date -u +%FT%TZ)"
  waitload
  $S stack-start $PWD/bia-dev-stack-$tag-$b-20261006.log
  pages=$(echo "$demos" | tr ',' '\n' | grep -v '^cli-start$' | sort -u | tr '\n' ',' | sed 's/,$//')
  $S prewarm $PWD/bia-prewarm-$tag-$b-20261006.log "$pages"
  $S journal-reset >/dev/null
  waitload
  if [[ "$demos" == *,* ]]; then $S d6 $PWD/bia-d6-$tag-$b-20261006.log --demos "$demos"; else $S d6 $PWD/bia-d6-$tag-$b-20261006.log --demo "$demos"; fi
  $S journal-dump $PWD/bia-d6-journal-$tag-$b-20261006.json
  $S stack-stop $PWD/bia-dev-stack-$tag-$b-20261006.log
  grep -E 'service-complete|feature-retry' bia-d6-$tag-$b-20261006.log | sed -E 's/.*"passed":([0-9]+),"failed":([0-9]+).*"total":([0-9]+).*/passed \1 failed \2 total \3/'
done
echo "=== done $(date -u +%FT%TZ)"
