#!/bin/bash
# batch.sh <tag> <batch...>: for each batch, fresh boot -> prewarm batch pages + APIs -> journal reset -> runner -> journal dump -> stop.
set -u
cd /Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit
S=./strands-stack-20261006.sh
tag=$1; shift
B_A1=beautiful-chat,cli-start,agentic-chat,prebuilt-sidebar,prebuilt-popup,chat-slots,chat-customization-css,headless-simple
B_A2=headless-complete,reasoning-custom,reasoning-default,frontend-tools,frontend-tools-async,gen-ui-tool-based,hitl-in-app,hitl-in-chat,declarative-gen-ui,a2ui-fixed-schema,a2ui-recovery
B_B1=mcp-apps,gen-ui-agent,tool-rendering-default-catchall,tool-rendering-custom-catchall,tool-rendering,tool-rendering-reasoning-chain,hitl,hitl-in-chat-booking
B_B2=shared-state-read,shared-state-read-write,readonly-state-agent-context,subagents,multimodal
B_B3=auth,declarative-hashbrown,declarative-json-render,open-gen-ui,open-gen-ui-advanced,voice,agent-config,gen-ui-interrupt,interrupt-headless
waitload() { while :; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); [ "$l" -le 15 ] && break; echo "load $l > 15, waiting"; sleep 20; done; }
for b in "$@"; do
  v="B_$b"; demos=${!v:-$b}
  echo "=== $tag $b $(date -u +%FT%TZ)"
  waitload
  $S stack-start $PWD/strands-dev-stack-$tag-$b-20261006.log
  pages=$(echo "$demos" | tr ',' '\n' | grep -v '^cli-start$' | sed -e 's/^hitl-in-chat-booking$/hitl-in-chat/' | sort -u | tr '\n' ',' | sed 's/,$//')
  $S prewarm $PWD/strands-prewarm-$tag-$b-20261006.log "$pages"
  $S journal-reset >/dev/null
  waitload
  if [[ "$demos" == *,* ]]; then $S d6 $PWD/strands-d6-$tag-$b-20261006.log --demos "$demos"; else $S d6 $PWD/strands-d6-$tag-$b-20261006.log --demo "$demos"; fi
  $S journal-dump $PWD/strands-d6-journal-$tag-$b-20261006.json
  $S stack-stop $PWD/strands-dev-stack-$tag-$b-20261006.log
  grep -E 'service-complete|feature-retry' strands-d6-$tag-$b-20261006.log | sed -E 's/.*"passed":([0-9]+),"failed":([0-9]+).*"total":([0-9]+).*/passed \1 failed \2 total \3/'
done
echo "=== done $(date -u +%FT%TZ)"
