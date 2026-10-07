#!/bin/bash
# bia-a2ui-run-20261006.sh <tag>: one fresh boot of the Built-in Agent stack
# with its OpenAI calls pointed at the scratch strict AIMock on :4411 (which
# must already be serving bia-a2ui-live-order-fixtures-20261006.json), then
# `run-local-d6.mts built-in-agent --demo declarative-gen-ui`, then the
# scratch journal. Derived from strands-a2ui-run-20261006.sh.
set -u
cd /Users/tylerslaton/.codex/worktrees/3715/CopilotKit/tasks/docs-feature-audit
S=./bia-stack-20261006.sh; tag=$1
export DIAG_OPENAI_BASE_URL=http://127.0.0.1:4411/v1
$S stack-start $PWD/bia-dev-stack-a2ui-$tag-20261006.log
$S prewarm $PWD/bia-prewarm-a2ui-$tag-20261006.log declarative-gen-ui
$S journal-reset x 4411 >/dev/null
$S d6 $PWD/bia-d6-a2ui-$tag-20261006.log --demo declarative-gen-ui
$S journal-dump $PWD/bia-d6-journal-a2ui-$tag-20261006.json 4411
$S stack-stop $PWD/bia-dev-stack-a2ui-$tag-20261006.log
grep -E 'feature-complete' bia-d6-a2ui-$tag-20261006.log | sed -E 's/.*"pass":(true|false).*"durationMs":([0-9]+).*/pass=\1 durationMs=\2/'
grep -oE 'waitForTurnComplete[^"]*' bia-d6-a2ui-$tag-20261006.log | sort -u | head -2
