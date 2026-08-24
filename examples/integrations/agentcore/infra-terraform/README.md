# Terraform Infrastructure

Equivalent of `../infra-cdk/` using Terraform.

## Usage

Starting from the example root (`examples/integrations/agentcore/`):

```bash
cd infra-terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set stack_name_base, backend_pattern, aws_region

terraform init
terraform plan
terraform apply
```

After apply, stay in `infra-terraform/` and run this directory's frontend
deploy script — it reads the Amplify app id and staging bucket from
`terraform output`. (The example-root `scripts/deploy-frontend.py` is the CDK
variant: it reads `aws cloudformation describe-stacks` and takes a stack name
argument, so it cannot read a Terraform deployment.)

`scripts/deploy-frontend.py` imports only the Python standard library, so it
needs nothing from the example-root `pyproject.toml`. Run it with
`--no-project` so `uv` skips syncing a virtualenv the script never touches:

```bash
uv run --no-project scripts/deploy-frontend.py
```

(A plain `python3 scripts/deploy-frontend.py` works just as well — it only
needs Python 3.8+, plus the `aws`, `npm`, `node` and `terraform` CLIs.)

The agent pattern defaults to `backend_pattern` from `terraform.tfvars`.
Override it with `--pattern`:

```bash
uv run --no-project scripts/deploy-frontend.py --pattern langgraph-single-agent
```

The sibling `scripts/test-agent.py` is different: it does import third-party
packages (`boto3`, `requests`, `colorama`), which come from the example-root
`pyproject.toml`. Drop `--no-project` for that one — `uv` finds the example-root
project by walking up from `infra-terraform/`, so no `--project ..` is needed
either. The first run creates and syncs the example-root `.venv`:

```bash
uv run scripts/test-agent.py 'Hello'
```
