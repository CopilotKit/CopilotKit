# frozen_string_literal: true
require 'minitest/autorun'
require 'stringio'
require 'copilotkit/intelligence'
require 'copilotkit/runtime'

class LifecycleTest < Minitest::Test
  def client(&handler)
    transport = Object.new
    transport.define_singleton_method(:request, &handler)
    CopilotKit::Intelligence.new(api_key: 'key', transport: transport)
  end

  def test_success_events_have_canonical_payloads_and_unsubscribe_is_idempotent
    seen = []
    sdk = client { |*_| { 'thread' => { 'id' => 'canonical' } } }
    listener = ->(thread) { seen << [:created, thread['id']] }
    unsubscribe = sdk.on_thread_created(&listener)
    sdk.on_thread_created(&listener)
    sdk.on_thread_updated { |thread| seen << [:updated, thread['id']] }
    sdk.on_thread_deleted { |event| seen << [:deleted, event] }

    sdk.create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent')
    sdk.update_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent', updates: { name: 'New' })
    sdk.archive_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent')
    sdk.delete_thread(thread_id: 'thread/id+space', user_id: 'user', agent_id: 'agent')
    unsubscribe.call
    unsubscribe.call
    sdk.create_thread(thread_id: 'other', user_id: 'user', agent_id: 'agent')

    assert_equal [[:created, 'canonical'], [:updated, 'canonical'], [:updated, 'canonical'],
      [:deleted, { 'threadId' => 'thread/id+space', 'userId' => 'user', 'agentId' => 'agent' }]], seen
  end

  def test_listener_errors_preserve_success_and_other_listeners
    seen = []
    sdk = client { |*_| { 'thread' => { 'id' => 'canonical' } } }
    sdk.on_thread_created { |_| raise 'private application error' }
    sdk.on_thread_created { |thread| seen << thread }

    _, diagnostics = capture_io do
      assert_equal({ 'id' => 'canonical' }, sdk.create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent'))
    end

    assert_equal [{ 'id' => 'canonical' }], seen
    assert_includes diagnostics, 'listener failed'
    refute_includes diagnostics, 'private application error'
  end

  def test_creation_events_distinguish_lookup_creation_and_conflict_recovery
    [[200], [404, 200], [404, 409, 200]].each do |statuses|
      expected = statuses == [404, 200] ? 1 : 0
      seen = []
      responses = statuses.dup
      sdk = client do |*_|
        status = responses.shift
        raise CopilotKit::Error.new(status, 'rejected') unless status == 200
        { 'thread' => { 'id' => 'canonical' } }
      end
      sdk.on_thread_created { |thread| seen << thread }

      sdk.get_or_create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent')

      assert_equal expected, seen.length
    end
  end

  def test_denied_mutations_emit_no_success_events
    [403, 409, 503].each do |status|
      seen = []
      sdk = client { |*_| raise CopilotKit::Error.new(status, 'rejected') }
      sdk.on_thread_created { |event| seen << event }
      sdk.on_thread_updated { |event| seen << event }
      sdk.on_thread_deleted { |event| seen << event }

      assert_raises(CopilotKit::Error) { sdk.create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent') }
      assert_raises(CopilotKit::Error) { sdk.update_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent', updates: {}) }
      assert_raises(CopilotKit::Error) { sdk.delete_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent') }

      assert_empty seen
    end
  end

  def test_non_thread_operations_and_invalid_responses_emit_no_success_events
    seen = []
    sdk = client { |*_| { 'thread' => { 'id' => 'thread' } } }
    sdk.on_thread_created { |event| seen << event }
    sdk.on_thread_updated { |event| seen << event }
    sdk.on_thread_deleted { |event| seen << event }
    [['POST', '/api/threads/subscribe'], ['PATCH', '/api/threads/thread/lock'],
     ['DELETE', '/api/threads/thread/lock'], ['GET', '/api/threads/thread'],
     ['POST', '/api/memories'], ['PATCH', '/api/memories/memory']].each do |method, path|
      sdk.request(method, path, { 'userId' => 'user', 'agentId' => 'agent' })
    end
    assert_empty seen
    [nil, [], {}, { 'thread' => {} }, { 'thread' => { 'id' => 3 } }].each do |response|
      malformed = client { |*_| response }
      malformed.on_thread_created { |event| seen << event }
      assert_raises(CopilotKit::Error) { malformed.create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent') }
      assert_empty seen
    end
  end

  def test_block_is_required_and_listener_can_unsubscribe_itself
    sdk = client { |*_| { 'thread' => { 'id' => 'thread' } } }
    assert_raises(ArgumentError) { sdk.on_thread_created }
    seen = []
    unsubscribe = nil
    unsubscribe = sdk.on_thread_created { |event| seen << event; unsubscribe.call }

    2.times { sdk.create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent') }

    assert_equal 1, seen.length
  end

  def test_rack_mutations_notify_the_shared_sdk_with_trusted_identity
    seen, payloads = [], []
    sdk = client { |_, _, body, _| payloads << body; { 'thread' => { 'id' => 'canonical' } } }
    sdk.on_thread_updated { |thread| seen << [:updated, thread['id']] }
    sdk.on_thread_deleted { |event| seen << [:deleted, event] }
    runtime = CopilotKit::Runtime.new(intelligence: sdk, identify_user: ->(_) { { 'id' => 'trusted' } },
      telemetry: CopilotKit::Telemetry.new(disabled: true))

    [['PATCH', '/threads/thread', { 'agentId' => 'agent', 'userId' => 'spoof', 'name' => 'New' }],
     ['POST', '/threads/thread/archive', { 'agentId' => 'agent' }],
     ['DELETE', '/threads/thread', { 'agentId' => 'agent' }]].each do |method, path, body|
      result = runtime.call('REQUEST_METHOD' => method, 'PATH_INFO' => path, 'QUERY_STRING' => '', 'rack.input' => StringIO.new(JSON.generate(body)))
      assert_equal 200, result.first
    end

    assert_equal [[:updated, 'canonical'], [:updated, 'canonical'], [:deleted, { 'threadId' => 'thread', 'userId' => 'trusted', 'agentId' => 'agent' }]], seen
    assert payloads.all? { |body| body['userId'] == 'trusted' }
  ensure
    runtime&.close
  end

  def test_concurrent_registration_deduplicates_the_same_listener
    sdk = client { |*_| { 'thread' => { 'id' => 'thread' } } }
    seen = Queue.new
    listener = ->(event) { seen << event }
    subscriptions = 8.times.map { Thread.new { sdk.on_thread_created(&listener) } }.map(&:value)

    sdk.create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent')

    assert_equal 1, seen.size
    subscriptions.each(&:call)
    sdk.create_thread(thread_id: 'thread', user_id: 'user', agent_id: 'agent')
    assert_equal 1, seen.size
  end

  def test_run_notifies_persisted_creation_before_a_later_lock_failure
    seen, created = [], []
    sdk = client do |method, path, body, _|
      raise CopilotKit::Error.new(404, 'missing') if method == 'GET'
      if path == '/api/threads'
        created << body
        { 'thread' => { 'id' => 'canonical' } }
      else
        raise CopilotKit::Error.new(409, 'locked')
      end
    end
    sdk.on_thread_created { |thread| seen << thread }
    runtime = CopilotKit::Runtime.new(intelligence: sdk, identify_user: ->(_) { { 'id' => 'trusted' } },
      agents: { 'default' => ->(*) { flunk 'Agent must not run without a lock' } },
      learning_container: ->(*) { 'existing-container' }, telemetry: CopilotKit::Telemetry.new(disabled: true))

    result = runtime.call('REQUEST_METHOD' => 'POST', 'PATH_INFO' => '/agent/default/run', 'QUERY_STRING' => '',
      'rack.input' => StringIO.new(JSON.generate('threadId' => 'thread', 'runId' => 'run', 'messages' => [], 'tools' => [], 'context' => [], 'state' => {})))

    assert_equal 409, result.first
    assert_equal [{ 'id' => 'canonical' }], seen
    assert_equal [{ 'threadId' => 'thread', 'userId' => 'trusted', 'agentId' => 'default', 'learningContainerId' => 'existing-container' }], created
  ensure
    runtime&.close
  end
end
