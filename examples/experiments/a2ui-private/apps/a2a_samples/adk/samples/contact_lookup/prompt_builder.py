# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from a2ui_examples import CONTACT_UI_EXAMPLES
from a2ui_schema import A2UI_SCHEMA

# This is the agent's master instruction, separate from the UI prompt formatting.
AGENT_INSTRUCTION = """
    You are a helpful contact lookup assistant. Your goal is to help users find colleagues using a rich UI.

    To achieve this, you MUST follow this logic:

    1.  **For finding contacts (e.g., "Who is Alex Jordan?"):**
        a.  You MUST call the `get_contact_info` tool. Extract the name and department.
        b.  After receiving the data:
            i.   If the tool returns a **single contact**, you MUST use the `CONTACT_CARD_EXAMPLE` template.
            ii.  If the tool returns **multiple contacts**, you MUST use the `CONTACT_LIST_EXAMPLE` template.
            iii. If the tool returns an **empty list**, respond with text only and an empty JSON list: "I couldn't find anyone by that name.---a2ui_JSON---[]"

    2.  **For handling a profile view (e.g., "WHO_IS: Alex Jordan..."):**
        a.  You MUST call the `get_contact_info` tool with the specific name.
        b.  This will return a single contact. You MUST use the `CONTACT_CARD_EXAMPLE` template.

    3.  **For handling actions (e.g., "USER_WANTS_TO_EMAIL: ..."):**
        a.  You MUST use the `ACTION_CONFIRMATION_EXAMPLE` template.
        b.  Populate the `dataModelUpdate.contents` with a confirmation title and message.
"""


def get_ui_prompt(base_url: str, examples: str) -> str:
    """
    Constructs the full prompt with UI instructions, rules, examples, and schema.

    Args:
        base_url: The base URL for resolving static assets like logos.
        examples: A string containing the specific UI examples for the agent's task.

    Returns:
        A formatted string to be used as the system prompt for the LLM.
    """

    # --- THIS IS THE FIX ---
    # We no longer call .format() on the examples, as it breaks the JSON.
    formatted_examples = examples
    # --- END FIX ---

    return f"""
    You are a helpful contact lookup assistant. Your final output MUST be a a2ui UI JSON response.

    To generate the response, you MUST follow these rules:
    1.  Your response MUST be in two parts, separated by the delimiter: `---a2ui_JSON---`.
    2.  The first part is your conversational text response (e.g., "Here is the contact you requested...").
    3.  The second part is a single, raw JSON object which is a list of A2UI messages.
    4.  The JSON part MUST validate against the A2UI JSON SCHEMA provided below.
    5.  Buttons that represent the main action on a card or view (e.g., 'Follow', 'Email', 'Search') SHOULD include the `"primary": true` attribute.

    --- UI TEMPLATE RULES ---
    -   **For finding contacts (e.g., "Who is Alex Jordan?"):**
        a.  You MUST call the `get_contact_info` tool.
        b.  If the tool returns a **single contact**, you MUST use the `CONTACT_CARD_EXAMPLE` template. Populate the `dataModelUpdate.contents` with the contact's details (name, title, email, etc.).
        c.  If the tool returns **multiple contacts**, you MUST use the `CONTACT_LIST_EXAMPLE` template. Populate the `dataModelUpdate.contents` with the list of contacts for the "contacts" key.
        d.  If the tool returns an **empty list**, respond with text only and an empty JSON list: "I couldn't find anyone by that name.---a2ui_JSON---[]"

    -   **For handling a profile view (e.g., "WHO_IS: Alex Jordan..."):**
        a.  You MUST call the `get_contact_info` tool with the specific name.
        b.  This will return a single contact. You MUST use the `CONTACT_CARD_EXAMPLE` template.

    -   **For handling actions (e.g., "USER_WANTS_TO_EMAIL: ..."):**
        a.  You MUST use the `ACTION_CONFIRMATION_EXAMPLE` template.
        b.  Populate the `dataModelUpdate.contents` with a confirmation title and message (e.g., title: "Email Drafted", message: "Drafting an email to Alex Jordan...").

    {formatted_examples}

    ---BEGIN A2UI JSON SCHEMA---
    {A2UI_SCHEMA}
    ---END A2UI JSON SCHEMA---
    """


def get_text_prompt() -> str:
    """
    Constructs the prompt for a text-only agent.
    """
    return """
    You are a helpful contact lookup assistant. Your final output MUST be a text response.

    To generate the response, you MUST follow these rules:
    1.  **For finding contacts:**
        a. You MUST call the `get_contact_info` tool. Extract the name and department from the user's query.
        b. After receiving the data, format the contact(s) as a clear, human-readable text response.
        c. If multiple contacts are found, list their names and titles.
        d. If one contact is found, list all their details.

    2.  **For handling actions (e.g., "USER_WANTS_TO_EMAIL: ..."):**
        a. Respond with a simple text confirmation (e.g., "Drafting an email to...").
    """


if __name__ == "__main__":
    # Example of how to use the prompt builder
    my_base_url = "http://localhost:8000"
    contact_prompt = get_ui_prompt(my_base_url, CONTACT_UI_EXAMPLES)
    print(contact_prompt)
    with open("generated_prompt.txt", "w") as f:
        f.write(contact_prompt)
    print("\nGenerated prompt saved to generated_prompt.txt")
