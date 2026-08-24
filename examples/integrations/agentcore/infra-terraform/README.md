# Terraform Infrastructure

Equivalent of `../infra-cdk/` using Terraform.

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
uv run scripts/deploy-frontend.py
```
