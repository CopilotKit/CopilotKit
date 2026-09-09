# frozen_string_literal: true
require 'minitest/autorun'
require 'stringio'
require 'json'
require 'copilotkit/runtime'
require 'rack'

class RuntimeTest < Minitest::Test
  def request(runtime, method, path, body = {})
    status, _, chunks = runtime.call('REQUEST_METHOD' => method, 'PATH_INFO' => path, 'QUERY_STRING' => '', 'rack.input' => StringIO.new(JSON.generate(body)))
    [status, chunks.empty? ? nil : JSON.parse(chunks.join)]
  end

  def test_rejects_untrusted_identity_before_platform_access
    runtime = CopilotKit::Runtime.new(api_key: 'test-secret', identify_user: ->(_env) { nil })
    status, = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/threads', 'QUERY_STRING' => 'agentId=default', 'rack.input' => StringIO.new(''))
    assert_equal 401, status
  end

  def test_empty_key_fails_at_boot_without_echoing_secret
    error = assert_raises(ArgumentError) { CopilotKit::Runtime.new(api_key: ' ', identify_user: ->(_) { nil }) }
    assert_equal 'api_key is required', error.message
  end

  def test_memory_denies_write_to_user_scope_when_only_project_is_writable
    runtime = CopilotKit::Runtime.new(api_key: 'test-secret', api_url: 'http://127.0.0.1:1',
      identify_user: ->(_) { { 'id' => 'alice' } }, memory_access: ->(_, _) { { 'user' => 'none', 'project' => 'read-write' } })
    status, = request(runtime, 'POST', '/memories', 'content' => 'private fact', 'kind' => 'topical', 'scope' => 'user')
    assert_equal 403, status
  end

  def test_memory_default_grants_are_deny_all
    runtime = CopilotKit::Runtime.new(api_key: 'test-secret', identify_user: ->(_) { { 'id' => 'alice' } })
    assert_equal 403, request(runtime, 'GET', '/memories').first
  end

  def test_unknown_agents_do_not_contact_platform
    runtime = CopilotKit::Runtime.new(api_key: 'test-secret', identify_user: ->(_) { { 'id' => 'alice' } })
    assert_equal 404, request(runtime, 'POST', '/agent/missing/run').first
  end

  def test_telemetry_discards_prompts_keys_and_user_ids
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event })
    telemetry.emit('runtime.request', 'status' => 200, 'apiKey' => 'secret', 'userId' => 'alice', 'messages' => ['private'])
    assert_equal({ 'status' => 200 }, events.first.fetch('properties'))
  end

  def test_telemetry_opt_out_never_calls_exporter
    telemetry = CopilotKit::Telemetry.new(disabled: true, exporter: ->(_) { flunk 'Exporter must not run' })
    telemetry.emit('runtime.request')
    assert telemetry.disabled?
  end

  def test_array_json_is_rejected
    runtime = CopilotKit::Runtime.new(api_key: 'test-secret', identify_user: ->(_) { { 'id' => 'alice' } })
    assert_equal 400, request(runtime, 'POST', '/annotate', []).first
  end

  def test_mounts_in_rack_and_obeys_no_content_header_contract
    runtime = CopilotKit::Runtime.new(api_key: 'test-secret', identify_user: ->(_) { nil })
    mounted = Rack::Builder.new { map('/copilotkit') { run Rack::Lint.new(runtime) } }.to_app
    response = Rack::MockRequest.new(mounted).options('/copilotkit/info')
    assert_equal 204, response.status
    assert_equal '', response.body
  end
end
