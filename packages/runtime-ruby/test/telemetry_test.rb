# frozen_string_literal: true
require 'minitest/autorun'
require 'copilotkit/runtime'
require 'webrick'

class TelemetryTest < Minitest::Test
  def license(claim)
    'header.' + Base64.urlsafe_encode64(JSON.generate(claim), padding: false) + '.signature'
  end

  def test_legacy_license_claim_bypasses_anonymous_sampling_without_leaking_token
    events = []
    token = license('telemetry_id' => 'legacy-id')
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 0,
      env: { 'COPILOTKIT_LICENSE_TOKEN' => token })
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    telemetry.close
    assert_equal 1, events.length
    globals = events.first.fetch('global_properties')
    assert_equal [1, 0, 1, true], globals.values_at('sampleRate', 'sampleRateAdjustmentFactor', 'sampleWeight', 'telemetry_identified')
    refute JSON.generate(events).include?(token)
    refute JSON.generate(events).include?('legacy-id')
  end

  def test_valid_environment_identity_wins_over_license_after_invalid_option
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 0,
      telemetry_id: 'invalid/id', license_token: license('telemetry_id' => 'legacy'), env: { 'CPK_TELEMETRY_ID' => 'standalone' })
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    telemetry.close
    assert_empty events, 'A valid standalone environment ID must keep sampling enabled'
  end

  def test_blank_license_option_falls_back_to_environment
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 0, license_token: " \t ",
      env: { 'COPILOTKIT_LICENSE_TOKEN' => license('telemetry_id' => 'legacy') })
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    telemetry.close
    assert_equal 1, events.length
  end

  def test_javascript_whitespace_license_option_falls_back_but_nel_does_not
    whitespace = [0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, *(0x2000..0x200A), 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF]
    whitespace.each do |point|
      events = []
      telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 0, license_token: point.chr(Encoding::UTF_8),
        env: { 'COPILOTKIT_LICENSE_TOKEN' => license('telemetry_id' => 'legacy') })
      telemetry.emit('oss.runtime.agent_execution_stream_started')
      telemetry.close
      assert_equal 1, events.length, "JavaScript whitespace U+#{point.to_s(16)} must permit fallback"
    end
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 0, license_token: "\u0085",
      env: { 'COPILOTKIT_LICENSE_TOKEN' => license('telemetry_id' => 'legacy') })
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    telemetry.close
    assert_empty events, 'NEL is not JavaScript whitespace and must suppress fallback'
  end

  def test_license_attribution_does_not_consult_random_sampler
    events = []
    telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, license_token: license('telemetry_id' => 'legacy'),
      random: -> { raise 'Sampler must not run' }, env: {})
    telemetry.emit('oss.runtime.agent_execution_stream_started')
    telemetry.close
    assert_equal 1, events.length
  end

  def test_runtime_passes_explicit_license_to_its_default_exporter
    captured = nil
    exporter = CopilotKit::Telemetry.new(disabled: true)
    factory = ->(**options) { captured = options; exporter }
    token = license('telemetry_id' => 'legacy')
    CopilotKit::Telemetry.stub(:new, factory) do
      runtime = CopilotKit::Runtime.new(api_key: 'key', identify_user: ->(_) { nil }, license_token: token)
      runtime.close
    end
    assert_equal token, captured[:license_token]
  end

  def test_legacy_claim_parser_rejects_malformed_tokens_and_invalid_claims
    tokens = ['not-jwt', 'h.a.s', 'h.@@@.s', 'h.e30=.s', license(nil), license({}),
      license('telemetry_id' => 3), license('telemetry_id' => 'bad/id'), license('telemetry_id' => "bad\nid"),
      license('telemetry_id' => 'x' * 129)]
    tokens.each do |token|
      events = []
      telemetry = CopilotKit::Telemetry.new(exporter: ->(event) { events << event }, sample_rate: 0, license_token: token, env: {})
      telemetry.emit('oss.runtime.agent_execution_stream_started')
      telemetry.close
      assert_empty events
    end
  end

  def test_opt_out_and_standalone_identity_win_over_legacy_license
    [{ disabled: true }, { telemetry_id: 'standalone' }, { env: { 'CPK_TELEMETRY_ID' => 'standalone' } },
     { env: { 'DO_NOT_TRACK' => '1' } }, { env: { 'COPILOTKIT_TELEMETRY_DISABLED' => 'true' } }].each do |options|
      events = []
      telemetry = CopilotKit::Telemetry.new(**{ exporter: ->(event) { events << event }, sample_rate: 0,
        license_token: license('telemetry_id' => 'legacy'), env: {} }.merge(options))
      telemetry.emit('oss.runtime.agent_execution_stream_started')
      telemetry.close
      assert_empty events
    end
  end

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
      token = license('telemetry_id' => " \tlicense-id\t ")
      legacy = CopilotKit::Telemetry.new(url: endpoint, license_token: token, sample_rate: 0, env: {})
      legacy.emit('oss.runtime.agent_execution_stream_started')
      legacy.close
      call = Timeout.timeout(1) { received.pop }
      assert_equal 'license-id', call[:id]
      assert_equal true, call[:event].dig('global_properties', 'telemetry_identified')
      refute JSON.generate(call).include?(token)
      refute JSON.generate(call[:event]).include?('license-id')
      standalone = CopilotKit::Telemetry.new(url: endpoint, license_token: token, telemetry_id: 'standalone', sample_rate: 1, env: {})
      standalone.emit('oss.runtime.agent_execution_stream_started')
      standalone.close
      call = Timeout.timeout(1) { received.pop }
      assert_equal 'standalone', call[:id]
      assert_equal false, call[:event].dig('global_properties', 'telemetry_identified')
    ensure
      server.shutdown
      worker.join
    end
  end
end
