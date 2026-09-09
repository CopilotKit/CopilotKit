# frozen_string_literal: true
require 'minitest/autorun'
require 'open3'
require 'rbconfig'

class IntelligenceTest < Minitest::Test
  def client(&handler)
    require 'copilotkit/intelligence'
    transport = Object.new
    transport.define_singleton_method(:request, &handler)
    CopilotKit::Intelligence.new(api_key: 'secret', transport: transport)
  end

  def test_import_does_not_load_runtime_or_rack
    _, error, status = Open3.capture3(RbConfig.ruby, '-Ilib', '-e',
      "require 'copilotkit/intelligence'; abort if defined?(CopilotKit::Runtime) || defined?(Rack)")
    assert status.success?, error
  end

  def test_thread_assignment_without_runtime
    calls = []
    sdk = client { |*args| calls << args; { 'thread' => { 'id' => 'canonical' } } }
    thread = sdk.create_thread(thread_id: 'thread', user_id: 'customer', agent_id: 'agent', learning_container_id: 'support-quality')
    assert_equal 'canonical', thread.fetch('id')
    assert_equal ['POST', '/api/threads', {
      'threadId' => 'thread', 'userId' => 'customer', 'agentId' => 'agent', 'learningContainerId' => 'support-quality'
    }, {}], calls.first
  end

  def test_memory_apis_preserve_identity_scope_and_encoded_ids
    calls = []
    sdk = client { |*args| calls << args; { 'memories' => [], 'id' => 'memory' } }
    grant = CopilotKit::MemoryGrant.new(user: :read_write, project: :read)
    sdk.list_memories(user_id: 'customer', memory_grant: grant, include_invalidated: true)
    sdk.create_memory(user_id: 'customer', content: 'Python', kind: 'topical')
    sdk.update_memory(user_id: 'customer', memory_id: 'id/with space', content: 'Ruby', kind: 'topical')
    sdk.recall_memories(user_id: 'customer', query: 'language', limit: 3, scope: 'user')
    sdk.remove_memory(user_id: 'customer', memory_id: 'id/with space')
    assert_equal %w[GET POST PATCH POST DELETE], calls.map(&:first)
    assert calls.all? { |call| call[3]['x-cpki-user-id'] == 'customer' }
    assert_equal({ 'user' => 'read-write', 'project' => 'read' }, JSON.parse(calls[0][3]['x-cpki-memory-grant']))
    refute calls[1][3].key?('x-cpki-memory-grant')
    assert_nil calls[0][2]
    assert_nil calls[4][2]
    assert_equal '/api/memories/id%2Fwith%20space', calls[2][1]
    assert_equal({ 'query' => 'language', 'limit' => 3, 'scope' => 'user' }, calls[3][2])
  end

  def test_get_or_create_handles_race_without_retrying_other_errors
    calls = []
    sdk = client do |*args|
      calls << args
      raise CopilotKit::Error.new(404, 'missing') if calls.length == 1
      raise CopilotKit::Error.new(409, 'race') if calls.length == 2
      { 'thread' => { 'id' => 'existing' } }
    end
    assert_equal({ 'thread' => { 'id' => 'existing' }, 'created' => false }, sdk.get_or_create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent'))
    assert_equal %w[GET POST GET], calls.map(&:first)
    assert_includes calls.last[1], 'userId=user'
    rejected = client { |*_args| raise CopilotKit::Error.new(403, 'denied') }
    error = assert_raises(CopilotKit::Error) { rejected.get_or_create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent') }
    assert_equal 403, error.status
  end

  def test_resource_methods_and_annotation_use_platform_contracts
    calls = []
    sdk = client { |*args| calls << args; { 'thread' => { 'id' => 'thread' }, 'id' => 'event' } }
    sdk.list_threads(user_id: 'user', agent_id: 'agent', cursor: 'opaque', limit: 4)
    sdk.update_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent', updates: { name: 'Name', userId: 'spoofed' })
    sdk.archive_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent')
    sdk.get_thread_messages(thread_id: 'thread', user_id: 'user')
    sdk.get_thread_events(thread_id: 'thread')
    sdk.get_thread_state(thread_id: 'thread')
    sdk.annotate(thread_id: 'thread', user_id: 'user', type: 'user_action', client_event_id: 'event/id', payload: { action: 'save' })
    sdk.delete_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent')
    assert_equal %w[GET PATCH PATCH GET GET GET PUT DELETE], calls.map(&:first)
    assert_equal 'user', calls[1][2]['userId']
    assert_equal true, calls[2][2]['archived']
    assert_equal '/api/_inspect/threads/thread/events', calls[4][1]
    assert_equal '/api/_inspect/threads/thread/state', calls[5][1]
    assert_equal '/connector/annotate/event%2Fid', calls[6][1]
    assert_equal 'user_action', calls[6][2]['type']
  end

  def test_invalid_response_and_grant_fail_clearly
    sdk = client { |*_args| nil }
    assert_raises(CopilotKit::Error) { sdk.annotate(thread_id: 'thread', user_id: 'user', type: 'user_action') }
    assert_raises(ArgumentError) { CopilotKit::MemoryGrant.new(user: :admin, project: :read) }
  end

  def test_configuration_rejects_unsafe_endpoints_even_with_custom_transport
    sdk = client { |*_args| nil }
    assert_raises(ArgumentError) { CopilotKit::Intelligence.new(api_key: 'secret', api_url: 'https://user:password@example.com', transport: sdk) }
    assert_raises(ArgumentError) { CopilotKit::Intelligence.new(api_key: 'secret', runner_url: 'http://example.com', transport: sdk) }
  end

  def test_runtime_borrows_client_without_duplicate_credentials
    sdk = client { |*_args| { 'memories' => [] } }
    require 'copilotkit/runtime'
    require 'stringio'
    runtime = CopilotKit::Runtime.new(intelligence: sdk, identify_user: ->(_) { { 'id' => 'user' } }, telemetry: CopilotKit::Telemetry.new(disabled: true))
    status, = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/memories', 'QUERY_STRING' => '', 'rack.input' => StringIO.new(''))
    assert_equal 200, status
    assert_same sdk, runtime.intelligence
  ensure
    runtime&.close
  end
end
