#!/bin/bash
# a2ui-run.sh <tag>: fresh boot with the agent's OpenAI calls on the scratch AIMock :4411, run declarative-gen-ui, dump :4411 journal.
set -u
cd /Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit
S=./strands-stack-20261006.sh; tag=$1
export DIAG_OPENAI_BASE_URL=http://127.0.0.1:4411/v1
$S stack-start $PWD/strands-dev-stack-a2ui-$tag-20261006.log
$S prewarm $PWD/strands-prewarm-a2ui-$tag-20261006.log declarative-gen-ui
$S journal-reset x 4411 >/dev/null
$S d6 $PWD/strands-d6-a2ui-$tag-20261006.log --demo declarative-gen-ui
$S journal-dump $PWD/strands-d6-journal-a2ui-$tag-20261006.json 4411
$S stack-stop $PWD/strands-dev-stack-a2ui-$tag-20261006.log
grep -E 'service-complete' strands-d6-a2ui-$tag-20261006.log | sed -E 's/.*"passed":([0-9]+),"failed":([0-9]+).*"total":([0-9]+).*/passed \1 failed \2 total \3/'
