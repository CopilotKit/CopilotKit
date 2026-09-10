# frozen_string_literal: true
require 'digest'
module CopilotKit
  # Request-scoped MCP Streamable HTTP session. Never accepts a browser URL or credentials.
  class MCPClient
    def initialize(config)
      raise ArgumentError, 'Only MCP Streamable HTTP is supported' unless config['type'] == 'http'
      @uri = URI(config.fetch('url'))
      raise ArgumentError, 'MCP URL must use HTTP(S)' unless @uri.is_a?(URI::HTTP) && !@uri.userinfo
      @headers = config.fetch('headers', {}).dup
      @session, @reference, @version = nil, 0, '2025-03-26'
    end

    def connect
      result = rpc('initialize', { 'protocolVersion' => @version,
                   'capabilities' => { 'extensions' => { 'io.modelcontextprotocol/ui' => { 'mimeTypes' => ['text/html+mcp'] } } },
                   'clientInfo' => { 'name' => 'copilotkit-runtime-ruby', 'version' => '0.1.0' } })
      raise Error.new(502, 'Malformed MCP initialization') unless result.is_a?(Hash) && result['protocolVersion'].is_a?(String)
      @version = result['protocolVersion']
      rpc('notifications/initialized', nil, notification: true)
      self
    end

    def rpc(method, params = nil, notification: false)
      @reference += 1
      envelope = { 'jsonrpc' => '2.0', 'method' => method }
      envelope['id'] = @reference unless notification
      envelope['params'] = params unless params.nil?
      raw = transport('POST', JSON.generate(envelope))
      return { 'success' => true } if notification
      candidates = if raw[:type].include?('text/event-stream')
                     raw[:body].split(/\r?\n\r?\n/).filter_map do |frame|
                       data = frame.lines.select { |line| line.start_with?('data:') }.map { |line| line.delete_prefix('data:').strip }.join("\n")
                       JSON.parse(data) unless data.empty?
                     end
                   else
                     [JSON.parse(raw[:body])]
                   end
      response = candidates.find { |message| message.is_a?(Hash) && message['id'] == envelope['id'] }
      raise Error.new(502, 'Malformed MCP response') unless response && response['jsonrpc'] == '2.0'
      raise Error.new(502, 'MCP request failed') if response.key?('error')
      raise Error.new(502, 'Missing MCP result') unless response.key?('result')
      response['result']
    rescue JSON::ParserError
      raise Error.new(502, 'Malformed MCP JSON response')
    end

    def close
      transport('DELETE') if @session
    rescue StandardError
      nil
    end

    private

    def transport(method, body = nil)
      headers = @headers.merge('content-type' => 'application/json', 'accept' => 'application/json, text/event-stream', 'mcp-protocol-version' => @version)
      headers['mcp-session-id'] = @session if @session
      request = Net::HTTPGenericRequest.new(method, !body.nil?, true, @uri.request_uri, headers)
      request.body = body if body
      result = nil
      expected_id = body && JSON.parse(body)['id']
      catch(:mcp_response_complete) do
       Net::HTTP.start(@uri.host, @uri.port, use_ssl: @uri.scheme == 'https', open_timeout: 5, read_timeout: 15) do |http|
        http.request(request) do |response|
          raise Error.new(502, 'MCP server request failed') unless response.code.to_i.between?(200, 299)
          @session = response['mcp-session-id'] if response['mcp-session-id']
          data = +''
          response.read_body do |chunk|
            data << chunk
            raise Error.new(502, 'MCP response exceeded size limit') if data.bytesize > 4_194_304
            if expected_id && response['content-type'].to_s.include?('text/event-stream')
              frames = data.split(/\r?\n\r?\n/, -1)[0...-1]
              complete = frames.any? do |frame|
                payload = frame.lines.select { |line| line.start_with?('data:') }.map { |line| line.delete_prefix('data:').strip }.join("\n")
                message = payload.empty? ? nil : JSON.parse(payload)
                message.is_a?(Hash) && message['id'] == expected_id
              end
              if complete
                result = { body: frames.join("\n\n"), type: 'text/event-stream' }
                throw :mcp_response_complete
              end
            end
          end
          result = { body: data, type: response['content-type'].to_s }
        end
       end
      end
      result
    end
  end

  # MCP Apps discovery, tool execution, activity, and allowlisted iframe reentry.
  class MCPApps
    METHODS = %w[tools/call resources/read notifications/message ping].freeze
    def initialize(servers)
      @servers, @tools, @calls, @resolved = servers, {}, {}, Set.new
    end

    def server_hash(server)
      Digest::MD5.hexdigest(JSON.generate('type' => server['type'], 'url' => server['url']))
    end

    def proxy(request)
      raise Error.new(400, 'Invalid MCP proxy request') unless request.is_a?(Hash)
      raise Error.new(403, 'MCP method is not allowed') unless METHODS.include?(request['method'])
      matches = @servers.select do |entry|
        request['serverId'] ? entry['serverId'] == request['serverId'] : server_hash(entry) == request['serverHash']
      end
      server = matches.first if matches.length == 1
      raise Error.new(404, 'Unknown MCP server') unless server
      with_client(server) { |client| client.rpc(request['method'], request['params'], notification: request['method'] == 'notifications/message') }
    rescue Error, ArgumentError, KeyError, SocketError, IOError, SystemCallError, Timeout::Error, Net::HTTPBadResponse, OpenSSL::SSL::SSLError
      { 'error' => 'MCP proxy request rejected or failed' }
    end

    def prepare(input)
      @servers.each do |server|
        with_client(server) do |client|
          cursor, pages = nil, 0
          loop do
            result = client.rpc('tools/list', cursor ? { 'cursor' => cursor } : {})
            raise Error.new(502, 'Invalid MCP tool listing') unless result.is_a?(Hash) && result['tools'].is_a?(Array)
            result['tools'].each do |tool|
              next unless tool.is_a?(Hash)
              ui = tool.dig('_meta', 'ui')
              if ui.is_a?(Hash) && ui.key?('visibility')
                next unless ui['visibility'].is_a?(Array) && ui['visibility'].include?('model')
              end
              resource = tool.dig('_meta', 'ui', 'resourceUri')
              resource = tool.dig('_meta', 'ui/resourceUri') unless resource.is_a?(String)
              next unless resource.is_a?(String) && tool['name'].is_a?(String)
              raise Error.new(502, 'Duplicate MCP UI tool name') if @tools.key?(tool['name'])
              @tools[tool['name']] = { server: server, resource: resource, tool: {
                'name' => tool['name'], 'description' => tool.fetch('description', '') + "\n[UI Resource: #{resource}]",
                'parameters' => tool.fetch('inputSchema', { 'type' => 'object', 'properties' => {} }) } }
            end
            cursor = result['nextCursor']
            break unless cursor
            pages += 1
            raise Error.new(502, 'MCP tool pagination limit exceeded') if pages >= 32
          end
        end
      end
      input.fetch('messages', []).each do |message|
        @resolved << message['toolCallId'] if message['role'] == 'tool'
        message.fetch('toolCalls', []).each do |call|
          function = call['function'] || {}
          @calls[call['id']] = { name: function['name'], args: function.fetch('arguments', '') }
        end
      end
      names = @tools.keys
      input.merge('tools' => input.fetch('tools', []).reject { |tool| names.include?(tool['name']) } + @tools.values.map { |entry| entry[:tool] })
    end

    def accept(event)
      id = event['toolCallId']
      case event['type']
      when 'TOOL_CALL_START' then @calls[id] = { name: event['toolCallName'], args: '' }
      when 'TOOL_CALL_ARGS'
        if @calls[id]
          @calls[id][:args] += event.fetch('delta', '')
          raise Error.new(502, 'MCP tool arguments exceeded size limit') if @calls[id][:args].bytesize > 1_048_576
        end
      when 'TOOL_CALL_RESULT' then @resolved << id
      end
    end

    def finish
      @calls.each do |id, call|
        info = @tools[call[:name]]
        next unless info && !@resolved.include?(id)
        begin
          arguments = JSON.parse(call[:args].empty? ? '{}' : call[:args])
          raise Error.new(400, 'MCP tool arguments must be an object') unless arguments.is_a?(Hash)
          result = with_client(info[:server]) { |client| client.rpc('tools/call', { 'name' => call[:name], 'arguments' => arguments }) }
          content = result['content']
          text = content.is_a?(Array) ? content.filter_map { |entry| entry['text'] if entry.is_a?(Hash) && entry['type'] == 'text' }.join("\n") : ''
          yield({ 'type' => 'TOOL_CALL_RESULT', 'messageId' => SecureRandom.uuid, 'toolCallId' => id, 'content' => text.empty? ? JSON.generate(content) : text })
          activity = { 'result' => result, 'resourceUri' => info[:resource], 'serverHash' => server_hash(info[:server]), 'toolInput' => arguments }
          activity['serverId'] = info[:server]['serverId'] if info[:server]['serverId']
          yield({ 'type' => 'ACTIVITY_SNAPSHOT', 'messageId' => SecureRandom.uuid, 'activityType' => 'mcp-apps', 'content' => activity, 'replace' => true })
        rescue StandardError
          yield({ 'type' => 'TOOL_CALL_RESULT', 'messageId' => SecureRandom.uuid, 'toolCallId' => id, 'content' => JSON.generate('error' => 'MCP tool execution failed') })
        end
      end
    end

    private

    def with_client(server)
      client = MCPClient.new(server)
      client.connect
      yield client
    ensure
      client&.close
    end
  end
end
