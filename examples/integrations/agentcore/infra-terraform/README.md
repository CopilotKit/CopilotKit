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

The Python dependencies live in the example-root `pyproject.toml`, so point
`uv` at that project with `--project ..`:

```bash
uv run --project .. scripts/deploy-frontend.py
```

The agent pattern defaults to `backend_pattern` from `terraform.tfvars`.
Override it with `--pattern`:

```bash
uv run --project .. scripts/deploy-frontend.py --pattern langgraph-single-agent
```
