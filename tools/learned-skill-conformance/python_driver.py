"""Run public adapters with native frameworks and a real model-provider HTTP client."""

import asyncio
import os
import sys

from copilotkit_intelligence import Intelligence


async def main() -> None:
    adapter = sys.argv[1]
    model_url = os.environ["LEARNED_SKILL_AIMOCK_URL"]
    async with Intelligence(
        api_key=os.environ["CPK_INTELLIGENCE_API_KEY"],
        api_url=os.environ["INTELLIGENCE_API_URL"],
    ) as intelligence:
        if adapter == "langgraph":
            from copilotkit_intelligence_langgraph import (
                create_skill_registry_middleware,
            )
            from langchain.agents import create_agent
            from langchain_openai import ChatOpenAI

            middleware = create_skill_registry_middleware(
                client=intelligence,
                container_id=os.environ["CPK_INTELLIGENCE_LEARNING_CONTAINER_ID"],
                freshness_window=0,
            )
            try:
                await middleware.initialize()
                agent = create_agent(
                    ChatOpenAI(
                        model="gpt-4o-mini",
                        api_key="aimock",
                        base_url=model_url + "/v1",
                        max_retries=0,
                    ),
                    middleware=[middleware],
                    system_prompt="Developer policy: follow the published refund procedure.",
                )
                result = await agent.ainvoke(
                    {
                        "messages": [
                            {
                                "role": "user",
                                "content": "Learned skill acceptance refund",
                            }
                        ]
                    }
                )
                assert "Acceptance complete" in result["messages"][-1].content
            finally:
                await middleware.aclose()
        elif adapter == "adk":
            from copilotkit_intelligence_adk import SkillRegistry, SkillToolset
            from google.adk.agents import LlmAgent
            from google.adk.models.lite_llm import LiteLlm
            from google.adk.runners import Runner
            from google.adk.sessions import InMemorySessionService
            from google.genai import types

            registry = SkillRegistry(
                client=intelligence,
                container_id=os.environ["CPK_INTELLIGENCE_LEARNING_CONTAINER_ID"],
                freshness_window=0,
            )
            sessions = InMemorySessionService()
            await sessions.create_session(
                app_name="acceptance", user_id="user", session_id="session"
            )
            runner = Runner(
                app_name="acceptance",
                session_service=sessions,
                agent=LlmAgent(
                    name="refund_agent",
                    model=LiteLlm(
                        model="openai/gpt-4o-mini",
                        api_key="aimock",
                        api_base=model_url + "/v1",
                        num_retries=0,
                    ),
                    instruction="Developer policy: follow the published refund procedure.",
                    tools=[SkillToolset(registry)],
                ),
            )
            try:
                await registry.initialize()
                events = [
                    event
                    async for event in runner.run_async(
                        user_id="user",
                        session_id="session",
                        new_message=types.Content(
                            role="user",
                            parts=[types.Part(text="Learned skill acceptance refund")],
                        ),
                    )
                ]
                assert any(
                    "Acceptance complete" in (part.text or "")
                    for event in events
                    if event.content
                    for part in event.content.parts or []
                )
            finally:
                await runner.close()
                await registry.aclose()
        else:
            raise ValueError("Unknown adapter")


asyncio.run(main())
