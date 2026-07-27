# Terraform Infrastructure

Terraform support covers the base AgentCore agent, gateway, authentication, and
frontend infrastructure. It does not project managed Intelligence credentials
into the CopilotKit Runtime Lambda. Use the CDK deployment path documented in
`../README.md` when the managed Threads and Intelligence path is required.

## Usage

```bash
cd infra-terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set stack_name_base, backend_pattern, aws_region

terraform init
terraform plan
terraform apply
```

After apply, run the frontend deploy from the repo root:

```bash
python3 scripts/deploy-frontend.py
```
