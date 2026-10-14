# Bounded Railway lifecycle

The next merge boundary uses the PNI-605 Railway provider. See
[the provider contract](railway/README.md) for private configuration, ownership,
readiness, durable supervisor authority, registry distribution and cleanup.
The former Docker development implementation and row5 restart assertions are
preserved in the refs listed in [the inventory](../preservation.json).

The common bootstrap calls `createEnvironment({config, runId, frameworks,
outputDir, signal})`, independently verifies clean stores, uses provider-returned
scopes, runs the two bounded journeys serially and always awaits cleanup. Only
owned resources may be deleted. Missing approvals or controller bindings block
provisioning; they do not permit a local fixture substitution.

The controller invokes the supervisor for each attempt. The supervisor directly
spawns the Node worker. The deliberate failed-run control uses
`--expected-worker-exit=1` and still requires a normal worker exit, successful
recovery and no remaining active lease. The common controller additionally
requires both real framework journeys to have passed before failure injection.

An external durable recovery service is required for supervisor loss or host
outage. Unit controls do not establish that service's deployment or prove those
failure modes on Railway. Retain explicit operational qualifications in reports.
