# frozen_string_literal: true
require 'minitest/autorun'
require 'copilotkit/runtime'
require 'webrick'

class TelemetryTest < Minitest::Test
  def test_analytics_timestamp_is_unix_seconds
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 1, env: {})
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    telemetry.close
    assert_in_delta Time.now.to_i, events.first.fetch('ts'), 2
  end

  def test_default_sampling_has_weight_and_identity_never_bypasses_it
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, random: -> { 0.04 }, telemetry_id: 'standalone', env: {})
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    telemetry.close
    assert_equal 0.05, events.first.dig('global_properties', 'sampleRate')
    assert_equal 20, events.first.dig('global_properties', 'sampleWeight')
    assert_equal false, events.first.dig('global_properties', 'telemetry_identified')
    refute JSON.generate(events).include?('standalone')
    filtered = []
    sampled_out = CopilotKit::Telemetry.new(exporter: ->(event) { filtered << event }, random: -> { 0.06 }, telemetry_id: 'standalone', env: {})
    sampled_out.emit('oss.runtime.agent_execution_stream_started')
    sampled_out.close
    assert_empty filtered
  end

  def test_invalid_sampling_rates_fall_back_to_default
    [-1, 2, 'nan', Float::INFINITY, 'invalid'].each do |rate|
      events = []
      telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: rate, random: -> { 0.01 }, env: {})
      telemetry.emit('oss.runtime.agent_execution_stream_started')
      telemetry.close
      assert_equal 0.05, events.first.dig('global_properties', 'sampleRate')
    end
  end

  def test_zero_environment_rate_wins_over_config_and_id
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 1, telemetry_id: 'id', env: { 'COPILOTKIT_TELEMETRY_SAMPLE_RATE' => '0' })
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    telemetry.close
    assert_empty events
  end

  def test_all_opt_out_forms_win_over_configuration
    %w[DO_NOT_TRACK COPILOTKIT_TELEMETRY_DISABLED].product(%w[true 1]).each do |key, value|
      events = []
      telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, disabled: false, sample_rate: 1, env: { key => value })
      telemetry.emit('oss.runtime.agent_execution_stream_started')
      telemetry.close
      assert telemetry.disabled?
      assert_empty events
    end
  end

  def test_slow_sink_has_bounded_queue_and_shutdown
    entered = Queue.new
    gate = Queue.new
    telemetry = CopilotKit::Telemetry.new(exporter: ->(_) { entered << true; gate.pop }, sample_rate: 1, queue_capacity: 2, env: {})
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    Timeout.timeout(1) { entered.pop }
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    1000.times { telemetry.emit('oss.runtime.agent_execution_stream_started') }
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 0.5
    assert_equal false, telemetry.flush(timeout: 0.01)
    telemetry.close(timeout: 0.01)
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 0.5
  ensure
    telemetry&.close(timeout: 0.01)
  end

  def test_callback_failure_does_not_escape_and_flush_finishes
    telemetry = CopilotKit::Telemetry.new(exporter: ->(_) { raise 'private-sink-error' }, sample_rate: 1, env: {})
    assert_nil telemetry.emit('oss.runtime.agent_execution_stream_errored', 'error' => 'private content')
    assert telemetry.flush(timeout: 1)
    assert_nil telemetry.close
  end

  def test_http_identity_is_validated_and_redirects_are_not_followed
    received = Queue.new
    server = WEBrick::HTTPServer.new(Port: 0, BindAddress: '127.0.0.1', Logger: WEBrick::Log.new(File::NULL), AccessLog: [])
    server.mount_proc('/') do |request, response|
      received << { path: request.path, id: request['x-copilotkit-telemetry-id'], event: JSON.parse(request.body) }
      response.status = 302
      response['location'] = '/must-not-follow'
    end
    worker = Thread.new { server.start }
    begin
      endpoint = "http://127.0.0.1:#{server.listeners.first.addr[1]}/ingest"
      valid = CopilotKit::Telemetry.new(url: endpoint, telemetry_id: " \tvalid-id\t ", sample_rate: 1, env: {})
      valid.emit('oss.runtime.agent_execution_stream_started')
      valid.close
      call = received.pop
      assert_equal 'valid-id', call[:id]
      assert_equal '/ingest', call[:path]
      assert_equal 0, received.length
      invalid = CopilotKit::Telemetry.new(url: endpoint, telemetry_id: "bad\nidentity", sample_rate: 1, env: {})
      invalid.emit('oss.runtime.agent_execution_stream_started')
      invalid.close
      assert_nil received.pop[:id]
      assert_equal 0, received.length
    ensure
      server.shutdown
      worker.join
    end
  end
end
