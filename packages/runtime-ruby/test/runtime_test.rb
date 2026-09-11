# frozen_string_literal: true
require 'minitest/autorun'
require 'stringio'
require 'json'
require 'copilotkit/runtime'
require 'rack'

class RuntimeTest < Minitest::Test
  def build_runtime(**options)
    CopilotKit::Runtime.new(telemetry: CopilotKit::Telemetry.new(disabled: true), **options)
  end
  def request(runtime, method, path, body = {})
    status, _, chunks = runtime.call('REQUEST_METHOD' => method, 'PATH_INFO' => path, 'QUERY_STRING' => '', 'rack.input' => StringIO.new(JSON.generate(body)))
    [status, chunks.empty? ? nil : JSON.parse(chunks.join)]
  end

  def test_rejects_untrusted_identity_before_platform_access
    runtime = build_runtime(api_key: 'test-secret', identify_user: ->(_env) { nil })
    status, = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/threads', 'QUERY_STRING' => 'agentId=default', 'rack.input' => StringIO.new(''))
    assert_equal 401, status
  end

  def test_empty_key_fails_at_boot_without_echoing_secret
    error = assert_raises(ArgumentError) { build_runtime(api_key: ' ', identify_user: ->(_) { nil }) }
    assert_equal 'api_key is required', error.message
  end

  def test_memory_denies_write_to_user_scope_when_only_project_is_writable
    runtime = build_runtime(api_key: 'test-secret', api_url: 'http://127.0.0.1:1',
      identify_user: ->(_) { { 'id' => 'alice' } }, memory_access: ->(_, _) { { 'user' => 'none', 'project' => 'read-write' } })
    status, = request(runtime, 'POST', '/memories', 'content' => 'private fact', 'kind' => 'topical', 'scope' => 'user')
    assert_equal 403, status
  end

  def test_absent_memory_policy_delegates_to_platform_without_fabricating_grant
    runtime = build_runtime(api_key: 'test-secret', identify_user: ->(_) { { 'id' => 'alice' } })
    calls = []
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; { 'memories' => [] } }
    runtime.instance_variable_set(:@platform, platform)
    assert_equal 200, request(runtime, 'GET', '/memories').first
    assert_equal ['GET', '/api/memories', nil, { 'x-cpki-user-id' => 'alice' }], calls.first
    assert_equal 1, calls.length
  ensure
    runtime&.close
  end

  def test_unknown_agents_do_not_contact_platform
    runtime = build_runtime(api_key: 'test-secret', identify_user: ->(_) { { 'id' => 'alice' } })
    assert_equal 404, request(runtime, 'POST', '/agent/missing/run').first
  end

  def test_telemetry_discards_prompts_keys_and_user_ids
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 1, env: {})
    telemetry.emit('oss.runtime.agent_execution_stream_started', 'status' => 200, 'apiKey' => 'secret', 'userId' => 'alice', 'messages' => ['private'])
    telemetry.close
    assert_equal({}, events.first.fetch('properties'))
  end

  def test_telemetry_opt_out_never_calls_exporter
    telemetry = CopilotKit::Telemetry.new(disabled: true, exporter: ->(_) { flunk 'Exporter must not run' })
    telemetry.emit('runtime.request')
    assert telemetry.disabled?
  end

  def test_array_json_is_rejected
    runtime = build_runtime(api_key: 'test-secret', identify_user: ->(_) { { 'id' => 'alice' } })
    assert_equal 400, request(runtime, 'POST', '/annotate', []).first
  end

  def test_mounts_in_rack_and_obeys_no_content_header_contract
    runtime = build_runtime(api_key: 'test-secret', identify_user: ->(_) { nil })
    mounted = Rack::Builder.new { map('/copilotkit') { run Rack::Lint.new(runtime) } }.to_app
    response = Rack::MockRequest.new(mounted).options('/copilotkit/info')
    assert_equal 204, response.status
    assert_equal '', response.body
  end

  def test_application_error_callback_is_separate_and_cannot_fail_response
    failures = []
    runtime = build_runtime(api_key: 'test-secret', api_url: 'http://127.0.0.1:1',
      identify_user: ->(_) { { 'id' => 'alice' } }, agents: { 'default' => CopilotKit::Agent.new },
      on_error: ->(error) { failures << error; raise 'callback failed' })
    assert_equal 502, request(runtime, 'POST', '/agent/default/connect', 'threadId' => 'owned').first
    assert_equal 1, failures.length
    assert_instance_of CopilotKit::Error, failures.first
  end

  def test_stop_rejects_unauthorized_thread_before_touching_local_run
    runtime = build_runtime(api_key: 'test-secret', identify_user: ->(_) { { 'id' => 'alice' } }, agents: { 'default' => CopilotKit::Agent.new })
    platform = Object.new
    platform.define_singleton_method(:request) { |*_args| raise CopilotKit::Error.new(403, 'Forbidden') }
    runtime.instance_variable_set(:@platform, platform)
    assert_equal 403, request(runtime, 'POST', '/agent/default/stop/private', 'runId' => 'r').first
  end

  def test_invalid_memory_grant_is_a_server_error_without_upstream_access
    calls = []
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { 'id' => 'alice' } },
      memory_access: ->(_, _) { { 'user' => 'invalid', 'project' => 'none' } })
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; {} }
    runtime.instance_variable_set(:@platform, platform)
    assert_equal 500, request(runtime, 'GET', '/memories').first
    assert_empty calls
  ensure
    runtime&.close
  end

  def test_null_memory_grant_denies_without_upstream_access
    calls = []
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { 'id' => 'alice' } }, memory_access: ->(_, _) { nil })
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; {} }
    runtime.instance_variable_set(:@platform, platform)
    assert_equal 403, request(runtime, 'GET', '/memories').first
    assert_empty calls
  ensure
    runtime&.close
  end

  def test_explicit_none_memory_grants_deny_without_upstream_access
    calls = []
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { 'id' => 'alice' } },
      memory_access: ->(_, _) { { 'user' => 'none', 'project' => 'none' } })
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; {} }
    runtime.instance_variable_set(:@platform, platform)
    assert_equal 403, request(runtime, 'GET', '/memories').first
    assert_empty calls
  ensure
    runtime&.close
  end

  def test_throwing_memory_callback_fails_closed_without_upstream_access
    calls = []
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { 'id' => 'alice' } }, memory_access: ->(_, _) { raise 'Private policy failure' })
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; {} }
    runtime.instance_variable_set(:@platform, platform)
    status, body = request(runtime, 'GET', '/memories')
    assert_equal 500, status
    refute JSON.generate(body).include?('Private policy failure')
    assert_empty calls
  ensure
    runtime&.close
  end

  def test_symbol_identity_and_memory_policy_keys_normalize_at_callback_boundary
    calls = []
    trusted = nil
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { id: 'alice', name: 'Alice' } },
      memory_access: ->(user, _) { trusted = user; { user: 'read', project: 'none' } })
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; { 'memories' => [] } }
    runtime.instance_variable_set(:@platform, platform)
    assert_equal 200, request(runtime, 'GET', '/memories').first
    assert_equal({ 'id' => 'alice', 'name' => 'Alice' }, trusted)
    assert_equal({ 'user' => 'read', 'project' => 'none' }, JSON.parse(calls.first.last['x-cpki-memory-grant']))
    assert_equal 'alice', calls.first.last['x-cpki-user-id']
  ensure
    runtime&.close
  end

  def test_false_string_identity_is_not_replaced_by_symbol_alias
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { 'id' => false, id: 'alice' } })
    assert_equal 401, request(runtime, 'GET', '/memories').first
  ensure
    runtime&.close
  end

  def test_nil_string_grant_is_not_replaced_by_symbol_alias
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { 'id' => 'alice' } },
      memory_access: ->(_, _) { { 'user' => nil, user: 'read-write', project: 'none' } })
    assert_equal 500, request(runtime, 'GET', '/memories').first
  ensure
    runtime&.close
  end

  def test_unknown_symbol_grant_key_is_rejected_without_upstream_access
    calls = []
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { id: 'alice' } },
      memory_access: ->(_, _) { { user: 'read', unexpected: 'none' } })
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; {} }
    runtime.instance_variable_set(:@platform, platform)
    assert_equal 500, request(runtime, 'GET', '/memories').first
    assert_empty calls
  ensure
    runtime&.close
  end

  def stop_fixture(&lookup)
    runtime = build_runtime(api_key: 'fixture', identify_user: ->(_) { { 'id' => 'alice' } }, agents: { 'default' => CopilotKit::Agent.new })
    calls, stops = [], []
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; lookup.call }
    active = Struct.new(:thread_id, :run_id).new('canonical', 'active-run')
    active.define_singleton_method(:request_stop) { stops << true; true }
    runtime.instance_variable_set(:@platform, platform)
    runtime.instance_variable_set(:@runs, { 'active-run' => active })
    [runtime, calls, stops]
  end

  def test_stop_false_run_id_is_invalid_before_lookup
    runtime, calls, stops = stop_fixture { { 'thread' => { 'id' => 'canonical', 'agentId' => 'default' } } }
    assert_equal 400, request(runtime, 'POST', '/agent/default/stop/alias', 'runId' => false).first
    assert_empty calls
    assert_empty stops
  end

  def test_stop_alias_uses_canonical_thread_and_current_user_lookup
    runtime, calls, stops = stop_fixture { { 'thread' => { 'id' => 'canonical', 'agentId' => 'default' } } }
    status, result = request(runtime, 'POST', '/agent/default/stop/alias', 'runId' => 'active-run')
    assert_equal 200, status
    assert_equal true, result['stopped']
    assert_equal 1, stops.length
    assert_equal ['GET', '/api/threads/alias?userId=alice'], calls.first
  end

  def test_stop_revoked_ownership_does_not_cancel_existing_local_run
    runtime, calls, stops = stop_fixture { raise CopilotKit::Error.new(403, 'Revoked') }
    assert_equal 403, request(runtime, 'POST', '/agent/default/stop/alias').first
    assert_equal 1, calls.length
    assert_empty stops
  end

  def test_stop_wrong_agent_does_not_cancel_existing_local_run
    runtime, _calls, stops = stop_fixture { { 'thread' => { 'id' => 'canonical', 'agentId' => 'other' } } }
    assert_equal 403, request(runtime, 'POST', '/agent/default/stop/alias').first
    assert_empty stops
  end

  def test_stop_invalid_canonical_id_does_not_cancel_existing_local_run
    runtime, _calls, stops = stop_fixture { { 'thread' => { 'id' => ' ', 'agentId' => 'default' } } }
    assert_equal 502, request(runtime, 'POST', '/agent/default/stop/alias').first
    assert_empty stops
  end
end

class RuntimeTest
  def test_unsupported_memory_methods_never_reach_platform
    runtime = build_runtime(api_key: 'test', identify_user: ->(_) { { 'id' => 'u' } })
    calls = []
    platform = Object.new
    platform.define_singleton_method(:request) { |*args| calls << args; {} }
    runtime.instance_variable_set(:@platform, platform)
    assert_equal 405, request(runtime, 'PUT', '/memories').first
    assert_empty calls
  ensure
    runtime&.close
  end
end
