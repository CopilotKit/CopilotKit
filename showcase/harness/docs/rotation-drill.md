# SHARED_SECRET rotation drill

This runbook walks through how to swap the shared password that
`showcase-harness` uses to check that deploy-result webhooks are really
coming from our own `showcase_deploy.yml` workflow (spec §4.5).

## Glossary (plain English)

- **Shared secret**: a random string known to both the sender (GitHub
  Actions) and the receiver (showcase-harness). The sender uses it to sign
  each webhook; the receiver uses it to check the signature.
- **Signer**: the side that uses the secret to sign outgoing webhooks —
  in our case, the GitHub Actions workflow.
- **Verifier**: the side that uses the secret to check signatures on
  incoming webhooks — in our case, the showcase-harness service.
- **Overlap window**: the short period during a rotation when both the
  old and new secrets are valid, so an in-flight request signed with
  the old secret still gets accepted.
- **Rotation**: retiring the old secret and putting a new one in place
  without dropping any webhook deliveries.

The service accepts either `SHARED_SECRET` **or** `SHARED_SECRET_PREV`
as a valid signing key (see `orchestrator.ts` — both are loaded into
the `webhookSecrets` array). This is what makes a clean, no-downtime
rotation possible.

## Invariants

- There MUST be exactly **two** valid secrets accepted at any point
  during the drill: the one GitHub Actions is currently signing with,
  plus the previous one the service still accepts.
- The service MUST remain able to check both old and new signatures
  during the overlap window.
- The overlap window is ≥ 10 minutes — long enough for any in-flight
  GitHub Actions job to finish with the old secret.

## Procedure

**1. Generate the new secret.**

```sh
python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

**2. Stage it as the NEW value on Railway.**

Set `SHARED_SECRET_NEW` on the showcase-harness service — a temporary
holding slot. Do NOT yet promote it to `SHARED_SECRET`.

```sh
railway variables --service showcase-harness --set SHARED_SECRET_NEW="<new>"
```

**3. Roll the verifier forward (step A).**

First, assert the staged NEW value is actually present — skipping this
check turns a fat-fingered step 2 into a silent outage (the verifier
would promote an empty string as the new signer).

```sh
STAGED=$(railway variables --service showcase-harness --json | jq -r '.SHARED_SECRET_NEW // empty')
if [ -z "$STAGED" ]; then
  echo "FATAL: SHARED_SECRET_NEW is empty on showcase-harness; re-run step 2 first" >&2
  exit 1
fi
```

Then on showcase-harness:

- Move the existing `SHARED_SECRET` → `SHARED_SECRET_PREV`
- Move `SHARED_SECRET_NEW` → `SHARED_SECRET`
- Unset `SHARED_SECRET_NEW`

```sh
CURRENT=$(railway variables --service showcase-harness --json | jq -r .SHARED_SECRET)
railway variables --service showcase-harness --set SHARED_SECRET_PREV="$CURRENT"
railway variables --service showcase-harness --set SHARED_SECRET="$STAGED"
# Remove the staging slot. Recent Railway CLI uses `--unset`; older
# versions used `--remove`. Detect CLI capability upfront rather than
# relying on `A || B` — a transient auth/network failure on `--unset`
# would incorrectly fall through to `--remove`, which on a modern CLI
# is itself an unknown-flag error and could mask the real cause.
if railway variables --help 2>&1 | grep -q -- '--unset'; then
  UNSET_FLAG=--unset
elif railway variables --help 2>&1 | grep -q -- '--remove'; then
  UNSET_FLAG=--remove
else
  echo "railway CLI supports neither --unset nor --remove for variables; upgrade CLI" >&2
  exit 1
fi
railway variables --service showcase-harness "$UNSET_FLAG" SHARED_SECRET_NEW
```

Railway will redeploy. Wait for `/health` to return 200. The verifier
now accepts both old + new signatures.

**4. Roll the signer forward (step B).**

Update the GH Actions secret `SHOWCASE_HARNESS_SHARED_SECRET` in the repo
to the new value. From the CI side, this is a single write:

```sh
gh secret set SHOWCASE_HARNESS_SHARED_SECRET --repo CopilotKit/CopilotKit --body "<new>"
```

Trigger a test deploy (e.g. re-run `showcase_deploy.yml` against a
scratch branch) and confirm the `webhook.deploy.accepted` log appears
on showcase-harness. If it does, the signer is now using the new key.

**5. Close the overlap (step C).**

After ≥ 10 minutes — confirmed by zero `webhook.deploy.reject
{reason=bad-signature}` logs in the interim — remove the previous key:

```sh
railway variables --service showcase-harness --unset SHARED_SECRET_PREV \
  || railway variables --service showcase-harness --remove SHARED_SECRET_PREV
```

The service redeploys and from this point forward only the new
`SHARED_SECRET` is accepted.

## Verification

- `/health` returns 200 throughout the drill.
- At no point does `webhook.deploy.reject {reason=bad-signature}`
  appear in the logs (except intentionally during a negative test).
- After step 5, `grep SHARED_SECRET_PREV` returns no match in the
  service env.

## Rollback

If step 4 surfaces signer issues, revert `SHOWCASE_HARNESS_SHARED_SECRET` in
GH Actions to the old value. The verifier on showcase-harness still accepts
the old key (`SHARED_SECRET_PREV`), so rolling back the signer requires
no service change.

If step 3 surfaces verifier issues (the `SHARED_SECRET_PREV` slot is
kept specifically to give us an undo path without having to regenerate
the secret from scratch), set `SHARED_SECRET` back to the old value and
unset `SHARED_SECRET_PREV`.

## Cadence

Rotate every 90 days OR immediately on suspicion of compromise. Mark
the next rotation date in the team calendar when step 5 completes.
