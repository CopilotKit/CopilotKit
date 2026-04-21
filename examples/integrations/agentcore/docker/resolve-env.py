"""
Resolves STACK_NAME and MEMORY_ID from config.yaml + CloudFormation
and writes them to /env/agent.env for the agent container.
"""

import os
import re

import boto3
import yaml

with open("/config.yaml") as f:
    cfg = yaml.safe_load(f)

base = re.sub(r"-(lg|st)$", "", cfg["stack_name_base"])
agent = os.environ.get("AGENT", "strands")
suffix = "lg" if agent == "langgraph" else "st"
stack_name = f"{base}-{suffix}"

cf = boto3.client("cloudformation", region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
stacks = cf.describe_stacks(StackName=stack_name)["Stacks"]
outputs = {o["OutputKey"]: o["OutputValue"] for s in stacks for o in s.get("Outputs", [])}

memory_arn = outputs.get("MemoryArn", "")
memory_id = memory_arn.split("/")[-1] if "/" in memory_arn else memory_arn

os.makedirs("/out", exist_ok=True)
with open("/out/agent.env", "w") as f:
    f.write(f"STACK_NAME={stack_name}\n")
    f.write(f"MEMORY_ID={memory_id}\n")

print(f"Stack: {stack_name}  |  Memory: {memory_id}")
