# frozen_string_literal: true
module CopilotKit
  # Native agents implement each_event(input) and yield AG-UI event hashes.
  # Each call must keep its mutable run state local for concurrent requests.
  class Agent
    attr_reader :description
    def initialize(description: '')
      @description = description
    end
    def each_event(_input)
      raise NotImplementedError, 'Implement each_event(input) and yield AG-UI events'
    end
  end

  # AG-UI HTTP adapter. Parses SSE incrementally with bounded event size.
  class HttpAgent < Agent
    def initialize(url:, headers: {}, description: '')
      super(description: description)
      @uri, @headers = URI(url), headers.freeze
      raise ArgumentError, 'Agent URL must use HTTP(S)' unless @uri.is_a?(URI::HTTP)
    end

    def each_event(input)
      request = Net::HTTP::Post.new(@uri.request_uri, { 'content-type' => 'application/json', 'accept' => 'text/event-stream' }.merge(@headers))
      request.body = JSON.generate(input)
      Net::HTTP.start(@uri.host, @uri.port, use_ssl: @uri.scheme == 'https', open_timeout: 5, read_timeout: 120) do |http|
        http.request(request) do |response|
          raise Error.new(502, 'Agent request failed') unless response.code.to_i.between?(200, 299)
          buffer = +''
          response.read_body do |chunk|
            buffer << chunk
            raise Error.new(502, 'Agent event exceeded size limit') if buffer.bytesize > 1_048_576
            while (separator = /\r?\n\r?\n/.match(buffer))
              frame = buffer.slice!(0, separator.end(0))
              data = frame.lines.select { |line| line.start_with?('data:') }.map { |line| line.delete_prefix('data:').sub(/\A /, '').strip }.join("\n")
              next if data.empty? || data == '[DONE]'
              event = JSON.parse(data)
              raise Error.new(502, 'Malformed AG-UI event') unless event.is_a?(Hash) && event['type'].is_a?(String)
              yield event
            end
          end
        end
      end
    end
  end
end
