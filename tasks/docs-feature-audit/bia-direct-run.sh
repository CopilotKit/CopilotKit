#!/bin/bash
# bia-direct-run.sh <base-url> <route> <agentId> <prompt> [x-test-id]
# One AG-UI run through the Built-in Agent runtime's multi-route endpoint
# (POST <route>/agent/<agentId>/run with a RunAgentInput body), read to the
# end of the SSE stream. Prints the HTTP status and the ordered event types (plus any
# RUN_ERROR message and the concatenated assistant text).
base=$1; route=$2; agent=$3; prompt=$4; tid=${5:-bia-direct-$(date +%s)}
uuid() { python3 -c 'import uuid;print(uuid.uuid4())'; }
body=$(python3 - "$agent" "$prompt" "$(uuid)" "$(uuid)" "$(uuid)" <<'PY'
import json,sys
agent,prompt,t,r,m=sys.argv[1:]
print(json.dumps({"threadId":t,"runId":r,"state":{},"messages":[{"id":m,"role":"user","content":prompt}],"tools":[],"context":[],"forwardedProps":{}}))
PY
)
out=$(mktemp /private/tmp/claude-501/bia-run.XXXX)
code=$(curl -s -N -m 90 -o "$out" -w '%{http_code}' -H 'content-type: application/json' -H 'x-aimock-context: built-in-agent' -H "x-test-id: $tid" -H 'accept: text/event-stream' -X POST "$base$route/agent/$agent/run" --data "$body")
echo "HTTP $code"
python3 - "$out" <<'PY'
import json,sys
types=[];text="";err=None
for line in open(sys.argv[1]):
    if not line.startswith("data:"): continue
    try: e=json.loads(line[5:])
    except Exception: continue
    t=e.get("type");types.append(t)
    if t in("TEXT_MESSAGE_CONTENT","TEXT_MESSAGE_CHUNK"): text+=e.get("delta") or ""
    if t=="RUN_ERROR": err=e.get("message")
print("events:"," ".join(types))
print("text:",repr(text))
if err: print("RUN_ERROR:",err)
PY
[ -s "$out" ] && ! grep -q '^data:' "$out" && head -c 600 "$out" && echo
rm -f "$out"
