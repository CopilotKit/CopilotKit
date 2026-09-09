# frozen_string_literal: true
require 'socket'
require 'openssl'
require 'websocket'

module CopilotKit
  # Small synchronous WebSocket transport with verified TLS and an owned reader.
  # Protocol framing uses the websocket gem; TLS trust and timeouts stay explicit.
  class WebSocketTransport
    def initialize(url, headers, &on_message)
      uri = URI(url)
      raise ArgumentError, 'WebSocket URL must use ws or wss' unless %w[ws wss].include?(uri.scheme)
      @closed, @write_mutex = false, Mutex.new
      @socket = Socket.tcp(uri.host, uri.port || (uri.scheme == 'wss' ? 443 : 80), connect_timeout: 5)
      if uri.scheme == 'wss'
        context = OpenSSL::SSL::SSLContext.new
        context.set_params(verify_mode: OpenSSL::SSL::VERIFY_PEER)
        context.verify_hostname = true
        @socket = OpenSSL::SSL::SSLSocket.new(@socket, context)
        @socket.sync_close = true
        @socket.hostname = uri.host
        Timeout.timeout(5) { @socket.connect }
        @socket.post_connection_check(uri.host)
      end
      handshake = WebSocket::Handshake::Client.new(url: url, headers: headers)
      @socket.write(handshake.to_s)
      Timeout.timeout(5) do
        until handshake.finished?
          byte = @socket.read(1)
          raise Error.new(502, 'Gateway handshake ended early') unless byte
          handshake << byte
        end
      end
      raise Error.new(502, 'Gateway WebSocket upgrade rejected') unless handshake.valid?
      @version = handshake.version
      @reader = Thread.new do
        decoder = WebSocket::Frame::Incoming::Client.new
        loop do
          decoder << @socket.readpartial(16_384)
          while (frame = decoder.next)
            case frame.type
            when :text then on_message.call(JSON.parse(frame.data))
            when :ping then write(frame.data, type: :pong)
            when :close
              on_message.call([:closed])
              break
            end
          end
          # The framing gem reports unsupported close codes (including 1012)
          # through error? rather than raising. Treat them as a closed transport
          # immediately so pending events replay without waiting for an ACK timeout.
          raise Error.new(502, 'Gateway framing failed') if decoder.error?
        end
      rescue StandardError
        on_message.call([:closed]) unless @closed
      end
    rescue StandardError
      @socket&.close
      raise
    end

    def send(data)
      write(data)
    end

    def close
      @closed = true
      @socket&.close
      @reader&.join(1) unless @reader == Thread.current
    rescue IOError, SystemCallError
      nil
    end

    private

    def write(data, type: :text)
      @write_mutex.synchronize do
        raise Error.new(502, 'Gateway connection is closed') if @closed
        frame = WebSocket::Frame::Outgoing::Client.new(data: data, type: type, version: @version)
        @socket.write(frame.to_s)
      end
    end
  end
end
