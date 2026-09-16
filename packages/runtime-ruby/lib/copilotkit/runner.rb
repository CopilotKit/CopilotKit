# frozen_string_literal: true
require 'base64'
require 'timeout'
require_relative 'websocket'

module CopilotKit
  class RetryableGatewayError < Error; end
  class PermanentGatewayError < Error; end
  # Phoenix V2 transport. Each synchronous push waits for its durability ACK.
  class Gateway
    attr_reader :supports_batch
    def initialize(url:, token:, thread_id:, run_id:, on_stop: nil)
      @url, @token, @thread_id, @run_id = url, token, thread_id, run_id
      @reference = 0
      @messages = Queue.new
      @mutex = Mutex.new
      @on_stop = on_stop
    end

    def connect
      @messages = SizedQueue.new(64)
      queue = @messages
      @socket = WebSocketTransport.new(@url.sub(%r{/$}, '') + '/websocket?vsn=2.0.0', {
        'Sec-WebSocket-Protocol' => "phoenix, base64url.bearer.phx.#{Base64.strict_encode64(@token).delete('=')}"
      }) do |message|
        if message.is_a?(Array) && message[2] == "ingestion:#{@run_id}" && message[3] == 'ag-ui' && message[4].is_a?(Hash) && message[4]['type'] == 'CUSTOM' && message[4]['name'] == 'stop'
          @on_stop&.call
        else
          begin
            queue.push(message, true)
          rescue ThreadError, ClosedQueueError
            queue.close
          end
        end
      end
      @join_ref = next_ref
      reply = exchange(@join_ref, 'phx_join', { 'thread_id' => @thread_id, 'run_id' => @run_id })
      raise RetryableGatewayError.new(502, 'Gateway is draining') if reply['status'] != 'ok' && reply.dig('response', 'retryable') == true
      raise Error.new(502, 'Gateway rejected channel join') unless reply['status'] == 'ok'
      @supports_batch = Array(reply.dig('response', 'capabilities')).include?('runner_event_batch_v1')
      true
    rescue Timeout::Error, RetryableGatewayError
      close
      attempts = (attempts || 0) + 1
      if attempts < 4
        sleep(0.1 * 2**(attempts - 1))
        retry
      end
      raise Error.new(502, 'Gateway join timed out')
    end

    def publish(events)
      @mutex.synchronize do
        groups = @supports_batch ? [events] : events.map { |event| [event] }
        groups.each do |group|
          reply = exchange(next_ref, @supports_batch ? 'events' : 'event', @supports_batch ? { 'events' => group } : group.first)
          if reply['status'] != 'ok'
            type = reply.dig('response', 'retryable') == false ? PermanentGatewayError : Error
            raise type.new(502, 'Gateway rejected event')
          end
        end
      end
    end

    # Recover idle transport failures without cancelling a valid platform lease.
    def heartbeat
      @mutex.synchronize do
        4.times do |attempt|
          begin
            if attempt.positive?
              close
              connect
            end
            return exchange(next_ref, 'heartbeat', {}, topic: 'phoenix')
          rescue StandardError
            raise if attempt == 3
            sleep(0.1 * 2**attempt)
          end
        end
      end
    end

    # Serialize reconnects with event ACKs and heartbeat recovery.
    def reconnect
      @mutex.synchronize do
        close
        connect
      end
    end

    def close
      @socket&.close
    rescue StandardError
      nil
    end

    private

    def next_ref
      @reference += 1
      @reference.to_s
    end

    def exchange(ref, event, payload, topic: "ingestion:#{@run_id}")
      @socket.send(JSON.generate([@join_ref, ref, topic, event, payload]))
      Timeout.timeout(5) do
        loop do
          message = @messages.pop
          raise Error.new(502, 'Gateway connection closed') if message.nil? || message == [:closed]
          next unless message.is_a?(Array) && message[1] == ref && message[3] == 'phx_reply'
          return message[4]
        end
      end
    end
  end

  # Owns a single run, including gateway durability, lease renewal, and cleanup.
  class Runner
    attr_reader :thread_id, :run_id

    def initialize(platform:, url:, auth_token:, lock:, agent:, input:, messages:, telemetry:, on_error: nil,
                   heartbeat_interval: 15, lock_ttl: 20, queue_capacity: 32)
      @platform, @lock, @agent, @input, @messages, @telemetry = platform, lock, agent, input, messages, telemetry
      @on_error = on_error
      @thread_id, @run_id = lock.fetch('threadId'), lock.fetch('runId')
      @heartbeat_interval, @lock_ttl = heartbeat_interval, lock_ttl
      @events, @state_mutex = SizedQueue.new(queue_capacity), Mutex.new
      @cancel_code, @producer, @pending_event = nil, nil, nil
      @durable_terminal = false
      @terminal_sent = false
      @open_messages, @open_tools = {}, {}
      @gateway = Gateway.new(url: url, token: auth_token, thread_id: @thread_id, run_id: @run_id, on_stop: -> { request_stop })
      @sequence, @stopped = 0, false
      @lock_path = '/api/threads/' + URI.encode_www_form_component(lock.fetch('threadId')) + '/lock'
    end

    def join_gateway
      raise Error.new(503, 'Run startup was cancelled') if @cancel_code || @stopped
      @gateway.connect
      raise Error.new(503, 'Run startup was cancelled') if @cancel_code || @stopped
    end

    def prepare_input(input, messages)
      @input, @messages = input, messages
    end

    # Lease renewal does not wait for history, channel join, or event ACKs.
    def start_lease
      return if @lease_thread
      @lease_thread = Thread.new do
        loop do
          sleep @heartbeat_interval
          break if @stopped
          @platform.request('PATCH', @lock_path, 'runId' => @lock['runId'], 'ttlSeconds' => @lock_ttl)
        rescue StandardError => error
          report_error(error)
          request_stop(code: 'LOCK_RENEWAL_FAILED')
          break
        end
      end
    end

    def start(&finished)
      start_lease
      @thread = Thread.new do
        @telemetry.emit('oss.runtime.agent_execution_stream_started')
        heartbeat = Thread.new do
          loop do
            sleep @heartbeat_interval
            break if @stopped
            @gateway.heartbeat
          rescue StandardError => error
            report_error(error)
            request_stop(code: 'GATEWAY_UNAVAILABLE')
            break
          end
        end
        outcome = 'completed'
        stream_completed = false
        begin
          emit('type' => 'RUN_STARTED', 'input' => @input.merge('messages' => @messages))
          @state_mutex.synchronize do
            @producer = Thread.new { produce } unless @cancel_code
          end
          terminal = false
          while (item = @events.pop)
            break if @cancel_code || terminal
            kind, event = item
            raise event if kind == :error
            next if event['type'] == 'RUN_STARTED'
            batch = [event]
            if @gateway.supports_batch
              while batch.length < 32 && !%w[RUN_FINISHED RUN_ERROR].include?(batch.last['type'])
                begin
                  next_kind, next_event = @events.pop(true)
                  break unless next_kind
                  raise next_event if next_kind == :error
                  batch << next_event unless next_event['type'] == 'RUN_STARTED'
                rescue ThreadError
                  break
                end
              end
            end
            event = batch.last
            terminal ||= %w[RUN_FINISHED RUN_ERROR].include?(event['type'])
            if event['type'] == 'RUN_ERROR'
              outcome = 'error'
              @telemetry.emit('oss.runtime.agent_execution_stream_errored')
              report_error(Error.new(502, 'Agent run failed'))
            end
            emit_batch(batch)
            break if terminal
          end
          if @cancel_code && !terminal
            outcome = 'error'
            @telemetry.emit('oss.runtime.agent_execution_stream_errored')
            emit('type' => 'RUN_ERROR', 'message' => @cancel_code == 'STOPPED' ? 'Run stopped by user' : 'Run lease was lost', 'code' => @cancel_code)
          elsif !terminal
            outcome = 'error'
            @telemetry.emit('oss.runtime.agent_execution_stream_errored')
            report_error(Error.new(502, 'Run ended without emitting a terminal event'))
            finalize_incomplete_stream
          end
          stream_completed = terminal
        rescue StandardError => error
          outcome = 'error'
          @telemetry.emit('oss.runtime.agent_execution_stream_errored')
          report_error(error)
          begin
            emit('type' => 'RUN_ERROR', 'message' => 'Agent run failed', 'code' => 'AGENT_RUN_FAILED') unless @stopped || @pending_event
          rescue StandardError
            nil
          end
        ensure
          @stopped = true
          @events.close
          @producer&.kill
          @producer&.join(0.1)
          heartbeat.kill
          heartbeat.join
          @lease_thread&.kill
          @lease_thread&.join
          @gateway.close
          begin
            Timeout.timeout(3) { @platform.request('DELETE', @lock_path, 'runId' => @lock['runId']) }
          rescue StandardError => error
            report_error(error)
          end
          @telemetry.emit('oss.runtime.agent_execution_stream_ended') if (outcome == 'completed' || stream_completed) && @durable_terminal
          finished.call
        end
      end
    end

    def join(timeout)
      @thread&.join(timeout)
    end

    # Cancels only the producer; the publisher finishes its current durability ACK.
    def request_stop(code: 'STOPPED')
      @state_mutex.synchronize do
        return false if @stopped || @cancel_code || @terminal_sent
        @cancel_code = code
        @producer&.kill
        @events.close
      end
      true
    end

    # Bounded force-close used only after the caller's graceful drain deadline.
    def stop(timeout: 0.1)
      request_stop
      @stopped = true
      @gateway.close
      @lease_thread&.kill
      @lease_thread&.join(timeout)
      return unless @thread&.alive?
      @thread.kill
      @thread.join(timeout)
    end

    private

    def produce
      @agent.each_event(@input) { |event| @events.push([:event, event]) }
    rescue ClosedQueueError
      nil
    rescue StandardError => error
      @events.push([:error, error]) unless @events.closed?
    ensure
      @events.close
    end

    def report_error(error)
      @on_error&.call(error)
    rescue StandardError
      nil
    end

    def emit(source)
      emit_batch([source])
    end

    def finalize_incomplete_stream
      message = 'Run ended without emitting a terminal event'
      @open_messages.keys.each { |id| emit('type' => 'TEXT_MESSAGE_END', 'messageId' => id) }
      @open_tools.to_a.each do |id, state|
        emit('type' => 'TOOL_CALL_END', 'toolCallId' => id) unless state[:ended]
        unless state[:result]
          emit('type' => 'TOOL_CALL_RESULT', 'toolCallId' => id, 'messageId' => "#{id}-result", 'role' => 'tool',
               'content' => JSON.generate('status' => 'error', 'reason' => 'missing_terminal_event', 'message' => message))
        end
      end
      emit('type' => 'RUN_ERROR', 'code' => 'INCOMPLETE_STREAM', 'message' => message)
    end

    def track_stream(event)
      id = event['toolCallId']
      case event['type']
      when 'TEXT_MESSAGE_START' then @open_messages[event['messageId']] = true if event['messageId'].is_a?(String)
      when 'TEXT_MESSAGE_END' then @open_messages.delete(event['messageId'])
      when 'TOOL_CALL_START' then @open_tools[id] = {} if id.is_a?(String)
      when 'TOOL_CALL_END' then @open_tools[id][:ended] = true if @open_tools[id]
      when 'TOOL_CALL_RESULT' then @open_tools[id][:result] = true if @open_tools[id]
      end
      @open_tools.delete(id) if @open_tools[id] && @open_tools[id][:ended] && @open_tools[id][:result]
    end

    def emit_batch(sources)
      events = sources.map do |source|
        @sequence += 1
        source.merge('threadId' => @lock['threadId'], 'runId' => @lock['runId'], 'thread_id' => @lock['threadId'], 'run_id' => @lock['runId'],
                           'metadata' => (source['metadata'].is_a?(Hash) ? source['metadata'] : {}).merge(
                             'cpki_event_id' => SecureRandom.uuid, 'cpki_event_seq' => @sequence))
      end
      @pending_event = events
      @terminal_sent = true if events.any? { |event| %w[RUN_FINISHED RUN_ERROR].include?(event['type']) }
      4.times do |attempt|
        begin
          @gateway.publish(events)
          events.each { |event| track_stream(event) }
          @pending_event = nil
          @durable_terminal = true if events.any? { |event| %w[RUN_FINISHED RUN_ERROR].include?(event['type']) }
          return
        rescue StandardError => error
          raise if attempt == 3 || @stopped || error.is_a?(PermanentGatewayError)
          sleep(0.1 * (2**attempt))
          @gateway.reconnect
        end
      end
    end
  end
end
