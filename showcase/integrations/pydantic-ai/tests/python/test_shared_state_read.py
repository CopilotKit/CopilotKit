"""Real AG-UI/aimock integration proof for per-request recipe context.

Start local aimock with the complete strict showcase fixture bundle, then run
in a fresh Python process from the integration directory (using its Python deps):

    AIMOCK_URL=http://127.0.0.1:4010 PYTHONPATH=src \
        python tests/python/test_shared_state_read.py -v

AIMOCK_URL must be an HTTP loopback origin, without credentials or a path.
The test derives OPENAI_BASE_URL, replaces any real key with a dummy key and
ignores proxy environment variables before importing the server. It restores
those environment variables afterward. The endpoint, Pydantic adapter and
provider HTTP transport are real.
"""

import asyncio
import copy
import json
import os
import sys
import unittest
import uuid
from unittest.mock import patch
from urllib.parse import urlsplit

import httpx


@unittest.skipUnless(os.environ.get("AIMOCK_URL"), "requires real local aimock")
class RecipeContextTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        aimock_url = os.environ["AIMOCK_URL"].rstrip("/")
        parsed = urlsplit(aimock_url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("AIMOCK_URL must be an HTTP loopback origin")
        if any(
            name == "agent_server" or name.startswith("agents.") for name in sys.modules
        ):
            raise RuntimeError("Run this integration test in a fresh Python process")
        environment = dict(os.environ)
        for key in list(environment):
            if key.lower() in {"http_proxy", "https_proxy", "all_proxy", "no_proxy"}:
                del environment[key]
        environment.update(
            OPENAI_BASE_URL=aimock_url + "/v1",
            OPENAI_API_KEY="aimock-local-test-only",
            NO_PROXY="*",
        )
        self.enterContext(patch.dict(os.environ, environment, clear=True))

    def assert_recipe_read_only(self, events, recipe):
        # Inspect the state actually sent to the UI. Comparing the caller's
        # dictionaries cannot detect changes after HTTP JSON serialization.
        for event in events:
            if event["type"] == "STATE_SNAPSHOT":
                self.assertEqual(
                    event["snapshot"].get("recipe"),
                    recipe,
                    "STATE_SNAPSHOT changed the UI-owned recipe",
                )
            elif event["type"] == "STATE_DELTA":
                for operation in event["delta"]:
                    if operation["op"] == "test":
                        continue
                    # A read-only agent must not write the recipe, replace
                    # its parent (the root), or move recipe data elsewhere.
                    paths = [operation["path"]]
                    if operation["op"] == "move":
                        paths.append(operation["from"])
                    for path in paths:
                        first_key = path.split("/")[1:2]
                        self.assertFalse(
                            path == "" or first_key == ["recipe"],
                            f"STATE_DELTA wrote the UI-owned recipe: {operation}",
                        )

    async def test_concurrent_recipes_reach_model_without_cross_request_state(self):
        # setUp binds the real SDK to local aimock before constructing any agents.
        from agent_server import app

        recipe = {
            "title": "Make Your Recipe",
            "skill_level": "Intermediate",
            "cooking_time": "45 min",
            "special_preferences": [],
            "ingredients": [
                {"icon": "🥕", "name": "Carrots", "amount": "3 large, grated"},
                {"icon": "🌾", "name": "All-Purpose Flour", "amount": "2 cups"},
            ],
            "instructions": ["Preheat oven to 350°F (175°C)"],
        }
        edited = copy.deepcopy(recipe)
        edited.update(
            title="S09 asparagus oat bowl",
            cooking_time="30 min",
            special_preferences=["Vegan"],
        )
        edited["ingredients"][0].update(name="Asparagus", amount="250 g")
        edited["ingredients"][1].update(name="Oats", amount="1 cup")
        recipes = [recipe, edited]
        ids = ["s09-reader-test-" + str(uuid.uuid4()) for _ in recipes]

        async def run_one(current, test_id):
            body = {
                "threadId": str(uuid.uuid4()),
                "runId": str(uuid.uuid4()),
                "state": {"recipe": current},
                "messages": [
                    {
                        "id": str(uuid.uuid4()),
                        "role": "user",
                        "content": "Create a delicious Italian pasta recipe.",
                    }
                ],
                "tools": [],
                "context": [],
                "forwardedProps": {},
            }
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://local"
            ) as client:
                response = await client.post(
                    "/shared_state_read/",
                    json=body,
                    headers={
                        "x-test-id": test_id,
                        "x-aimock-context": "pydantic-ai",
                        "x-aimock-strict": "true",
                    },
                )
            self.assertEqual(response.status_code, 200)
            events = [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]
            self.assertFalse(
                any(event["type"] == "RUN_ERROR" for event in events), events
            )
            self.assertEqual(
                sum(event["type"] == "RUN_FINISHED" for event in events), 1
            )
            self.assert_recipe_read_only(events, current)

        await asyncio.gather(
            *(run_one(current, test_id) for current, test_id in zip(recipes, ids))
        )
        async with httpx.AsyncClient(trust_env=False) as client:
            response = await client.get(
                os.environ["AIMOCK_URL"].rstrip("/") + "/__aimock/journal"
            )
            response.raise_for_status()
            journal = response.json()
        for current, test_id in zip(recipes, ids):
            requests = [
                entry
                for entry in journal
                if entry.get("headers", {}).get("x-test-id") == test_id
            ]
            self.assertEqual(len(requests), 1)
            request = requests[0]["body"]
            self.assertFalse(
                request.get("tools"), "recipe reader must not expose mutation tools"
            )
            prompts = "\n".join(
                message.get("content", "")
                for message in request["messages"]
                if message["role"] in ("system", "developer")
            )
            marker = "Current UI recipe JSON:\n"
            self.assertIn(marker, prompts)
            actual, _ = json.JSONDecoder().raw_decode(prompts.split(marker, 1)[1])
            self.assertEqual(actual, current)


if __name__ == "__main__":
    unittest.main()
