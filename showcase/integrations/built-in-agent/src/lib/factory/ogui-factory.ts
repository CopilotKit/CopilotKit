import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { BUILT_IN_AGENT_MODEL_FOR_TANSTACK } from "./models";
import {
  convertBuiltInTanStackStream,
  createInputToolDefinitions,
} from "./tanstack-factory";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

type OguiAgentProfile = "minimal" | "advanced";

type CreateOguiAgentOptions = {
  profile?: OguiAgentProfile;
};

const ADVANCED_OPEN_GEN_UI_SYSTEM_PROMPT = `
You are a UI-generating assistant for the Open Generative UI advanced demo.

On every user turn you MUST call the generateSandboxedUi frontend tool exactly once. The generated UI must be interactive and must call host-side sandbox functions with await Websandbox.connection.remote.<functionName>(args). Do not use forms or submit buttons; use plain buttons and addEventListener handlers.

For these demo prompts, generate the exact stable elements and behavior below:

1. User prompt: "Ping the host (calls notifyHost)"
- html: <div class="card" data-testid="ogui-ping"><h2>Notify the host</h2><button id="hi">Say hi to the host</button><div class="out" id="out">awaiting click...</div></div>
- jsFunctions: document.getElementById('hi').addEventListener('click',async function(){var out=document.getElementById('out');out.textContent='sending...';var res=await Websandbox.connection.remote.notifyHost({message:'Hello from sandbox'});out.textContent=res&&res.ok?'host replied at '+res.receivedAt:'failed';});
- initialHeight: 320

2. User prompt: "Inline expression evaluator"
- html: <div class="card" data-testid="ogui-inline-eval"><h2>Inline expression evaluator</h2><input id="in" placeholder="e.g. 2 + 2"/><button id="go">Evaluate</button><div class="out" id="out">awaiting input...</div></div>
- jsFunctions: (function(){var input=document.getElementById('in');var out=document.getElementById('out');var go=document.getElementById('go');async function run(){var expr=input.value;out.textContent='evaluating...';var res=await Websandbox.connection.remote.evaluateExpression({expression:expr});out.textContent=res&&res.ok?'= '+res.value:'error: '+res.error;}go.addEventListener('click',run);input.addEventListener('keydown',function(e){if(e.key==='Enter')run();});})();
- initialHeight: 320

3. User prompt: "Calculator (calls evaluateExpression)"
- html: <div class="wrap" data-testid="ogui-calculator"><div class="display" id="d">0</div><div class="grid"><button>7</button><button>8</button><button>9</button><button>+</button><button>4</button><button>5</button><button>6</button><button>-</button><button>1</button><button>2</button><button>3</button><button>*</button><button>0</button><button>.</button><button id="eq">=</button><button>/</button></div></div>
- jsFunctions: (function(){var expr='';var display=document.getElementById('d');document.querySelectorAll('.grid button').forEach(function(btn){btn.addEventListener('click',async function(){if(btn.id==='eq'){var res=await Websandbox.connection.remote.evaluateExpression({expression:expr});if(res&&res.ok){display.textContent=String(res.value);expr=String(res.value);}else{display.textContent='err';expr='';}}else{expr+=btn.textContent;display.textContent=expr;}});});})();
- initialHeight: 480

Use compact dark CSS that makes the controls legible. Include placeholderMessages that describe what is being composed. Keep any final chat text to one short sentence.
`;

/**
 * Built-in agent for the Open Generative UI demo.
 *
 * No bespoke tools — the runtime's `openGenerativeUI` flag (see
 * `src/app/api/copilotkit-ogui/route.ts`) injects the
 * `generateSandboxedUi` tool and wires the activity middleware. The agent
 * just needs an LLM that knows when to call it.
 */
export function createOguiAgent(options: CreateOguiAgentOptions = {}) {
  const profile = options.profile ?? "minimal";
  return new BuiltInAgent({
    type: "custom",
    factory: async ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      const runtimeTools = createInputToolDefinitions(input.tools);
      const stream = chat({
        adapter: openaiText(BUILT_IN_AGENT_MODEL_FOR_TANSTACK, {
          fetch: forwardingFetch,
        }),
        messages,
        systemPrompts:
          profile === "advanced"
            ? [ADVANCED_OPEN_GEN_UI_SYSTEM_PROMPT, ...systemPrompts]
            : systemPrompts,
        tools: runtimeTools,
        modelOptions:
          profile === "advanced" ? { parallel_tool_calls: false } : undefined,
        abortController,
      });
      return convertBuiltInTanStackStream(stream, abortController.signal);
    },
  });
}
