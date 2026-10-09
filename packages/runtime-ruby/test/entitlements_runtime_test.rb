# frozen_string_literal: true
require 'minitest/autorun'
require 'copilotkit/runtime'

class EntitlementsRuntimeTest < Minitest::Test
  def with_runtime(&provider)
    transport = Object.new
    transport.define_singleton_method(:request, &provider)
    sdk = CopilotKit::Intelligence.new(api_key: 'server-key', transport: transport)
    runtime = CopilotKit::Runtime.new(intelligence: sdk,
      identify_user: ->(_) { raise 'discovery must not resolve an app user' },
      telemetry: CopilotKit::Telemetry.new(disabled: true))
    [runtime, sdk]
  end

  def test_info_uses_the_sdk_cache_and_normalizes_legacy_entitlements
    payload = { 'organizationId' => 'org', 'active' => true, 'source' => 'managedOrgSubscription', 'features' => {}, 'limits' => {} }
    calls = []
    runtime, sdk = with_runtime { |*args| calls << args; payload }
    direct = sdk.get_runtime_entitlements

    response = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/info')

    assert_equal 200, response.first
    body = JSON.parse(response.last.join)
    assert_equal direct, body['runtimeEntitlements']
    assert_equal 'valid', body['licenseStatus']
    assert_equal 1, calls.length
  ensure
    runtime&.close
  end

  def test_info_preserves_nonready_and_request_failure_semantics
    [[CopilotKit::Error.new(401, 'provider-secret-payload'), 'misconfigured', false, 'none'],
     [{}, 'misconfigured', false, 'none'],
     [CopilotKit::Error.new(503, 'provider-secret-payload'), 'unavailable', true, 'unknown'],
     [{ 'status' => 'degraded', 'error' => { 'code' => 'WAIT', 'message' => 'Try later', 'retryable' => true } }, 'degraded', true, 'unknown']].each do |payload, status, retryable, license|
      runtime, = with_runtime { |*| raise payload if payload.is_a?(Exception); payload }
      begin
        response = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/info')
        assert_equal 200, response.first
        body = JSON.parse(response.last.join)
        assert_equal status, body['runtimeEntitlements']['status']
        assert_equal retryable, body['runtimeEntitlements']['error']['retryable']
        assert_equal license, body['licenseStatus']
        refute_includes response.last.join, 'provider-secret-payload'
      ensure
        runtime.close
      end
    end
  end
end
