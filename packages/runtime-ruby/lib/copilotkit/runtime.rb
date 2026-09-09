# frozen_string_literal: true
require 'json'
require 'net/http'
require 'uri'
require 'securerandom'
require 'thread'
require_relative 'telemetry'

module CopilotKit
  # Public error with a safe message and the platform's HTTP status.
  class Error < StandardError
    attr_reader :status
    def initialize(status, message)
      @status = status
      super(message)
    end
  end

  # Rack endpoint. Mount directly in Rails routes with `mount runtime => '/copilotkit'`.
  class Runtime
    def initialize(api_key:, identify_user:, api_url: 'https://api.intelligence.copilotkit.ai',
                   runner_url: 'wss://realtime.intelligence.copilotkit.ai/runner',
                   client_url: 'wss://realtime.intelligence.copilotkit.ai/client', agents: {},
                   base_path: '', memory_access: nil, telemetry: nil, cors_origins: [],
                   learning_container: nil, a2ui: nil, mcp_apps: nil, on_error: nil)
      raise ArgumentError, 'api_key is required' if api_key.to_s.strip.empty?
      raise ArgumentError, 'identify_user must be callable' unless identify_user.respond_to?(:call)
      @platform = Platform.new(api_url, api_key)
      @api_key = api_key
      @identify_user, @agents, @base_path = identify_user, agents, base_path.sub(%r{/$}, '')
      @a2ui = a2ui == true ? {} : a2ui
      @mcp_servers = (mcp_apps || {}).fetch('servers', [])
      @runner_url, @client_url = runner_url, client_url
      @memory_access = memory_access || ->(_user, _env) { { 'user' => 'none', 'project' => 'none' } }
      @telemetry = telemetry || Telemetry.new
      @on_error = on_error
      @cors_origins, @learning_container = cors_origins.freeze, learning_container
      @runs, @mutex, @closed = {}, Mutex.new, false
      @telemetry.emit('oss.runtime.instance_created', 'agentsAmount' => @agents.length)
    end

    # Handles one Rack request. Customer authentication receives the real Rack environment.
    def call(env)
      path = env.fetch('PATH_INFO', '')
      path = path.delete_prefix(@base_path) if path == @base_path || path.start_with?(@base_path + '/')
      method = env.fetch('REQUEST_METHOD', 'GET')
      status, result = dispatch(method, path, env)
      response = [status, { 'content-type' => 'application/json', 'cache-control' => 'no-store' }, status == 204 ? [] : [JSON.generate(result)]]
    rescue Error => error
      report_error(error) if error.status >= 500
      status = error.status
      response = [status, { 'content-type' => 'application/json' }, [JSON.generate('error' => error.message)]]
    rescue JSON::ParserError, ArgumentError
      status = 400
      response = [400, { 'content-type' => 'application/json' }, [JSON.generate('error' => 'Invalid request body')]]
    rescue StandardError => error
      report_error(error)
      status = 502
      response = [502, { 'content-type' => 'application/json' }, [JSON.generate('error' => 'Runtime dependency failed')]]
    ensure
      if response
        response[1].delete('content-type') if response[0] == 204
        origin = env['HTTP_ORIGIN']
        if origin && @cors_origins.include?(origin)
          response[1].merge!('access-control-allow-origin' => origin, 'vary' => 'Origin',
                            'access-control-allow-credentials' => 'true',
                            'access-control-allow-methods' => 'GET, POST, PATCH, DELETE, OPTIONS',
                            'access-control-allow-headers' => 'Content-Type, Authorization')
        end
        return response
      end
    end

    # Waits for active work, cancels remaining agents, and flushes the exporter.
    def close(timeout: 10)
      runs = @mutex.synchronize { @closed = true; @runs.values.dup }
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
      runs.each { |run| run.join([deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC), 0].max) }
      runs.each(&:stop)
      @telemetry.close
    end

    private

    def dispatch(method, path, env)
      return [204, nil] if method == 'OPTIONS'
      if path == '/info'
        raise Error.new(405, 'Method not allowed') unless method == 'GET'
        return [200, info]
      end
      user = @identify_user.call(env)
      raise Error.new(401, 'Authenticated application user is required') unless user.is_a?(Hash) && user['id'].is_a?(String) && !user['id'].strip.empty?
      query = URI.decode_www_form(env.fetch('QUERY_STRING', '')).to_h
      raw = env['rack.input']&.read(1_048_577).to_s
      raise Error.new(413, 'Request body too large') if raw.bytesize > 1_048_576
      body = raw.empty? ? {} : JSON.parse(raw)
      raise Error.new(400, 'JSON object is required') unless body.is_a?(Hash)
      if (match = %r{\A/agent/([^/]+)/(run|connect)\z}.match(path))
        raise Error.new(405, 'Method not allowed') unless method == 'POST'
        agent_id, action = match.captures
        @telemetry.emit('oss.runtime.copilot_request_created', 'requestType' => action)
        raise Error.new(404, 'Agent not found') unless @agents.key?(agent_id)
        identifier!(body['threadId'])
        return connect(body['threadId'], user, agent_id) if action == 'connect'
        return run(body, user, agent_id)
      end
      return threads(method, path, query, body, user) if path.start_with?('/threads')
      return memories(method, path, query, body, user, env) if path.start_with?('/memories')
      if path == '/annotate' && method == 'POST'
        %w[type threadId].each { |field| identifier!(body[field]) }
        id = body['clientEventId'] || SecureRandom.uuid
        identifier!(id)
        payload = body.select { |key, _| %w[type threadId payload occurredAt].include?(key) }.merge('userId' => user['id'])
        result = @platform.request('PUT', "/connector/annotate/#{escaped(id)}", payload)
        raise Error.new(502, 'Empty annotation response') unless result.is_a?(Hash)
        return [200, result]
      end
      raise Error.new(404, 'Route not found')
    end

    def identifier!(value)
      raise Error.new(400, 'Valid identifier is required') unless value.is_a?(String) && !value.strip.empty? && value.length <= 512
    end

    def report_error(error)
      @on_error&.call(error)
    rescue StandardError
      nil
    end

    def escaped(value)
      URI.encode_www_form_component(value).gsub('+', '%20')
    end

    def info
      entitlement = begin
        @platform.request('GET', '/api/entitlements/runtime')
      rescue Error
        { 'status' => 'unavailable', 'error' => { 'code' => 'runtime_entitlements_unavailable', 'message' => 'Runtime entitlement lookup failed', 'retryable' => true } }
      end
      result = { 'version' => '0.1.0', 'mode' => 'intelligence', 'agents' => @agents.to_h { |id, agent| [id, { 'name' => id, 'description' => agent.description, 'className' => agent.class.name }] },
        'intelligence' => { 'wsUrl' => @client_url }, 'runtimeEntitlements' => entitlement,
        'licenseStatus' => entitlement.dig('entitlement', 'active') ? 'valid' : 'none',
        'threadEndpoints' => { 'list' => true, 'inspect' => true, 'mutations' => true, 'realtimeMetadata' => true },
        'audioFileTranscriptionEnabled' => false, 'a2uiEnabled' => !!@a2ui && @a2ui['enabled'] != false, 'openGenerativeUIEnabled' => false,
        'suggestions' => false, 'telemetryDisabled' => @telemetry.disabled? }
      result['a2ui'] = { 'enabled' => true }.merge(@a2ui.slice('agents')) if result['a2uiEnabled']
      result
    end

    def credentials(result)
      result.slice('threadId', 'runId', 'joinToken').merge('realtime' => { 'clientUrl' => @client_url, 'topic' => "thread:#{result['threadId']}" })
    end

    def connect(thread_id, user, agent_id)
      result = @platform.request('POST', "/api/threads/#{escaped(thread_id)}/connect", 'userId' => user['id'], 'agentId' => agent_id)
      [result ? 200 : 204, result && credentials(result).reject { |key, _| key == 'runId' }]
    end

    def threads(method, path, query, body, user)
      if path == '/threads' && method == 'GET'
        identifier!(query['agentId'])
        params = query.slice('agentId', 'includeArchived', 'limit', 'cursor').merge('userId' => user['id'])
        return [200, @platform.request('GET', '/api/threads?' + URI.encode_www_form(params))]
      end
      if path == '/threads/subscribe' && method == 'POST'
        return [200, @platform.request('POST', '/api/threads/subscribe', 'userId' => user['id'])]
      end
      match = %r{\A/threads/([^/]+)(?:/(messages|events|state|archive))?\z}.match(path)
      raise Error.new(404, 'Route not found') unless match
      id, action = match.captures
      base = "/api/threads/#{id}"
      scope = '?userId=' + escaped(user['id'])
      if method == 'GET' && %w[messages events state].include?(action)
        @platform.request('GET', base + scope) unless action == 'messages'
        target = action == 'messages' ? base + '/messages' + scope : "/api/_inspect/threads/#{id}/#{action}"
        return [200, @platform.request('GET', target)]
      end
      identifier!(body['agentId'])
      updates = body.reject { |key, _| %w[userId organizationId projectId].include?(key) }.merge('userId' => user['id'])
      if action == 'archive' && method == 'POST'
        @platform.request('PATCH', base, updates.merge('archived' => true))
        return [200, { 'threadId' => URI.decode_www_form_component(id), 'archived' => true }]
      end
      if action.nil? && method == 'PATCH'
        return [200, @platform.request('PATCH', base, updates).fetch('thread')]
      end
      if action.nil? && method == 'DELETE'
        @platform.request('DELETE', base, updates.slice('userId', 'agentId'))
        return [200, { 'threadId' => URI.decode_www_form_component(id), 'deleted' => true }]
      end
      raise Error.new(405, 'Method not allowed')
    end

    def memories(method, path, query, body, user, env)
      raise Error.new(404, 'Route not found') unless path.match?(%r{\A/memories(?:/[^/]+)?\z})
      grant = @memory_access.call(user, env)
      raise Error.new(403, 'Invalid memory grant') unless grant.is_a?(Hash) && grant.keys.sort == %w[project user] && grant.values.all? { |value| %w[none read read-write].include?(value) }
      raise Error.new(403, 'Memory access is not granted') unless grant.is_a?(Hash) && grant.values.any? { |value| %w[read read-write].include?(value) }
      raise Error.new(403, 'Memory write access is not granted') if %w[POST PATCH DELETE].include?(method) && !%w[/memories/subscribe /memories/recall].include?(path) && !grant.values.include?('read-write')
      if path == '/memories' && method == 'POST'
        raise Error.new(403, 'Memory scope is not writable') unless grant[body.fetch('scope', 'user')] == 'read-write'
      end
      headers = { 'x-cpki-user-id' => user['id'], 'x-cpki-memory-grant' => JSON.generate(grant) }
      payload = body.slice('content', 'kind', 'scope', 'sourceThreadIds', 'query', 'limit')
      if path == '/memories/recall'
        raise Error.new(400, 'Recall query is required') unless payload['query'].is_a?(String) && !payload['query'].strip.empty?
        payload['query'] = payload['query'].strip
        raise Error.new(400, 'Positive integer limit is required') if payload.key?('limit') && (!payload['limit'].is_a?(Integer) || payload['limit'] <= 0)
      elsif %w[POST PATCH].include?(method) && path != '/memories/subscribe'
        raise Error.new(400, 'Memory content and kind are required') unless payload['content'].is_a?(String) && %w[topical episodic operational].include?(payload['kind'])
      end
      raise Error.new(400, 'Invalid memory scope') if payload.key?('scope') && !%w[user project].include?(payload['scope'])
      if payload.key?('sourceThreadIds') && (!payload['sourceThreadIds'].is_a?(Array) || !payload['sourceThreadIds'].all? { |id| id.is_a?(String) })
        raise Error.new(400, 'Invalid sourceThreadIds')
      end
      target = '/api' + path
      target += '?' + URI.encode_www_form(query.slice('scope', 'kind', 'limit', 'cursor')) if method == 'GET' && !query.empty?
      result = @platform.request(method, target, method == 'GET' || method == 'DELETE' || path == '/memories/subscribe' ? nil : payload, headers)
      [method == 'DELETE' ? 204 : (method == 'POST' && path == '/memories' ? 201 : 200), result]
    rescue Error => error
      raise Error.new(error.status >= 500 ? 502 : error.status, error.message)
    end

    def run(input, user, agent_id)
      identifier!(input['runId'])
      raise Error.new(400, 'messages must be an array') unless input['messages'].is_a?(Array)
      raise Error.new(503, 'Runtime is shutting down') if @closed
      thread_id = input['threadId']
      creation = { 'threadId' => thread_id, 'userId' => user['id'], 'agentId' => agent_id }
      container = @learning_container&.call(user, input)
      creation['learningContainerId'] = container if container
      begin
        @platform.request('GET', "/api/threads/#{escaped(thread_id)}?userId=#{escaped(user['id'])}")
      rescue Error => error
        raise unless error.status == 404
        begin
          @platform.request('POST', '/api/threads', creation)
        rescue Error => race
          raise unless race.status == 409
          @platform.request('GET', "/api/threads/#{escaped(thread_id)}?userId=#{escaped(user['id'])}")
        end
      end
      lock = @platform.request('POST', "/api/threads/#{escaped(thread_id)}/lock", creation.reject { |key, _| key == 'threadId' }.merge('runId' => input['runId']))
      runner = nil
      begin
        %w[threadId runId joinToken].each { |field| raise Error.new(502, 'Invalid platform lock response') unless lock[field].is_a?(String) && !lock[field].empty? }
        canonical = input.merge('threadId' => lock['threadId'], 'runId' => lock['runId'])
        history = @platform.request('GET', "/api/threads/#{escaped(lock['threadId'])}/messages?userId=#{escaped(user['id'])}").fetch('messages')
        prior_ids = history.map { |message| message['id'] }
        fresh = input['messages'].reject { |message| prior_ids.include?(message['id']) }
        canonical['messages'] = history + fresh
        a2ui = @a2ui if @a2ui && @a2ui['enabled'] != false && (!@a2ui['agents'] || @a2ui['agents'].include?(agent_id))
        servers = @mcp_servers.select { |server| !server['agentId'] || server['agentId'] == agent_id }
        agent = UIAgent.new(agent: @agents.fetch(agent_id), a2ui: a2ui, mcp_servers: servers)
        runner = Runner.new(platform: @platform, url: @runner_url, auth_token: @api_key, lock: lock, agent: agent, input: canonical, messages: fresh, telemetry: @telemetry, on_error: @on_error)
        runner.join_gateway
        @mutex.synchronize do
          raise Error.new(503, 'Runtime is shutting down') if @closed
          @runs[lock['runId']] = runner
        end
        runner.start { @mutex.synchronize { @runs.delete(lock['runId']) } }
        [200, credentials(lock)]
      rescue StandardError
        runner&.stop
        @platform.request('DELETE', "/api/threads/#{escaped(lock['threadId'] || thread_id)}/lock", 'runId' => lock['runId'] || input['runId']) rescue nil
        raise
      end
    end
  end

  # Small injectable REST transport with timeouts and no secret-bearing error bodies.
  class Platform
    def initialize(url, key)
      @url, @key = url.sub(%r{/$}, ''), key
      raise ArgumentError, 'HTTP(S) URL is required' unless URI(@url).is_a?(URI::HTTP)
    end

    def request(method, path, payload = nil, headers = {})
      uri = URI(@url + path)
      request = Net::HTTPGenericRequest.new(method, !payload.nil?, true, uri.request_uri, { 'authorization' => "Bearer #{@key}", 'content-type' => 'application/json' }.merge(headers))
      request.body = JSON.generate(payload) unless payload.nil?
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 5, read_timeout: 15) { |http| http.request(request) }
      raise Error.new(response.code.to_i, 'Intelligence platform request failed') unless response.code.to_i.between?(200, 299)
      response.body.nil? || response.body.empty? ? nil : JSON.parse(response.body)
    rescue JSON::ParserError
      raise Error.new(502, 'Invalid platform response')
    rescue IOError, SystemCallError, Timeout::Error, SocketError
      raise Error.new(502, 'Intelligence platform is unreachable')
    end
  end

end

require_relative 'agent'
require_relative 'ui_agent'
require_relative 'runner'
