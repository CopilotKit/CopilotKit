# frozen_string_literal: true

require_relative "spec_helper"

# U5 (spec §5) — Ruby env + service-ref + resource preflight (Stage 2).
#
#   §5.2 service-ref assertion (REFUSE): each promote target carrying
#        `serviceRefs` must have its prod env var (e.g. OPENAI_BASE_URL) point at
#        the env-LOCAL target host (prod->prod aimock). A prod ref pointing at
#        the STAGING target host => REFUSE (the ms-agent-dotnet class). ASSERT,
#        never copy.
#   §5.3.1 replicate-class env-write (NEW capability): for declared replicate
#        keys, copy staging->prod value via the variable*Upsert family, verified
#        by re-read. Default replicate set is EMPTY (opt-in per service); the
#        MECHANISM + assertion path lands even with no opt-in keys.
#   §5.3.2/5.3.3 assert prod-specific keys present + prod-shaped (NEVER copy);
#        assert secret KEY presence (never value).
#   §5.4 concurrency DETECT-and-WARN: concurrency env vars (e.g.
#        BROWSER_POOL_SIZE) join the WARN-class divergence set
#        (region/replicas/restartPolicy already WARN). DETECT ONLY — never set.
#        (A limitOverride CPU/memory-cap WARN was dropped: Railway exposes no
#        readable limit field on ServiceInstance, so it was unimplementable
#        dead code — see test_snapshot_graphql.rb regression guard.)
#
# RISK R-A (HIGH — env clobber): a prod-specific key (e.g. a domain like
# NEXT_PUBLIC_POCKETBASE_URL) must be ASSERTED, NEVER written/copied. The
# fourth test below proves no upsert is issued for a prod-specific mismatch.
class PromoteU5EnvServiceRefTest < Minitest::Test
    # A fake gql that records every mutation issued and answers variable reads
    # from an in-memory per-(serviceId,envId) value map. Tests seed values and
    # assert on @mutations to prove "asserted, never copied".
    class FakeGql
        attr_reader :mutations

        # values: { [service_id, env_id] => { "KEY" => "value", ... } }
        def initialize(values: {})
            @values = values
            @mutations = []
        end

        def query(query, variables = {})
            if query.include?("variableUpsert") || query.include?("variableCollectionUpsert")
                @mutations << { kind: :upsert, variables: variables }
                sid = variables[:serviceId] || variables["serviceId"]
                eid = variables[:envId] || variables["environmentId"] || variables["envId"]
                name = variables[:name] || variables["name"]
                val  = variables[:value] || variables["value"]
                (@values[[sid, eid]] ||= {})[name] = val if name
                return { "variableUpsert" => true }
            end

            if query.include?("query EnvServiceVariables")
                sid = variables[:serviceId] || variables["serviceId"]
                eid = variables[:envId] || variables["environmentId"] || variables["envId"]
                # Railway returns a flat JSON scalar map { "NAME" => "value" }.
                return { "variables" => (@values[[sid, eid]] || {}) }
            end

            @mutations << { kind: :other, query: query, variables: variables }
            {}
        end
    end

    def cmd
        c = Railway::PromoteCommand.new(["--non-interactive", "--yes"])
        c.parser.parse!(c.argv)
        c
    end

    PROD_ENV = Railway::PRODUCTION_ENV_ID
    STG_ENV  = Railway::STAGING_ENV_ID

    # ── §5.2 service-ref assertion (REFUSE) ─────────────────────────────────

    def test_serviceref_prod_pointing_at_staging_aimock_refuses
        # showcase-ag2 carries serviceRefs:[{key:OPENAI_BASE_URL,target:aimock}].
        # aimock prod host = showcase-aimock-production.up.railway.app.
        c = cmd
        c.instance_variable_set(:@gql, FakeGql.new(values: {
            ["ag2-prod", PROD_ENV] => {
                # WRONG: prod points at the STAGING aimock host.
                "OPENAI_BASE_URL" => "https://aimock-staging.up.railway.app",
            },
        }))
        staging = { "services" => [{ "name" => "showcase-ag2", "service_id" => "ag2-stg" }] }
        prod    = { "services" => [{ "name" => "showcase-ag2", "service_id" => "ag2-prod" }] }
        findings = c.check_service_refs(staging, prod)
        assert(findings.any? { |f| f.start_with?("REFUSE") && f =~ /OPENAI_BASE_URL/ },
               "expected REFUSE for prod serviceRef pointing at staging host, got #{findings.inspect}")
        assert(c.instance_variable_get(:@gql).mutations.none? { |m| m[:kind] == :upsert },
               "service-ref check must ASSERT, never upsert")
    end

    def test_serviceref_prod_pointing_at_prod_aimock_passes
        c = cmd
        c.instance_variable_set(:@gql, FakeGql.new(values: {
            ["ag2-prod", PROD_ENV] => {
                "OPENAI_BASE_URL" => "https://showcase-aimock-production.up.railway.app",
            },
        }))
        staging = { "services" => [{ "name" => "showcase-ag2", "service_id" => "ag2-stg" }] }
        prod    = { "services" => [{ "name" => "showcase-ag2", "service_id" => "ag2-prod" }] }
        findings = c.check_service_refs(staging, prod)
        assert_empty findings.select { |f| f.start_with?("REFUSE") },
                     "prod->prod aimock ref must not REFUSE, got #{findings.inspect}"
    end

    # ── §5.3.1 replicate-class env-write (NEW capability) ───────────────────

    def test_replicate_key_value_diff_upserts_and_reread_green
        # Inject a replicate set (default is EMPTY) so the mechanism is exercised.
        c = cmd
        fake = FakeGql.new(values: {
            ["x-stg", STG_ENV]  => { "FEATURE_FLAG" => "on" },
            ["x-prod", PROD_ENV] => { "FEATURE_FLAG" => "off" },
        })
        c.instance_variable_set(:@gql, fake)
        staging = { "services" => [{ "name" => "x", "service_id" => "x-stg" }] }
        prod    = { "services" => [{ "name" => "x", "service_id" => "x-prod" }] }
        findings = c.replicate_env_keys(staging, prod, replicate_keys: %w[FEATURE_FLAG])
        # mechanism issued the upsert to prod with staging's value
        upserts = fake.mutations.select { |m| m[:kind] == :upsert }
        assert_equal 1, upserts.size, "expected exactly one upsert, got #{fake.mutations.inspect}"
        up = upserts.first[:variables]
        assert_equal "FEATURE_FLAG", (up[:name] || up["name"])
        assert_equal "on", (up[:value] || up["value"])
        assert_equal PROD_ENV, (up[:envId] || up["environmentId"] || up["envId"])
        # re-read confirms prod now carries staging's value (verified-by-re-read)
        assert(findings.any? { |f| f =~ /replicat/i && f =~ /FEATURE_FLAG/ },
               "expected a replicate report line, got #{findings.inspect}")
        refute(findings.any? { |f| f.start_with?("REFUSE") }, "replicate must not REFUSE on success")
    end

    def test_default_replicate_set_is_empty_no_writes
        c = cmd
        fake = FakeGql.new(values: {
            ["x-stg", STG_ENV]  => { "FEATURE_FLAG" => "on" },
            ["x-prod", PROD_ENV] => { "FEATURE_FLAG" => "off" },
        })
        c.instance_variable_set(:@gql, fake)
        staging = { "services" => [{ "name" => "x", "service_id" => "x-stg" }] }
        prod    = { "services" => [{ "name" => "x", "service_id" => "x-prod" }] }
        # default (no replicate_keys argument) => empty set => no writes
        c.replicate_env_keys(staging, prod)
        assert(fake.mutations.none? { |m| m[:kind] == :upsert },
               "default replicate set must be EMPTY (no upserts), got #{fake.mutations.inspect}")
    end

    # ── R-A (HIGH): prod-specific key ASSERTED, NEVER written ───────────────

    def test_prod_specific_key_mismatch_refuses_and_never_writes
        c = cmd
        fake = FakeGql.new(values: {
            ["dash-stg", STG_ENV]  => { "NEXT_PUBLIC_POCKETBASE_URL" => "https://pb.staging.copilotkit.ai" },
            # prod MISSING the prod-specific key entirely => mismatch.
            ["dash-prod", PROD_ENV] => {},
        })
        c.instance_variable_set(:@gql, fake)
        staging = { "services" => [{ "name" => "dashboard", "service_id" => "dash-stg" }] }
        prod    = { "services" => [{ "name" => "dashboard", "service_id" => "dash-prod" }] }
        findings = c.assert_prod_specific_keys(staging, prod, prod_specific_keys: %w[NEXT_PUBLIC_POCKETBASE_URL])
        assert(findings.any? { |f| f.start_with?("REFUSE") && f =~ /NEXT_PUBLIC_POCKETBASE_URL/ },
               "expected REFUSE for missing prod-specific key, got #{findings.inspect}")
        # CRITICAL R-A: no upsert/write issued for the prod-specific key.
        assert(fake.mutations.none? { |m| m[:kind] == :upsert },
               "prod-specific key must be ASSERTED, NEVER copied/written, got #{fake.mutations.inspect}")
    end

    # ── §5.4 resource/concurrency DETECT-and-WARN (never REFUSE) ────────────

    # NOTE: a limitOverride (CPU/memory cap) divergence WARN was originally
    # specified for check_resource_divergence, but Railway's GraphQL schema
    # exposes no readable limit field on ServiceInstance (verified by
    # introspection — the only related surface is the write-only
    # serviceInstanceLimitsUpdate mutation). build_snapshot therefore cannot
    # capture the cap, so the WARN was dead code and has been dropped. See
    # test_snapshot_graphql.rb#test_limit_override_warn_is_unimplementable_via_real_snapshot
    # for the regression guard proving it through the real snapshot path.

    def test_concurrency_env_divergence_is_advisory_not_refuses
        # Concurrency knobs (BROWSER_POOL_SIZE) are a RESOURCE/scaling signal,
        # not a functional contract — divergence is ADVISORY (report-only,
        # never blocks) per the 2026-06-22 prod↔staging comparison policy.
        c = cmd
        staging = { "services" => [svc("x", "x-stg", "env_keys" => %w[BROWSER_POOL_SIZE])] }
        prod    = { "services" => [svc("x", "x-prod", "env_keys" => [])] }
        findings = c.check_resource_divergence(staging, prod)
        assert(findings.any? { |f| f.start_with?("ADVISORY") && f =~ /BROWSER_POOL_SIZE/ },
               "expected ADVISORY for concurrency env divergence, got #{findings.inspect}")
        assert(findings.none? { |f| f.start_with?("REFUSE") || f.start_with?("WARN") })
    end

    private

    def svc(name, sid, over = {})
        { "name" => name, "service_id" => sid }.merge(over)
    end
end
