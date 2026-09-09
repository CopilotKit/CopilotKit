# frozen_string_literal: true
require 'base64'
require 'timeout'
require_relative 'websocket'

module CopilotKit
  # Phoenix V2 transport. Each synchronous push waits for its durability ACK.
  class Gateway
    def initialize(url:, token:, thread_id:, run_id:)
      @url, @token, @thread_id, @run_id = url, token, thread_id, run_id
      @reference = 0
      @messages = Queue.new
      @mutex = Mutex.new
    end

    def connect
      @messages = Queue.new
      queue = @messages
      @socket = WebSocketTransport.new(@url.sub(%r{/$}, '') + '/websocket?vsn=2.0.0', {
        'Sec-WebSocket-Protocol' => "phoenix, base64url.bearer.phx.#{Base64.strict_encode64(@token).delete('=')}"
      }) { |message| queue << message }
      @join_ref = next_ref
      reply = exchange(@join_ref, 'phx_join', { 'thread_id' => @thread_id, 'run_id' => @run_id })
      raise Error.new(502, 'Gateway rejected channel join') unless reply['status'] == 'ok'
      true
    rescue Timeout::Error
      close
      raise Error.new(502, 'Gateway join timed out')
    end

    def publish(event)
      @mutex.synchronize do
        reply = exchange(next_ref, 'event', event)
        raise Error.new(502, 'Gateway rejected event') unless reply['status'] == 'ok'
      end
    end

    def heartbeat
      @mutex.synchronize { exchange(next_ref, 'heartbeat', {}, topic: 'phoenix') }
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
          raise Error.new(502, 'Gateway connection closed') if message == [:closed]
          next unless message.is_a?(Array) && message[1] == ref && message[3] == 'phx_reply'
          return message[4]
        end
      end
    end
  end

  # Owns a single run, including gateway durability, lease renewal, and cleanup.
  class Runner
    def initialize(platform:, url:, auth_token:, lock:, agent:, input:, messages:, telemetry:, on_error: nil)
      @platform, @lock, @agent, @input, @messages, @telemetry = platform, lock, agent, input, messages, telemetry
      @on_error = on_error
      @gateway = Gateway.new(url: url, token: auth_token, thread_id: lock.fetch('threadId'), run_id: lock.fetch('runId'))
      @sequence, @stopped = 0, false
      @lock_path = '/api/threads/' + URI.encode_www_form_component(lock.fetch('threadId')) + '/lock'
    end

    def join_gateway
      @gateway.connect
    end

    def start(&finished)
      @thread = Thread.new do
        @telemetry.emit('oss.runtime.agent_execution_stream_started')
        heartbeat = Thread.new do
          loop do
            sleep 10
            break if @stopped
            @platform.request('PATCH', @lock_path, 'runId' => @lock['runId'], 'ttlSeconds' => 60)
            @gateway.heartbeat
          rescue StandardError
            @stopped = true
            @gateway.close
            break
          end
        end
        outcome = 'completed'
        begin
          emit('type' => 'RUN_STARTED', 'input' => @input.merge('messages' => @messages))
          terminal = false
          @agent.each_event(@input) do |event|
            raise Error.new(503, 'Run cancelled') if @stopped
            break if terminal
            next if event['type'] == 'RUN_STARTED'
            terminal ||= %w[RUN_FINISHED RUN_ERROR].include?(event['type'])
            if event['type'] == 'RUN_ERROR'
              outcome = 'error'
              @telemetry.emit('oss.runtime.agent_execution_stream_errored')
              report_error(Error.new(502, 'Agent run failed'))
            end
            emit(event)
          end
          emit('type' => 'RUN_FINISHED') unless terminal
        rescue StandardError => error
          outcome = 'error'
          @telemetry.emit('oss.runtime.agent_execution_stream_errored')
          report_error(error)
          begin
            emit('type' => 'RUN_ERROR', 'message' => 'Agent run failed', 'code' => 'AGENT_RUN_FAILED') unless @stopped
          rescue StandardError
            nil
          end
        ensure
          @stopped = true
          heartbeat.kill
          heartbeat.join
          @gateway.close
          begin
            @platform.request('DELETE', @lock_path, 'runId' => @lock['runId'])
          rescue StandardError => error
            report_error(error)
          end
          @telemetry.emit('oss.runtime.agent_execution_stream_ended') if outcome == 'completed'
          finished.call
        end
      end
    end

    def join(timeout)
      @thread&.join(timeout)
    end

    def stop
      @stopped = true
      @gateway.close
      return unless @thread&.alive?
      @thread.kill
      @thread.join
    end

    private

    def report_error(error)
      @on_error&.call(error)
    rescue StandardError
      nil
    end

    def emit(source)
      @sequence += 1
      event = source.merge('threadId' => @lock['threadId'], 'runId' => @lock['runId'], 'thread_id' => @lock['threadId'], 'run_id' => @lock['runId'],
                           'metadata' => (source['metadata'].is_a?(Hash) ? source['metadata'] : {}).merge(
                             'cpki_event_id' => SecureRandom.uuid, 'cpki_event_seq' => @sequence))
      4.times do |attempt|
        begin
          @gateway.publish(event)
          return
        rescue StandardError
          raise if attempt == 3 || @stopped
          sleep(0.1 * (2**attempt))
          @gateway.close
          @gateway.connect
        end
      end
    end
  end
end
