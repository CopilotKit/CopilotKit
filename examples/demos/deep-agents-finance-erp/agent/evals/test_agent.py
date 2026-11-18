"""LangSmith evaluations for the Finance ERP agent.

Run with:
    python -m evals.test_agent

Requires LANGCHAIN_API_KEY and LANGCHAIN_PROJECT environment variables.
"""

from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()

from langsmith import Client
from langsmith.evaluation import aevaluate

# Dataset of (input, expected_output) pairs for evaluation
EVAL_DATASET = [
    {
        "input": "How many overdue invoices do we have?",
        "expected": "3 overdue invoice",
        "tags": ["invoices", "query"],
    },
    {
        "input": "What is our total revenue?",
        "expected": "$2,847,350",
        "tags": ["accounts", "query"],
    },
    {
        "input": "Which inventory items are out of stock?",
        "expected": "Cisco Catalyst 9300",
        "tags": ["inventory", "query"],
    },
    {
        "input": "Who is the CFO?",
        "expected": "Sarah Chen",
        "tags": ["hr", "query"],
    },
    {
        "input": "Generate a balance sheet",
        "expected": "BALANCE SHEET",
        "tags": ["reports", "generation"],
    },
    {
        "input": "What is our cash position?",
        "expected": "$1,245,000",
        "tags": ["accounts", "query"],
    },
    {
        "input": "Forecast revenue for the next 4 quarters",
        "expected": "Q2 2026",
        "tags": ["analytics", "forecast"],
    },
    {
        "input": "What are the low stock items?",
        "expected": "MacBook Pro",
        "tags": ["inventory", "alerts"],
    },
]

DATASET_NAME = "finance-erp-agent-evals"


def create_or_update_dataset():
    """Push eval dataset to LangSmith."""
    client = Client()

    try:
        dataset = client.read_dataset(dataset_name=DATASET_NAME)
    except Exception:
        dataset = client.create_dataset(
            dataset_name=DATASET_NAME,
            description="Evaluation dataset for the Finance ERP deep agent",
        )

    for example in EVAL_DATASET:
        client.create_example(
            inputs={"question": example["input"]},
            outputs={"answer": example["expected"]},
            dataset_id=dataset.id,
            metadata={"tags": example["tags"]},
        )

    print(f"Dataset '{DATASET_NAME}' created with {len(EVAL_DATASET)} examples.")
    return dataset


def contains_expected(run, example) -> dict:
    """Check if the agent output contains the expected substring."""
    output = (run.outputs or {}).get("output", "")
    expected = (example.outputs or {}).get("answer", "")
    return {
        "key": "contains_expected",
        "score": 1.0 if expected.lower() in output.lower() else 0.0,
    }


async def run_evaluation():
    """Run LangSmith evaluation against the agent."""
    from agent import finance_erp_graph

    async def predict(inputs: dict) -> dict:
        result = await finance_erp_graph.ainvoke(
            {"messages": [{"role": "user", "content": inputs["question"]}]}
        )
        last_message = result["messages"][-1]
        return {"output": last_message.content}

    results = await aevaluate(
        predict,
        data=DATASET_NAME,
        evaluators=[contains_expected],
        experiment_prefix="finance-erp-eval",
        metadata={"version": "0.1.0"},
    )

    print(f"Evaluation complete. Results: {results}")
    return results


if __name__ == "__main__":
    import asyncio
    import sys

    if "--create-dataset" in sys.argv:
        create_or_update_dataset()
    else:
        asyncio.run(run_evaluation())
