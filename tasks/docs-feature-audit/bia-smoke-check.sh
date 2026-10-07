#!/bin/bash
# bia-smoke-check.sh <label>: /api/smoke on the running Built-in Agent stack
# (port 3117) against the strict AIMock on :4410, normal and with one
# non-retryable 400 queued for the next provider request (/__aimock/error).
# Each GET is followed by the AIMock journal; the queued-400 run is also
# replayed directly through the multi-route endpoint and read to the end.
D=$(cd "$(dirname "$0")" && pwd)
A=http://127.0.0.1:4410
journal() { curl -s $A/__aimock/journal | python3 -c '
import json,sys
j=json.load(sys.stdin);print(f"{len(j)} request(s)")
for e in j:
  r=e.get("response",{});h=e.get("headers",{})
  print("  ",e.get("method"),e.get("path"),r.get("status"),"ctx="+str(h.get("x-aimock-context","-")),"match="+json.dumps((r.get("fixture") or {}).get("match",{}))[:90])'; }
echo "# Built-in Agent /api/smoke ($1), HEAD $(git -C "$D" rev-parse --short HEAD), $(date -u)"
echo "## smoke route source: $(git -C "$D" log -1 --format=%h -- ../../showcase/integrations/built-in-agent/src/app/api/smoke/route.ts) $(git -C "$D" status --porcelain -- ../../showcase/integrations/built-in-agent/src/app/api/smoke/route.ts)"
curl -s -X POST $A/__aimock/reset/journal >/dev/null
echo "## 1: GET /api/smoke"
curl -s -m 60 -w '\nHTTP %{http_code} %{time_total}s\n' http://localhost:3117/api/smoke
sleep 3; echo "## AIMock journal:"; journal
curl -s -X POST $A/__aimock/reset/journal >/dev/null
echo "## 2 (discriminating): queue one 400 for the next provider request, then GET /api/smoke"
echo "\$ curl -X POST $A/__aimock/error -d '{\"status\":400,\"body\":{\"message\":\"injected provider failure\",\"type\":\"invalid_request_error\"}}'"
curl -s -X POST $A/__aimock/error -d '{"status":400,"body":{"message":"injected provider failure","type":"invalid_request_error"}}'; echo
curl -s -m 60 -w '\nHTTP %{http_code} %{time_total}s\n' http://localhost:3117/api/smoke
sleep 3; echo "## AIMock journal:"; journal
echo "## The same failing run replayed directly (error queued again), multi-route POST /api/copilotkit/agent/default/run, read to the end:"
curl -s -X POST $A/__aimock/error -d '{"status":400,"body":{"message":"injected provider failure","type":"invalid_request_error"}}' >/dev/null
"$D/bia-direct-run.sh" http://localhost:3117 /api/copilotkit default "Respond with exactly: OK" smoke-replay
curl -s -X POST $A/__aimock/reset/journal >/dev/null
echo "## 3: GET /api/smoke again with nothing queued"
curl -s -m 60 -w '\nHTTP %{http_code} %{time_total}s\n' http://localhost:3117/api/smoke
sleep 2; echo "## AIMock journal:"; journal
