# frozen_string_literal: true
require 'timeout'
require 'base64'

module CopilotKit
  # Bounded asynchronous analytics exporter with TypeScript-compatible envelopes.
  # Every attribute is constructed here; application content is never copied.
  class Telemetry
    PREFIX = 'oss.runtime.'
    ENDPOINT = 'https://telemetry.copilotkit.ai/ingest'
    EVENTS = %w[instance_created copilot_request_created agent_execution_stream_started agent_execution_stream_ended agent_execution_stream_errored].freeze

    def initialize(exporter: nil, disabled: false, sample_rate: 0.05, telemetry_id: nil, license_token: nil,
                   url: nil, queue_capacity: 256, random: -> { Random.rand }, env: ENV)
      @disabled = disabled || %w[DO_NOT_TRACK COPILOTKIT_TELEMETRY_DISABLED].any? { |key| %w[true 1].include?(env[key].to_s.downcase) }
      configured_rate = env.key?('COPILOTKIT_TELEMETRY_SAMPLE_RATE') ? env['COPILOTKIT_TELEMETRY_SAMPLE_RATE'] : sample_rate
      begin
        @rate = Float(configured_rate)
      rescue ArgumentError, TypeError
        @rate = 0.05
      end
      @rate = 0.05 unless @rate.finite? && @rate.between?(0, 1)
      @id = [telemetry_id, env['CPK_TELEMETRY_ID']].filter_map do |value|
        next unless value.is_a?(String)
        normalized = value.gsub(/\A[ \t]+|[ \t]+\z/, '')
        normalized if normalized.match?(/\A[A-Za-z0-9_-]{1,128}\z/)
      end.first unless @disabled
      @identified = false
      unless @disabled || @id
        token = [license_token, env['COPILOTKIT_LICENSE_TOKEN']].find do |value|
          value.is_a?(String) && value.match?(/[^\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/)
        end
        @id = license_telemetry_id(token)
        @identified = !@id.nil?
        @rate = 1.0 if @identified
      end
      @url = url || env['COPILOTKIT_TELEMETRY_URL'] || ENDPOINT
      @exporter, @random = exporter, random
      raise ArgumentError, 'queue_capacity must be positive' unless queue_capacity.is_a?(Integer) && queue_capacity.positive?
      @queue, @mutex, @condition = SizedQueue.new(queue_capacity), Mutex.new, ConditionVariable.new
      @pending, @closed, @worker = 0, false, nil
    end

    def disabled?
      @disabled
    end

    # Queue one sampled event without waiting for the network. A full queue drops it.
    def emit(name, attributes = {})
      return if @disabled || (!@identified && (@rate.zero? || @random.call >= @rate))
      event_name = name.delete_prefix(PREFIX)
      return unless name.start_with?(PREFIX) && EVENTS.include?(event_name)
      properties = case event_name
                   when 'instance_created'
                     count = attributes['agentsAmount']
                     { 'actionsAmount' => 0, 'endpointTypes' => [], 'endpointsAmount' => 0,
                       'agentsAmount' => count.is_a?(Integer) && count >= 0 ? count : 0, 'cloud.api_key_provided' => false }
                   when 'copilot_request_created'
                     return unless %w[run connect].include?(attributes['requestType'])
                     { 'requestType' => attributes['requestType'], 'cloud.guardrails.enabled' => false, 'cloud.api_key_provided' => false }
                   when 'agent_execution_stream_errored'
                     { 'error' => 'AGENT_RUN_FAILED' }
                   else
                     {}
                   end
      event = { 'event' => name, 'properties' => properties, 'ts' => Time.now.to_i,
                'package' => { 'name' => 'copilotkit-runtime-ruby', 'version' => '0.1.0' },
                'global_properties' => { 'sampleRate' => @rate, 'sampleRateAdjustmentFactor' => 1 - @rate,
                  'sampleWeight' => 1 / @rate, 'telemetry_identified' => @identified,
                  'telemetry_emitter' => 'runtime-ruby', 'telemetry_transport' => 'lambda' } }
      @mutex.synchronize do
        return if @closed
        begin
          @queue.push(event, true)
        rescue ThreadError
          return
        end
        @pending += 1
        @worker ||= Thread.new { consume }
      end
      nil
    rescue StandardError
      nil
    end

    # Wait for already queued events, up to the caller's deadline.
    def flush(timeout: 3)
      deadline = monotonic + timeout
      @mutex.synchronize do
        while @pending.positive?
          remaining = deadline - monotonic
          return false unless remaining.positive?
          @condition.wait(@mutex, remaining)
        end
      end
      true
    end

    # Stop accepting work, drain within a deadline, then cancel a stalled exporter.
    def close(timeout: 3)
      worker = @mutex.synchronize do
        return if @closed
        @closed = true
        begin
          @queue.push(nil, true) if @worker
        rescue ThreadError
          # A full queue drains naturally; the worker stops when closed and empty.
        end
        @worker
      end
      worker&.join(timeout)
      if worker&.alive?
        worker.kill
        worker.join(0.1)
      end
      nil
    rescue StandardError
      nil
    end

    private

    # Claims provide analytics attribution only, never license verification.
    def license_telemetry_id(token)
      return unless token.is_a?(String)
      parts = token.split('.', -1)
      return unless parts.length == 3
      payload = parts[1]
      return unless payload.match?(/\A[A-Za-z0-9_-]+\z/) && payload.length % 4 != 1
      decoded = JSON.parse(Base64.urlsafe_decode64(payload))
      return unless decoded.is_a?(Hash) && decoded['telemetry_id'].is_a?(String)
      id = decoded['telemetry_id'].gsub(/\A[ \t]+|[ \t]+\z/, '')
      id if id.match?(/\A[A-Za-z0-9_-]{1,128}\z/)
    rescue ArgumentError, JSON::ParserError
      nil
    end

    def monotonic
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end

    def consume
      loop do
        event = @queue.pop
        break unless event
        begin
          Timeout.timeout(3) { @exporter ? @exporter.call(event) : send_http(event) }
        rescue StandardError
          # Analytics failure never changes runtime behavior or emits raw diagnostics.
        ensure
          @mutex.synchronize { @pending -= 1; @condition.broadcast }
        end
        break if @mutex.synchronize { @closed && @queue.empty? }
      end
    ensure
      begin
        Timeout.timeout(3) { @exporter.close } if @exporter.respond_to?(:close)
      rescue StandardError
        nil
      end
    end

    def send_http(event)
      uri = URI(@url)
      return unless uri.is_a?(URI::HTTP) && !uri.userinfo
      headers = { 'content-type' => 'application/json' }
      headers['X-CopilotKit-Telemetry-Id'] = @id if @id
      request = Net::HTTP::Post.new(uri.request_uri, headers)
      request.body = JSON.generate(event)
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 3, read_timeout: 3) do |http|
        http.max_retries = 0
        http.request(request) do |response| # Net::HTTP never follows redirects.
          received = 0
          response.read_body do |chunk|
            received += chunk.bytesize
            raise IOError, 'Telemetry response exceeded size limit' if received > 65_536
          end
        end
      end
    end
  end
end
