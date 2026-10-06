# frozen_string_literal: true
require 'minitest/autorun'
require 'copilotkit/runtime'

class RunnerTest < Minitest::Test
  class PhoenixFixture
    attr_reader :events, :url
    attr_accessor :hold_terminal
    attr_accessor :hold_type
    def initialize(hold_join: false)
      @listener = TCPServer.new('127.0.0.1', 0)
      @url = "ws://127.0.0.1:#{@listener.addr[1]}/runner"
      @events, @writes, @hold_terminal = Queue.new, Mutex.new, false
      @thread = Thread.new do
        @socket = @listener.accept
        handshake = WebSocket::Handshake::Server.new
        handshake << @socket.read(1) until handshake.finished?
        @socket.write(handshake.to_s)
        decoder = WebSocket::Frame::Incoming::Server.new
        loop do
          decoder << @socket.readpartial(16_384)
          while (frame = decoder.next)
            next unless frame.type == :text
            message = JSON.parse(frame.data)
            @join_ref, ref, @topic, name, payload = message
            if hold_join && name == 'phx_join'
              @terminal = message
              @events << { 'type' => 'JOIN_PENDING' }
              next
            end
            if name == 'event'
              @events << payload
              if (@hold_terminal && %w[RUN_FINISHED RUN_ERROR].include?(payload['type'])) || @hold_type == payload['type']
                @terminal = message
                next
              end
            end
            reply(message)
          end
        end
      rescue IOError, EOFError, SystemCallError
        nil
      end
    end
    def send_stop
      send_frame([@join_ref, nil, @topic, 'ag-ui', { 'type' => 'CUSTOM', 'name' => 'stop' }])
    end
    def planned_restart
      @writes.synchronize { @socket.write([0x88, 9, 1012].pack('CCn') + 'restart') }
    end
    def release_terminal
      Timeout.timeout(1) { Thread.pass until @terminal }
      reply(@terminal)
    end
    def reply(message)
      send_frame([message[0], message[1], message[2], 'phx_reply', { 'status' => 'ok', 'response' => {} }])
    end
    def send_frame(payload)
      @writes.synchronize { @socket.write(WebSocket::Frame::Outgoing::Server.new(data: JSON.generate(payload), type: :text, version: 13).to_s) }
    end
    def close
      @socket&.close
      @listener.close
      @thread.join(1)
    end
  end

  class Platform
    attr_reader :cleanups
    attr_accessor :reject_renewal
    def initialize
      @cleanups = Queue.new
    end
    def request(method, path, body)
      raise CopilotKit::Error.new(409, 'Lease lost') if method == 'PATCH' && @reject_renewal
      @cleanups << body if method == 'DELETE'
      {}
    end
  end

  class StartupPlatform
    attr_reader :history_entered, :release_history, :renewals, :cleanups
    def initialize
      @history_entered, @release_history, @renewals, @cleanups = Queue.new, Queue.new, Queue.new, Queue.new
    end
    def request(method, path, body = nil, *_headers)
      if method == 'POST' && path.end_with?('/lock')
        { 'threadId' => 'thread', 'runId' => 'run', 'joinToken' => 'join' }
      elsif path.include?('/messages?')
        @history_entered << true
        @release_history.pop
        { 'messages' => [] }
      else
        @renewals << true if method == 'PATCH'
        @cleanups << true if method == 'DELETE'
        {}
      end
    end
  end

  def startup_runtime(platform, gateway)
    runtime = CopilotKit::Runtime.new(api_key: 'fixture', runner_url: gateway.url,
      identify_user: ->(_) { { 'id' => 'user' } }, agents: { 'default' => BlockingAgent.new },
      lock_heartbeat_interval: 0.02, lock_ttl: 1, telemetry: CopilotKit::Telemetry.new(disabled: true))
    runtime.instance_variable_set(:@platform, platform)
    runtime
  end

  def test_lease_is_renewed_while_history_is_still_loading
    gateway, platform = PhoenixFixture.new, StartupPlatform.new
    runtime = startup_runtime(platform, gateway)
    request = Thread.new { runtime.send(:run, { 'threadId' => 'thread', 'runId' => 'run', 'messages' => [] }, { 'id' => 'user' }, 'default') rescue nil }
    Timeout.timeout(1) { platform.history_entered.pop }
    sleep 0.07
    refute platform.renewals.empty?, 'Lease must renew before history and gateway join finish'
  ensure
    platform&.release_history&.push(true)
    request&.join(1)
    runtime&.close(timeout: 0.2)
    gateway&.close
  end

  def test_shutdown_cancels_pending_history_and_releases_its_lock
    gateway, platform = PhoenixFixture.new, StartupPlatform.new
    runtime = startup_runtime(platform, gateway)
    request = Thread.new { runtime.send(:run, { 'threadId' => 'thread', 'runId' => 'run', 'messages' => [] }, { 'id' => 'user' }, 'default') rescue nil }
    Timeout.timeout(1) { platform.history_entered.pop }
    runtime.close(timeout: 0.2)
    assert request.join(0.2), 'Shutdown must cancel owned startup work'
    assert_equal 1, platform.cleanups.length
  ensure
    platform&.release_history&.push(true)
    request&.join(1)
    runtime&.close(timeout: 0.2)
    gateway&.close
  end

  def test_rejected_lock_does_not_release_an_existing_run
    gateway, platform = PhoenixFixture.new, StartupPlatform.new
    platform.define_singleton_method(:request) do |method, path, *args|
      raise CopilotKit::Error.new(409, 'Run already active') if method == 'POST' && path.end_with?('/lock')
      super(method, path, *args)
    end
    runtime = startup_runtime(platform, gateway)
    assert_raises(CopilotKit::Error) { runtime.send(:run, { 'threadId' => 'thread', 'runId' => 'run', 'messages' => [] }, { 'id' => 'user' }, 'default') }
    assert_empty platform.cleanups
  ensure
    runtime&.close(timeout: 0.2)
    gateway&.close
  end

  class BlockingAgent < CopilotKit::Agent
    attr_reader :started, :cancelled
    def initialize
      super
      @started, @cancelled = Queue.new, Queue.new
    end
    def each_event(_input)
      @started << true
      sleep 60
    ensure
      @cancelled << true
    end
  end

  def runner(gateway, platform, agent, **options)
    CopilotKit::Runner.new(platform: platform, url: gateway.url, auth_token: 'key',
      lock: { 'threadId' => 'thread', 'runId' => 'run', 'joinToken' => 'join' },
      input: { 'threadId' => 'thread', 'runId' => 'run', 'messages' => [] }, messages: [],
      agent: agent, telemetry: CopilotKit::Telemetry.new(disabled: true), **options)
  end

  def test_gateway_stop_interrupts_idle_agent_and_releases_lock
    gateway, platform, agent = PhoenixFixture.new, Platform.new, BlockingAgent.new
    run = runner(gateway, platform, agent)
    run.join_gateway
    finished = Queue.new
    run.start { finished << true }
    Timeout.timeout(1) { agent.started.pop }
    gateway.send_stop
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 1
    sleep 0.01 while finished.empty? && Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
    refute finished.empty?, 'Gateway stop must complete a blocked run within one second'
    refute agent.cancelled.empty?
    assert_equal 1, platform.cleanups.length
  ensure
    run&.stop
    gateway&.close
  end

  def test_lease_failure_cancels_blocked_agent
    gateway, platform, agent = PhoenixFixture.new, Platform.new, BlockingAgent.new
    platform.reject_renewal = true
    run = runner(gateway, platform, agent, heartbeat_interval: 0.03)
    run.join_gateway
    finished = Queue.new
    run.start { finished << true }
    Timeout.timeout(1) { finished.pop }
    refute agent.cancelled.empty?
    assert_equal 1, platform.cleanups.length
    emitted = []
    emitted << gateway.events.pop until gateway.events.empty?
    assert_equal 'LOCK_RENEWAL_FAILED', emitted.last['code']
  ensure
    run&.stop
    gateway&.close
  end

  def test_cleanup_waits_for_terminal_durability_ack
    gateway, platform = PhoenixFixture.new, Platform.new
    gateway.hold_terminal = true
    agent = Class.new(CopilotKit::Agent) { def each_event(_input); yield('type' => 'RUN_FINISHED'); end }.new
    run = runner(gateway, platform, agent)
    run.join_gateway
    finished = Queue.new
    run.start { finished << true }
    Timeout.timeout(1) { loop { break if gateway.events.pop['type'] == 'RUN_FINISHED' } }
    assert_equal 0, platform.cleanups.length
    assert finished.empty?
    gateway.release_terminal
    Timeout.timeout(1) { finished.pop }
    assert_equal 1, platform.cleanups.length
  ensure
    run&.stop
    gateway&.close
  end

  def test_slow_gateway_backpressures_producer_with_fixed_capacity
    gateway, platform = PhoenixFixture.new, Platform.new
    gateway.hold_type = 'TEXT_MESSAGE_CONTENT'
    count = Queue.new
    agent = Class.new(CopilotKit::Agent).new
    agent.define_singleton_method(:each_event) do |_input, &emit|
      10_000.times { count << true; emit.call('type' => 'TEXT_MESSAGE_CONTENT', 'messageId' => 'm', 'delta' => 'x') }
    end
    run = runner(gateway, platform, agent, queue_capacity: 4)
    run.join_gateway
    finished = Queue.new
    run.start { finished << true }
    Timeout.timeout(1) { loop { break if gateway.events.pop['type'] == 'TEXT_MESSAGE_CONTENT' } }
    sleep 0.03
    assert_operator count.length, :<=, 6
    assert run.request_stop
    refute run.request_stop
    sleep 0.02
    assert_equal 0, platform.cleanups.length, 'Repeated stop must not cancel an unacknowledged publisher'
    gateway.hold_type = nil
    gateway.release_terminal
    Timeout.timeout(1) { finished.pop }
    assert_equal 1, platform.cleanups.length
  ensure
    run&.stop
    gateway&.close
  end

  def test_runtime_shutdown_cancels_before_drain_deadline_and_cleans_active_map
    gateway, platform, agent = PhoenixFixture.new, Platform.new, BlockingAgent.new
    run = runner(gateway, platform, agent)
    runtime = CopilotKit::Runtime.new(api_key: 'fixture', identify_user: ->(_) { nil }, telemetry: CopilotKit::Telemetry.new(disabled: true))
    active = { 'run' => run }
    runtime.instance_variable_set(:@runs, active)
    run.join_gateway
    run.start { active.delete('run') }
    Timeout.timeout(1) { agent.started.pop }
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    runtime.close(timeout: 0.5)
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 0.5
    assert_empty active
    assert_equal 1, platform.cleanups.length
    emitted = []
    emitted << gateway.events.pop until gateway.events.empty?
    assert_equal 'STOPPED', emitted.last['code']
  ensure
    run&.stop
    gateway&.close
  end

  def test_planned_close_is_observed_without_waiting_for_ack_timeout
    fixture = PhoenixFixture.new
    gateway = CopilotKit::Gateway.new(url: fixture.url, token: 'key', thread_id: 'thread', run_id: 'run')
    gateway.connect
    fixture.planned_restart
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    assert_raises(StandardError) { gateway.publish([{ 'type' => 'RUN_STARTED' }]) }
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 0.5
  ensure
    gateway&.close
    fixture&.close
  end

  def test_forced_shutdown_never_reports_unacknowledged_completion
    gateway, platform = PhoenixFixture.new, Platform.new
    gateway.hold_terminal = true
    agent = Class.new(CopilotKit::Agent) { def each_event(_input); yield('type' => 'RUN_FINISHED'); end }.new
    run = runner(gateway, platform, agent)
    analytics = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { analytics << event }, sample_rate: 1, env: {})
    run.instance_variable_set(:@telemetry, telemetry)
    run.join_gateway
    run.start {}
    Timeout.timeout(1) { loop { break if gateway.events.pop['type'] == 'RUN_FINISHED' } }
    run.stop
    telemetry.close
    refute analytics.any? { |event| event['event'].end_with?('stream_ended') }, 'Unacknowledged terminal event must not produce completion analytics'
  ensure
    run&.stop
    telemetry&.close
    gateway&.close
  end

  def test_missing_terminal_closes_open_streams_and_reports_incomplete_stream
    gateway, platform = PhoenixFixture.new, Platform.new
    agent = Class.new(CopilotKit::Agent) do
      def each_event(_input)
        yield('type' => 'TEXT_MESSAGE_START', 'messageId' => 'm')
        yield('type' => 'TOOL_CALL_START', 'toolCallId' => 't', 'toolCallName' => 'lookup')
      end
    end.new
    run = runner(gateway, platform, agent)
    run.join_gateway
    finished = Queue.new
    run.start { finished << true }
    Timeout.timeout(1) { finished.pop }
    events = []
    events << gateway.events.pop until gateway.events.empty?
    assert_equal 'INCOMPLETE_STREAM', events.last['code']
    assert_equal %w[TEXT_MESSAGE_END TOOL_CALL_END TOOL_CALL_RESULT RUN_ERROR], events.last(4).map { |event| event['type'] }
    assert_equal 'missing_terminal_event', JSON.parse(events[-2]['content'])['reason']
  ensure
    run&.stop
    gateway&.close
  end

  def test_lease_loss_during_join_prevents_startup_success
    gateway, platform = PhoenixFixture.new(hold_join: true), Platform.new
    platform.reject_renewal = true
    run = runner(gateway, platform, BlockingAgent.new, heartbeat_interval: 0.02)
    run.start_lease
    result = Queue.new
    joining = Thread.new do
      run.join_gateway
      result << :joined
    rescue CopilotKit::Error
      result << :rejected
    end
    Timeout.timeout(1) { gateway.events.pop }
    sleep 0.06
    gateway.release_terminal
    assert_equal :rejected, Timeout.timeout(1) { result.pop }
  ensure
    run&.stop
    joining&.join(1)
    gateway&.close
  end

  def test_error_before_first_yield_persists_one_start_with_fresh_messages
    gateway, platform = PhoenixFixture.new, Platform.new
    agent = Class.new(CopilotKit::Agent) { def each_event(_input); raise 'Immediate agent failure'; end }.new
    run = runner(gateway, platform, agent)
    fresh = [{ 'id' => 'new', 'role' => 'user', 'content' => 'New request' }]
    run.prepare_input({ 'threadId' => 'thread', 'runId' => 'run', 'messages' => [{ 'id' => 'old' }] + fresh }, fresh)
    run.join_gateway
    finished = Queue.new
    run.start { finished << true }
    Timeout.timeout(1) { finished.pop }
    events = []
    events << gateway.events.pop until gateway.events.empty?
    assert_equal %w[RUN_STARTED RUN_ERROR], events.map { |event| event['type'] }
    assert_equal({ 'threadId' => 'thread', 'runId' => 'run', 'messages' => fresh }, events.first['input'])
    assert_equal [1, 2], events.map { |event| event.dig('metadata', 'cpki_event_seq') }
  ensure
    run&.stop
    gateway&.close
  end

  def test_idle_stop_before_first_yield_persists_one_start_with_fresh_messages
    gateway, platform, agent = PhoenixFixture.new, Platform.new, BlockingAgent.new
    run = runner(gateway, platform, agent)
    fresh = [{ 'id' => 'new', 'role' => 'user', 'content' => 'New request' }]
    run.prepare_input({ 'threadId' => 'thread', 'runId' => 'run', 'messages' => [{ 'id' => 'old' }] + fresh }, fresh)
    run.join_gateway
    finished = Queue.new
    run.start { finished << true }
    Timeout.timeout(1) { agent.started.pop }
    gateway.send_stop
    Timeout.timeout(1) { finished.pop }
    events = []
    events << gateway.events.pop until gateway.events.empty?
    assert_equal %w[RUN_STARTED RUN_ERROR], events.map { |event| event['type'] }
    assert_equal({ 'threadId' => 'thread', 'runId' => 'run', 'messages' => fresh }, events.first['input'])
    assert_equal 'STOPPED', events.last['code']
  ensure
    run&.stop
    gateway&.close
  end

  def test_lease_already_lost_at_execution_handoff_prevents_first_agent_side_effect
    gateway, platform, agent = PhoenixFixture.new, Platform.new, BlockingAgent.new
    run = runner(gateway, platform, agent, heartbeat_interval: 0.01)
    run.join_gateway
    platform.reject_renewal = true
    run.start_lease
    assert run.instance_variable_get(:@lease_thread).join(1), 'Lease failure must reach the handoff before execution'
    finished = Queue.new
    run.start { finished << true }
    Timeout.timeout(1) { finished.pop }
    assert_empty agent.started
    events = []
    events << gateway.events.pop until gateway.events.empty?
    assert_equal %w[RUN_STARTED RUN_ERROR], events.map { |event| event['type'] }
    assert_equal 'LOCK_RENEWAL_FAILED', events.last['code']
  ensure
    run&.stop
    gateway&.close
  end
end
