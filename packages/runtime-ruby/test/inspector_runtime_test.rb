# frozen_string_literal: true
require 'minitest/autorun'
require 'stringio'
require 'copilotkit/runtime'

class InspectorRuntimeTest < Minitest::Test
  def with_runtime(provider, reports: [])
    transport = Object.new
    transport.define_singleton_method(:request, &provider)
    sdk = CopilotKit::Intelligence.new(api_key: 'server-key', transport: transport)
    runtime = CopilotKit::Runtime.new(intelligence: sdk,
      identify_user: ->(_) { raise 'display metadata must not resolve an app user' },
      on_error: ->(error) { reports << error }, telemetry: CopilotKit::Telemetry.new(disabled: true))
    yield runtime, sdk
  ensure
    runtime&.close
  end

  def test_rack_metadata_is_sanitized_private_and_uses_the_shared_sdk
    requests = []
    transport = Object.new
    transport.define_singleton_method(:request) do |*args|
      requests << args
      { 'schemaVersion' => 1, 'plan' => { 'code' => 'team', 'label' => 'Team', 'private' => 'secret' } }
    end
    sdk = CopilotKit::Intelligence.new(api_key: 'server-key', transport: transport)
    runtime = CopilotKit::Runtime.new(intelligence: sdk, base_path: '/copilotkit',
      identify_user: ->(_) { nil }, telemetry: CopilotKit::Telemetry.new(disabled: true))

    response = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/copilotkit/inspector-metadata',
      'HTTP_AUTHORIZATION' => 'Bearer browser-key', 'HTTP_COOKIE' => 'session=private', 'rack.input' => StringIO.new(''))
    info = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/copilotkit/info')

    assert_equal 200, response[0]
    assert_equal 'no-store, private', response[1]['cache-control']
    assert_equal({ 'schemaVersion' => 1, 'plan' => { 'code' => 'team', 'label' => 'Team' } }, JSON.parse(response[2].join))
    assert_equal [['GET', '/api/inspector/metadata', nil, {}], ['GET', '/api/entitlements/runtime', nil, {}]], requests
    assert_equal true, JSON.parse(info[2].join)['inspectorMetadata']
  ensure
    runtime&.close
  end

  def test_absence_and_provider_failures_have_empty_private_responses
    [nil, {}, [], { 'schemaVersion' => 2 }, CopilotKit::Error.new(404, 'provider-secret-payload'),
     CopilotKit::Error.new(403, 'provider-secret-payload'), CopilotKit::Error.new(503, 'provider-secret-payload'),
     Timeout::Error.new('provider-secret-payload')].each do |value|
      reports = []
      provider = ->(*) { raise value if value.is_a?(Exception); value }
      with_runtime(provider, reports: reports) do |runtime, _|
        response = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/inspector-metadata')
        assert_equal 204, response[0]
        assert_equal 'no-store, private', response[1]['cache-control']
        assert_empty response[2]
        refute response[1].key?('content-type')
      end
      if value.is_a?(Exception) && !(value.is_a?(CopilotKit::Error) && value.status == 404)
        assert_equal 1, reports.length
        refute_includes reports.first.full_message, 'provider-secret-payload'
      else
        assert_empty reports
      end
    end
  end

  def test_wrong_methods_stop_before_user_resolution_and_provider_io
    calls = []
    with_runtime(->(*args) { calls << args; nil }) do |runtime, _|
      %w[POST PATCH PUT DELETE].each do |method|
        response = runtime.call('REQUEST_METHOD' => method, 'PATH_INFO' => '/inspector-metadata',
          'rack.input' => StringIO.new('not JSON'))
        assert_equal 405, response[0]
        assert_equal 'GET', response[1]['allow']
        assert_equal 'no-store, private', response[1]['cache-control']
      end
    end
    assert_empty calls
  end

  def test_custom_sdk_metadata_is_sanitized_again_at_the_rack_boundary
    with_runtime(->(*) { raise 'unexpected transport call' }) do |runtime, sdk|
      sdk.define_singleton_method(:get_inspector_metadata) do
        { 'schemaVersion' => 1, 'license' => { 'state' => 'valid', 'private' => 'secret' },
          'action' => { 'kind' => 'renew', 'url' => 'https://cloud.test?key=secret' } }
      end

      response = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/inspector-metadata')

      assert_equal 200, response[0]
      assert_equal({ 'schemaVersion' => 1, 'license' => { 'state' => 'valid' } }, JSON.parse(response[2].join))
    end
  end
end
