#!/bin/bash
# REPAIR-036 check: send Beautiful Chat's "Excalidraw Diagram (MCP App)" suggestion
# (shared frontend, hooks/use-example-suggestions.tsx) through the Strands
# /api/copilotkit-beautiful-chat runtime and print which tools the agent's model
# request advertised (AIMock journal). Strands has no fixture for this prompt, so
# under strict AIMock the model call is a 503; only the advertised tool list matters.
R=/Users/tylerslaton/.codex/worktrees/3715/CopilotKit
msg=$(sed -n 's/^ *"Use Excalidraw to create a simple network diagram\(.*\)",$/Use Excalidraw to create a simple network diagram\1/p' $R/showcase/integrations/strands/src/app/demos/beautiful-chat/hooks/use-example-suggestions.tsx)
echo "# $(date -u +%FT%TZ) HEAD $(cd $R && git rev-parse --short HEAD), route tree state: $(cd $R && git status --porcelain -- showcase/integrations/strands/src/app/api/copilotkit-beautiful-chat | tr '\n' ' ')"
echo "# prompt: $msg"
curl -s -X POST http://127.0.0.1:4410/__aimock/reset/journal >/dev/null
t=$(node -p 'Date.now()')
curl -s -N -m 90 -X POST http://localhost:3112/api/copilotkit-beautiful-chat -H 'content-type: application/json' -H 'x-aimock-context: strands' -H 'x-aimock-strict: true' -H "x-test-id: mcp-probe-$t" \
  -d "{\"method\":\"agent/run\",\"params\":{\"agentId\":\"beautiful-chat\"},\"body\":{\"threadId\":\"$(uuidgen)\",\"runId\":\"$(uuidgen)\",\"state\":{},\"messages\":[{\"id\":\"m-$t\",\"role\":\"user\",\"content\":\"$msg\"}],\"tools\":[],\"context\":[],\"forwardedProps\":{}}}" \
  | grep '^data:' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const ev=s.split("\n").filter(Boolean).map(l=>JSON.parse(l.slice(5)));const out=[];for(const e of ev){const last=out[out.length-1];if(last&&last.t===e.type)last.n++;else out.push({t:e.type,n:1})}console.log("events:",out.map(o=>o.t+(o.n>1?"x"+o.n:"")).join(" "));for(const e of ev){if(e.type==="TOOL_CALL_START")console.log("TOOL_CALL_START",e.toolCallName);if(e.type==="TOOL_CALL_RESULT")console.log("TOOL_CALL_RESULT",String(e.content).slice(0,160));if(e.type==="ACTIVITY_SNAPSHOT")console.log("ACTIVITY_SNAPSHOT",e.activityType);if(e.type==="RUN_ERROR")console.log("RUN_ERROR",e.message)}})'
curl -s http://127.0.0.1:4410/__aimock/journal | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const e of JSON.parse(s)){const tools=(e.body?.tools||[]).map(t=>t.function?.name);console.log(e.response?.status, "match="+JSON.stringify(e.response?.fixture?.match), "tools("+tools.length+"):", tools.join(","));console.log("create_view advertised:", tools.includes("create_view"))}})'
