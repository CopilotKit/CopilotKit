"""Live paired ordering study; run from agent/ (see benchmarks/README.md)."""

import argparse
import asyncio
import contextvars
import hashlib
import importlib.util
import json
import logging
import os
import random
import re
import sys
import time
import warnings
from pathlib import Path
from uuid import uuid4

from ag_ui.core import RunAgentInput
from dotenv import load_dotenv
from google.genai import types

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import src.transport as transport_module
from src.agent import create_agent
from src.express import ExpressCompiler

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--inputs", type=Path, required=True)
parser.add_argument("--prompts", type=Path, required=True)
parser.add_argument("--baseline", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
load_dotenv(Path(__file__).resolve().parents[2] / ".env.local")
logging.disable(logging.CRITICAL)
logger = logging.getLogger(__name__)
warnings.simplefilter("ignore")
inputs = json.loads(args.inputs.read_text())
prompts = {
    entry["name"]: entry["prompt"] for entry in json.loads(args.prompts.read_text())
}
spec = importlib.util.spec_from_file_location("src.ordering_baseline", args.baseline)
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)
condition = contextvars.ContextVar("ordering_condition")


def compiler_for_run(*values, **kwargs):
    cls = baseline.ExpressCompiler if condition.get() == "baseline" else ExpressCompiler
    return cls(*values, **kwargs)


# Benchmark-only factory injection, not a production workaround or SDK patch.
# ContextVar keeps the paired, concurrent baseline and ordered requests isolated.
transport_module.ExpressCompiler = compiler_for_run


def operations_from(events, transport):
    if transport == "tool":
        calls = {}
        for event in events:
            if event["type"] == "TOOL_CALL_ARGS":
                key = event["toolCallId"]
                calls[key] = calls.get(key, "") + event["delta"]
        return [
            {"target": body.get("target", "chat"), "operation": operation}
            for raw in calls.values()
            for body in [json.loads(raw)]
            for operation in body.get("operations", [])
        ]
    text = "".join(
        event.get("delta", "")
        for event in events
        if event["type"] == "TEXT_MESSAGE_CONTENT"
    )
    operations = []
    for target, body in re.findall(
        r"```a2ui(?:\s+target=([\w.-]+))?[^\n]*\n(.*?)\n```", text, re.DOTALL
    ):
        while body.strip():
            value, end = json.JSONDecoder().raw_decode(body.lstrip())
            for operation in value if isinstance(value, list) else [value]:
                operations.append({"target": target or "chat", "operation": operation})
            body = body.lstrip()[end:]
    return operations


async def run(case, semaphore):
    async with semaphore:
        model, format, transport, prompt, repeat, variant = case
        ident = f"{model}-{format}-{transport}-{list(prompts).index(prompt)}-{repeat}-{variant}"
        path = args.output / f"{ident}.json"
        if path.exists():
            return  # Resume preserves every previous attempt, including failures.
        token = condition.set(variant)
        result = {
            "id": ident,
            "variant": variant,
            "model": model,
            "level": "medium",
            "format": format,
            "transport": transport,
            "prompt": prompt,
            "repeat": repeat,
            "errors": [],
            "first_model_output": None,
        }
        events, raw = [], []
        started = time.perf_counter()
        agent = create_agent(model, format, transport)
        agent._adk_agent.generate_content_config = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level="medium")
        )

        async def after_model(callback_context, llm_response):
            for part in (
                llm_response.content.parts if llm_response.content else []
            ) or []:
                if (part.text and not part.thought) or part.function_call:
                    if result["first_model_output"] is None:
                        result["first_model_output"] = time.perf_counter() - started
                    if not llm_response.partial:
                        raw.append(
                            {
                                "text": part.text if not part.thought else None,
                                "function_call": part.function_call.model_dump(
                                    mode="json", exclude_none=True
                                )
                                if part.function_call
                                else None,
                            }
                        )
            if llm_response.usage_metadata:
                result["usage"] = llm_response.usage_metadata.model_dump(
                    mode="json", exclude_none=True
                )

        agent._adk_agent.after_model_callback = after_model
        incoming = RunAgentInput.model_validate(
            {
                **inputs[transport],
                "runId": str(uuid4()),
                "threadId": str(uuid4()),
                "messages": [
                    {"id": str(uuid4()), "role": "user", "content": prompts[prompt]}
                ],
            }
        )

        async def collect():
            async for event in agent.run(incoming):
                events.append(
                    {
                        "seconds": time.perf_counter() - started,
                        **event.model_dump(
                            mode="json", by_alias=True, exclude_none=True
                        ),
                    }
                )
                if event.type == "RUN_ERROR":
                    result["errors"].append(event.message)

        try:
            await asyncio.wait_for(collect(), timeout=120)
        except Exception as exc:
            logger.exception("Benchmark attempt failed")
            result["errors"].append(type(exc).__name__ + ": " + str(exc))
        finally:
            result["total_seconds"] = time.perf_counter() - started
            await agent.close()
            condition.reset(token)
        operations = []
        try:
            operations = operations_from(events, transport)
        except Exception as exc:
            logger.exception("Output extraction failed")
            result["errors"].append("Output parse: " + str(exc))
        result["finished"] = bool(events and events[-1]["type"] == "RUN_FINISHED")
        result["created"] = any(
            "createSurface" in item["operation"] for item in operations
        )
        result["candidate_pass"] = (
            not result["errors"] and result["finished"] and result["created"]
        )
        result["text_chunks"] = sum(
            event["type"] == "TEXT_MESSAGE_CONTENT" for event in events
        )
        result["raw_text_chars"] = sum(len(part.get("text") or "") for part in raw)
        content = json.dumps(
            {"result": result, "events": events, "raw": raw, "operations": operations},
            indent=2,
        )
        for key in (os.getenv("GOOGLE_API_KEY"), os.getenv("GEMINI_API_KEY")):
            if key:
                content = content.replace(key, "[REDACTED]")
        path.write_text(content)
        print(
            json.dumps(
                {
                    key: result[key]
                    for key in ("id", "total_seconds", "candidate_pass", "text_chunks")
                }
            ),
            flush=True,
        )


async def main():
    pairs = []
    for model in ("gemini-3.6-flash", "gemini-3.8-flash"):
        for format, transport, repeats in (
            ("express", "markdown", 3),
            ("express", "tool", 1),
            ("json", "markdown", 1),
        ):
            for prompt in (
                "Dashboard on the page",
                "Sign-up with validation",
                "Team plan estimator",
            ):
                for repeat in range(1, repeats + 1):
                    pairs.append(
                        [
                            (model, format, transport, prompt, repeat, variant)
                            for variant in ("baseline", "ordered")
                        ]
                    )
    rng = random.Random(7819)
    rng.shuffle(pairs)
    for pair in pairs:
        rng.shuffle(pair)
    manifest = {
        "seed": 7819,
        "concurrency": 2,
        "timeout_seconds": 120,
        "thinking": "medium",
        "cases": [case for pair in pairs for case in pair],
        "sha256": {
            str(path): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (args.inputs, args.prompts, args.baseline, Path(__file__))
        },
    }
    manifest_path = args.output / "manifest.json"
    if manifest_path.exists() and json.loads(manifest_path.read_text()) != manifest:
        raise ValueError("Study inputs changed; use a new output directory")
    manifest_path.write_text(json.dumps(manifest, indent=2))
    semaphore = asyncio.Semaphore(2)
    # Run each matched pair together, preserving randomized pair order.
    for pair in pairs:
        await asyncio.gather(*(run(case, semaphore) for case in pair))


asyncio.run(main())
