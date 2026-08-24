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

In `docker` mode (the default `backend_deployment_type`) this single apply also
builds the agent's ARM64 image and pushes it to ECR before creating the runtime,
so no separate build step is needed. `scripts/build-and-push-image.sh` exists for
CI or for rebuilding the image on its own.

## Testing the deployed agent

Stay in `infra-terraform/` and run this directory's tester. It imports `boto3`,
`requests` and `colorama`, which come from the example-root `pyproject.toml`, so
run it under uv. No `--project` flag: uv finds the example-root project by
walking up from `infra-terraform/`, and `uv run` resolves the script path against
your shell's directory, not the project's — so `scripts/test-agent.py` is this
directory's tester either way. The first run creates and syncs the example-root
`.venv`:

```bash
uv run scripts/test-agent.py 'Hello'
```

## Deploying the frontend

`scripts/deploy-frontend.py` is the Terraform-side frontend deployer — it reads
the Amplify app id and staging bucket from `terraform output`, where the
example-root `scripts/deploy-frontend.py` is the CDK variant that reads
`aws cloudformation describe-stacks` and takes a stack-name argument.

**This path does not currently work.** The script also requires a Terraform
output named `feedback_api_url`, and no root or module `outputs.tf` declares one
— `modules/backend/ssm.tf` has an SSM parameter of that name, which is not an
output. So every run stops here and exits 1:

```
ℹ Generating aws-exports.json...
✗ Missing required Terraform outputs: feedback_api_url
```

It gets that far and no further: no build, no upload, no Amplify deployment. Use
`infra-cdk/` if you need a deployed frontend today. Fixing this — declaring the
output or dropping the requirement — is tracked separately.

Once it is fixed, the invocation is:

```bash
uv run --no-project scripts/deploy-frontend.py
```

`--no-project` is there because this script imports only the Python standard
library, so `uv` has no reason to sync the example-root virtualenv; it still
provisions the interpreter. uv is optional here — a plain
`python3 scripts/deploy-frontend.py` behaves identically, needing only Python
3.8+ plus the `aws`, `npm`, `node` and `terraform` CLIs.

The agent pattern defaults to `backend_pattern` from `terraform.tfvars`. Override
it with `--pattern`:

```bash
uv run --no-project scripts/deploy-frontend.py --pattern langgraph-single-agent
```
