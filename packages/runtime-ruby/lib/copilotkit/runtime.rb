# frozen_string_literal: true
require 'json'
require 'net/http'
require 'uri'
require 'securerandom'
require 'thread'
require_relative 'telemetry'
require_relative 'intelligence'

module CopilotKit
  # Rack endpoint. Mount directly in Rails routes with `mount runtime => '/copilotkit'`.
  class Runtime
    attr_reader :intelligence

    def initialize(api_key: nil, identify_user:, intelligence: nil, api_url: nil,
                   runner_url: nil, client_url: nil, agents: {},
                   base_path: '', memory_access: nil, telemetry: nil, cors_origins: [],
                   learning_container: nil, a2ui: nil, mcp_apps: nil, on_error: nil,
                   lock_heartbeat_interval: 15, lock_ttl: 20, license_token: nil)
      api_key ||= intelligence&.api_key
      api_url ||= intelligence&.api_url || Intelligence::API_URL
      runner_url ||= intelligence&.runner_url || Intelligence::RUNNER_URL
      client_url ||= intelligence&.client_url || Intelligence::CLIENT_URL
      if intelligence && [api_key, api_url.sub(%r{/$}, ''), runner_url, client_url] != [intelligence.api_key, intelligence.api_url, intelligence.runner_url, intelligence.client_url]
        raise ArgumentError, 'Runtime transport configuration must match intelligence'
      end
      raise ArgumentError, 'api_key is required' if api_key.to_s.strip.empty?
      raise ArgumentError, 'identify_user must be callable' unless identify_user.respond_to?(:call)
      @intelligence = intelligence || Intelligence.new(api_key: api_key, api_url: api_url, runner_url: runner_url, client_url: client_url)
      @platform = @intelligence
      @api_key = api_key
      @identify_user, @agents, @base_path = identify_user, agents, base_path.sub(%r{/$}, '')
      @a2ui = a2ui == true ? {} : a2ui
      @mcp_servers = (mcp_apps || {}).fetch('servers', [])
      @runner_url, @client_url = runner_url, client_url
      @memory_access = memory_access
      @telemetry = telemetry || Telemetry.new(license_token: license_token)
      @on_error = on_error
      raise ArgumentError, 'Lock heartbeat must be positive and shorter than TTL' unless lock_heartbeat_interval.is_a?(Numeric) && lock_ttl.is_a?(Numeric) && lock_heartbeat_interval.positive? && lock_ttl > lock_heartbeat_interval
      @lock_heartbeat_interval, @lock_ttl = lock_heartbeat_interval, lock_ttl
      @cors_origins, @learning_container = cors_origins.freeze, learning_container
      @runs, @mutex, @closed = {}, Mutex.new, false
      @startups = {}
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
        if path == '/inspector-metadata'
          response[1]['cache-control'] = 'no-store, private'
          response[1]['allow'] = 'GET' if response[0] == 405
        end
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
      runs, startups = @mutex.synchronize { @closed = true; [@runs.values.dup, @startups.values.dup] }
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
      startups.each(&:kill)
      runs.each(&:request_stop)
      startups.each { |thread| thread.join([deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC), 0].max) }
      runs.each { |run| run.join([deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC), 0].max) }
      runs.each { |run| run.stop(timeout: 0) }
      @telemetry.close(timeout: [deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC), 0].max)
    end

    private

    def dispatch(method, path, env)
      return [204, nil] if method == 'OPTIONS'
      if path == '/info'
        raise Error.new(405, 'Method not allowed') unless method == 'GET'
        return [200, info]
      end
      if path == '/inspector-metadata'
        raise Error.new(405, 'Method not allowed') unless method == 'GET'
        return inspector_metadata
      end
      user = normalize_callback_keys(@identify_user.call(env), %w[id name])
      raise Error.new(401, 'Authenticated application user is required') unless user.is_a?(Hash) && user['id'].is_a?(String) && !user['id'].strip.empty?
      query = URI.decode_www_form(env.fetch('QUERY_STRING', '')).to_h
      raw = env['rack.input']&.read(1_048_577).to_s
      raise Error.new(413, 'Request body too large') if raw.bytesize > 1_048_576
      body = raw.empty? ? {} : JSON.parse(raw)
      raise Error.new(400, 'JSON object is required') unless body.is_a?(Hash)
      if (match = %r{\A/agent/([^/]+)/stop/([^/]+)\z}.match(path))
        raise Error.new(405, 'Method not allowed') unless method == 'POST'
        return stop_run(match[1], match[2], body, user)
      end
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

    # Normalize only documented callback keys. Explicit string values win,
    # including nil and false, so aliases cannot bypass value validation.
    def normalize_callback_keys(value, keys)
      return value unless value.is_a?(Hash)
      result = value.dup
      keys.each do |key|
        symbol = key.to_sym
        result[key] = value[symbol] if !value.key?(key) && value.key?(symbol)
        result.delete(symbol)
      end
      result
    end

    def stop_run(agent_id, requested_thread, body, user)
      identifier!(body['runId']) if body.key?('runId')
      begin
        thread = @platform.request('GET', "/api/threads/#{requested_thread}?userId=#{escaped(user['id'])}").fetch('thread')
      rescue Error => error
        raise Error.new(error.status >= 500 ? 502 : error.status, 'Thread access denied')
      end
      raise Error.new(502, 'Invalid thread response') unless thread.is_a?(Hash) && thread['id'].is_a?(String) && !thread['id'].strip.empty?
      raise Error.new(403, 'Thread access denied') if thread.key?('agentId') && thread['agentId'] != agent_id
      raise Error.new(404, 'Agent not found') unless @agents.key?(agent_id)
      active = @mutex.synchronize { @runs.values.find { |run| run.thread_id == thread['id'] && (!body['runId'] || run.run_id == body['runId']) } }
      stopped = active ? active.request_stop : false
      result = { 'stopped' => stopped }
      result['interrupt'] = { 'type' => 'RUN_ERROR', 'message' => 'Run stopped by user', 'code' => 'STOPPED' } if stopped
      [200, result]
    end

    def report_error(error)
      @on_error&.call(error)
    rescue StandardError
      nil
    end

    def escaped(value)
      URI.encode_www_form_component(value).gsub('+', '%20')
    end

    # Return project display data without forwarding browser credentials or provider failures.
    def inspector_metadata
      metadata = InspectorMetadata.parse(@intelligence.get_inspector_metadata)
      metadata ? [200, metadata] : [204, nil]
    rescue StandardError => error
      report_error(error)
      [204, nil]
    end

    def info
      entitlement = begin
        @intelligence.get_runtime_entitlements
      rescue StandardError => error
        retryable = !error.is_a?(RuntimeEntitlementError) || error.retryable
        { 'status' => retryable ? 'unavailable' : 'misconfigured', 'error' => {
          'code' => retryable ? 'runtime_entitlements_unavailable' : 'runtime_entitlements_misconfigured',
          'message' => retryable ? 'Runtime entitlement lookup failed' : 'Runtime entitlement lookup is misconfigured',
          'retryable' => retryable } }
      end
      license_status = if entitlement['status'] == 'ready'
        entitlement['entitlement']['active'] ? 'valid' : 'none'
      else
        entitlement['error']['retryable'] ? 'unknown' : 'none'
      end
      result = { 'version' => '0.1.0', 'mode' => 'intelligence', 'agents' => @agents.to_h { |id, agent| [id, { 'name' => id, 'description' => agent.description, 'className' => agent.class.name }] },
        'intelligence' => { 'wsUrl' => @client_url }, 'runtimeEntitlements' => entitlement,
        'licenseStatus' => license_status,
        'threadEndpoints' => { 'list' => true, 'inspect' => true, 'mutations' => true, 'realtimeMetadata' => true },
        'audioFileTranscriptionEnabled' => false, 'a2uiEnabled' => !!@a2ui && @a2ui['enabled'] != false, 'openGenerativeUIEnabled' => false,
        'suggestions' => false, 'telemetryDisabled' => @telemetry.disabled? }
      result['a2ui'] = { 'enabled' => true }.merge(@a2ui.slice('agents')) if result['a2uiEnabled']
      result['inspectorMetadata'] = true
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
      updates = body.slice('agentId', 'name', 'archived', 'reason').merge('userId' => user['id'])
      if action == 'archive' && method == 'POST'
        @platform.request('PATCH', base, updates.merge('archived' => true))
        return [200, { 'threadId' => URI.decode_www_form_component(id), 'archived' => true }]
      end
      if action.nil? && method == 'PATCH'
        return [200, @platform.request('PATCH', base, updates).fetch('thread')]
      end
      if action.nil? && method == 'DELETE'
        @platform.request('DELETE', base, updates.slice('userId', 'agentId').merge('reason' => 'Deleted via CopilotKit runtime'))
        return [200, { 'threadId' => URI.decode_www_form_component(id), 'deleted' => true }]
      end
      raise Error.new(405, 'Method not allowed')
    end

    def memories(method, path, query, body, user, env)
      raise Error.new(405, 'Method not allowed') unless %w[GET POST PATCH DELETE].include?(method)
      raise Error.new(404, 'Route not found') unless path.match?(%r{\A/memories(?:/[^/]+)?\z})
      headers = { 'x-cpki-user-id' => user['id'] }
      unless @memory_access.nil?
        begin
          grant = normalize_callback_keys(@memory_access.call(user, env), %w[user project])
        rescue StandardError
          raise Error.new(500, 'Memory policy failed')
        end
        raise Error.new(403, 'Memory access is not granted') if grant.nil?
        raise Error.new(500, 'Invalid memory grant') unless grant.is_a?(Hash) && grant.length == 2 && grant.key?('user') && grant.key?('project') && grant.values.all? { |value| %w[none read read-write].include?(value) }
        raise Error.new(403, 'Memory access is not granted') unless grant.values.any? { |value| %w[read read-write].include?(value) }
        raise Error.new(403, 'Memory write access is not granted') if %w[POST PATCH DELETE].include?(method) && !%w[/memories/subscribe /memories/recall].include?(path) && !grant.values.include?('read-write')
        if path == '/memories' && method == 'POST'
          raise Error.new(403, 'Memory scope is not writable') unless grant[body.fetch('scope', 'user')] == 'read-write'
        end
        headers['x-cpki-memory-grant'] = JSON.generate(grant)
      end
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
      begin
        result = @platform.request(method, target, method == 'GET' || method == 'DELETE' || path == '/memories/subscribe' ? nil : payload, headers)
      rescue Error => error
        raise Error.new(error.status >= 500 ? 502 : error.status, error.message)
      end
      [method == 'DELETE' ? 204 : (method == 'POST' && path == '/memories' ? 201 : 200), result]
    end

    def run(input, user, agent_id)
      token = Object.new
      worker = @mutex.synchronize do
        raise Error.new(503, 'Runtime is shutting down') if @closed
        @startups[token] = Thread.new do
          begin
            perform_run(input, user, agent_id)
          ensure
            @mutex.synchronize { @startups.delete(token) }
          end
        end
      end
      worker.report_on_exception = false
      worker.value || raise(Error.new(503, 'Runtime is shutting down'))
    end

    def perform_run(input, user, agent_id)
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
      runner, lock, started, lock_rejected = nil, nil, false, false
      begin
        begin
          lock = @platform.request('POST', "/api/threads/#{escaped(thread_id)}/lock", creation.reject { |key, _| key == 'threadId' }.merge('runId' => input['runId'], 'ttlSeconds' => @lock_ttl))
        rescue Error => error
          lock_rejected = error.status.between?(400, 499)
          raise
        end
        %w[threadId runId joinToken].each { |field| raise Error.new(502, 'Invalid platform lock response') unless lock[field].is_a?(String) && !lock[field].empty? }
        canonical = input.merge('threadId' => lock['threadId'], 'runId' => lock['runId'])
        a2ui = @a2ui if @a2ui && @a2ui['enabled'] != false && (!@a2ui['agents'] || @a2ui['agents'].include?(agent_id))
        servers = @mcp_servers.select { |server| !server['agentId'] || server['agentId'] == agent_id }
        agent = UIAgent.new(agent: @agents.fetch(agent_id), a2ui: a2ui, mcp_servers: servers)
        runner = Runner.new(platform: @platform, url: @runner_url, auth_token: @api_key, lock: lock, agent: agent, input: canonical, messages: [], telemetry: @telemetry, on_error: @on_error, heartbeat_interval: @lock_heartbeat_interval, lock_ttl: @lock_ttl)
        runner.start_lease
        history = @platform.request('GET', "/api/threads/#{escaped(lock['threadId'])}/messages?userId=#{escaped(user['id'])}").fetch('messages')
        prior_ids = history.map { |message| message['id'] }
        fresh = input['messages'].reject { |message| prior_ids.include?(message['id']) }
        # Stored messages are projection DTOs, not AG-UI model input. Use their
        # IDs only to avoid persisting messages twice; preserve the client input.
        runner.prepare_input(canonical, fresh)
        runner.join_gateway
        @mutex.synchronize do
          raise Error.new(503, 'Runtime is shutting down') if @closed
          @runs[lock['runId']] = runner
          runner.start { @mutex.synchronize { @runs.delete(lock['runId']) } }
          started = true
        end
        [200, credentials(lock)]
      ensure
        unless started || lock_rejected
          runner&.stop
          begin
            Timeout.timeout(3) { @platform.request('DELETE', "/api/threads/#{escaped(lock&.dig('threadId') || thread_id)}/lock", 'runId' => lock&.dig('runId') || input['runId']) }
          rescue StandardError => error
            report_error(error)
          end
        end
      end
    end
  end

end

require_relative 'agent'
require_relative 'ui_agent'
require_relative 'runner'
