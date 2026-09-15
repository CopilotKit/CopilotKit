# frozen_string_literal: true
require 'json'
require 'net/http'
require 'uri'
require 'securerandom'
require 'thread'
require 'timeout'
require_relative 'inspector_metadata'
require_relative 'runtime_entitlements'

module CopilotKit
  # Safe platform error. Response bodies and credentials are not included.
  class Error < StandardError
    attr_reader :status
    def initialize(status, message)
      @status = status
      super(message)
    end
  end

  # Safe entitlement failure with platform status and retry guidance.
  class RuntimeEntitlementError < Error
    attr_reader :retryable
    def initialize(status, message, retryable)
      @retryable = retryable
      super(status, message)
    end
  end

  # Trusted per-call permissions for user and project memories.
  class MemoryGrant
    VALUES = { none: 'none', read: 'read', read_write: 'read-write' }.freeze
    attr_reader :user, :project

    def initialize(user:, project:)
      @user = VALUES.fetch(user, user)
      @project = VALUES.fetch(project, project)
      raise ArgumentError, 'Invalid memory grant' unless VALUES.value?(@user) && VALUES.value?(@project)
      freeze
    end

    def to_h
      { 'user' => user, 'project' => project }
    end
  end

  # Native HTTP transport. Each call closes its connection and never follows redirects.
  class Platform
    def initialize(url, key)
      @url, @key = url.sub(%r{/$}, ''), key
      uri = URI(@url)
      raise ArgumentError, 'HTTP(S) URL is required' unless uri.is_a?(URI::HTTP) && uri.host && !uri.userinfo && !uri.query && !uri.fragment
    end

    def request(method, path, payload = nil, headers = {})
      uri = URI(@url + path)
      request = Net::HTTPGenericRequest.new(method, !payload.nil?, true, uri.request_uri, headers.merge('authorization' => "Bearer #{@key}", 'content-type' => 'application/json'))
      request.body = JSON.generate(payload) unless payload.nil?
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 5, read_timeout: 15) do |http|
        http.max_retries = 0
        return inspector_response(http, request) if method == 'GET' && path == '/api/inspector/metadata'
        return entitlement_response(http, request) if method == 'GET' && path == '/api/entitlements/runtime'
        http.request(request)
      end
      raise Error.new(response.code.to_i, 'Intelligence platform request failed') unless response.code.to_i.between?(200, 299)
      response.body.nil? || response.body.empty? ? nil : JSON.parse(response.body)
    rescue JSON::ParserError
      if method == 'GET' && path == '/api/entitlements/runtime'
        raise RuntimeEntitlementError.new(502, 'Invalid Runtime entitlement response', false), cause: nil
      end
      raise Error.new(502, 'Invalid platform response')
    rescue IOError, SystemCallError, Timeout::Error, SocketError
      raise Error.new(502, 'Intelligence platform is unreachable')
    end

    # Skip absent/error bodies while the SDK bounds the full connection lifetime.
    def inspector_response(http, request)
      http.request(request) do |response|
        status = response.code.to_i
        return nil if [204, 404].include?(status)
        raise Error.new(status, 'Inspector metadata request failed') unless status.between?(200, 299)
        body = response.body
        raise Error.new(502, 'Invalid Inspector metadata response') if body.nil? || body.empty?
        return JSON.parse(body)
      end
    end
    private :inspector_response

    # Inspect rejected statuses before reading bodies that can stall or contain secrets.
    def entitlement_response(http, request)
      http.request(request) do |response|
        status = response.code.to_i
        unless status.between?(200, 299)
          raise RuntimeEntitlementError.new(status, 'Runtime entitlement request rejected', [408, 425, 429].include?(status) || status >= 500), cause: nil
        end
        body = response.body
        raise RuntimeEntitlementError.new(502, 'Invalid Runtime entitlement response', false), cause: nil if body.nil? || body.empty?
        return JSON.parse(body)
      end
    end
    private :entitlement_response
  end

  # Programmatic Intelligence SDK. Requiring this file does not load Runtime or Rack.
  class Intelligence
    API_URL = 'https://api.intelligence.copilotkit.ai'
    RUNNER_URL = 'wss://realtime.intelligence.copilotkit.ai/runner'
    CLIENT_URL = 'wss://realtime.intelligence.copilotkit.ai/client'
    attr_reader :api_key, :api_url, :runner_url, :client_url

    def initialize(api_key:, api_url: API_URL, runner_url: RUNNER_URL, client_url: CLIENT_URL, transport: nil)
      raise ArgumentError, 'api_key is required' unless api_key.is_a?(String) && !api_key.strip.empty?
      [[api_url, %w[http https]], [runner_url, %w[ws wss]], [client_url, %w[ws wss]]].each do |endpoint, schemes|
        uri = URI(endpoint)
        raise ArgumentError, 'Invalid Intelligence endpoint URL' unless schemes.include?(uri.scheme) && uri.host && !uri.userinfo && !uri.query && !uri.fragment
      end
      @api_key, @api_url = api_key.dup.freeze, api_url.sub(%r{/$}, '').freeze
      @runner_url, @client_url = runner_url.dup.freeze, client_url.dup.freeze
      @transport = transport || Platform.new(@api_url, api_key)
      @listeners = { created: [], updated: [], deleted: [] }
      @listener_mutex = Mutex.new
      @entitlement_mutex = Mutex.new
      @entitlement_cache = nil
    end

    # Shared SDK transport used by Runtime. Credentials always come from this client.
    def request(method, path, payload = nil, headers = {})
      result = @transport.request(method, path, payload, headers)
      notify_thread_mutation(method, path, payload, result)
      result
    end

    # Read sanitized project metadata within five seconds, including the response body.
    # @return [Hash, nil] Supported V1 fields, or nil for 204, 404, or an unsupported schema.
    def get_inspector_metadata
      Timeout.timeout(5) do
        InspectorMetadata.parse(request('GET', '/api/inspector/metadata'))
      end
    rescue Timeout::Error
      raise Timeout::Error, 'Inspector metadata request timed out', cause: nil
    rescue Error => error
      return nil if error.status == 404
      raise Error.new(error.status, 'Inspector metadata request failed'), cause: nil
    rescue StandardError
      raise Error.new(502, 'Inspector metadata request failed'), cause: nil
    end

    # @return [Hash] A normalized ready grant or structured non-ready result.
    def get_runtime_entitlements
      @entitlement_mutex.synchronize do
        unless @entitlement_cache && entitlement_now < @entitlement_cache.first
          begin
            value = fetch_runtime_entitlements
            active = value['status'] == 'ready' && value['entitlement']['active']
            @entitlement_cache = [entitlement_now + (active ? 30 : 5), value]
          rescue RuntimeEntitlementError => error
            @entitlement_cache = [entitlement_now + 5, error]
          end
        end
        value = @entitlement_cache.last
        if value.is_a?(RuntimeEntitlementError)
          raise RuntimeEntitlementError.new(value.status, value.message, value.retryable), cause: nil
        end
        RuntimeEntitlements.copy(value)
      end
    end

    # Bound the whole platform request and keep cached failures safe for every caller.
    def fetch_runtime_entitlements
      Timeout.timeout(1.5) do
        value = RuntimeEntitlements.parse(request('GET', '/api/entitlements/runtime'))
        raise RuntimeEntitlementError.new(502, 'Invalid Runtime entitlement response', false), cause: nil unless value
        value
      end
    rescue RuntimeEntitlementError => error
      raise RuntimeEntitlementError.new(error.status, 'Runtime entitlement request failed', error.retryable), cause: nil
    rescue Timeout::Error
      raise RuntimeEntitlementError.new(504, 'Runtime entitlement request timed out', true), cause: nil
    rescue Error => error
      raise RuntimeEntitlementError.new(error.status, 'Runtime entitlement request rejected', [408, 425, 429].include?(error.status) || error.status >= 500), cause: nil
    rescue StandardError
      raise RuntimeEntitlementError.new(502, 'Runtime entitlement connection failed', true), cause: nil
    end

    def entitlement_now
      Process.clock_gettime(Process::CLOCK_MONOTONIC)
    end
    private :fetch_runtime_entitlements, :entitlement_now

    # Register a creation listener; the returned Proc removes it.
    def on_thread_created(&callback)
      subscribe(:created, callback)
    end

    # Register a listener for thread updates and archives.
    def on_thread_updated(&callback)
      subscribe(:updated, callback)
    end

    # Register a listener with the deleted thread and explicit caller identity.
    def on_thread_deleted(&callback)
      subscribe(:deleted, callback)
    end

    # List a user's threads for one agent, retaining the platform pagination cursor.
    def list_threads(user_id:, agent_id:, include_archived: false, limit: nil, cursor: nil)
      query = { userId: user_id, agentId: agent_id, limit: limit, cursor: cursor }.compact
      query[:includeArchived] = 'true' if include_archived
      object('GET', '/api/threads?' + URI.encode_www_form(query))
    end

    def get_thread(thread_id:, user_id:)
      thread('GET', '/api/threads/' + segment(thread_id) + '?' + URI.encode_www_form(userId: user_id))
    end

    # Assign a new thread to an existing Learning Container through its stable ID.
    def create_thread(thread_id:, user_id:, agent_id:, name: nil, learning_container_id: nil)
      body = { 'threadId' => thread_id, 'userId' => user_id, 'agentId' => agent_id }
      body['name'] = name unless name.nil?
      body['learningContainerId'] = learning_container_id unless learning_container_id.nil?
      thread('POST', '/api/threads', body)
    end

    # Resolve concurrent creation only after a 404 read followed by a 409 create.
    def get_or_create_thread(thread_id:, user_id:, agent_id:, name: nil, learning_container_id: nil)
      begin
        return { 'thread' => get_thread(thread_id: thread_id, user_id: user_id), 'created' => false }
      rescue Error => error
        raise unless error.status == 404
      end
      begin
        value = create_thread(thread_id: thread_id, user_id: user_id, agent_id: agent_id, name: name, learning_container_id: learning_container_id)
        { 'thread' => value, 'created' => true }
      rescue Error => error
        raise unless error.status == 409
        { 'thread' => get_thread(thread_id: thread_id, user_id: user_id), 'created' => false }
      end
    end

    def update_thread(thread_id:, user_id:, agent_id:, updates:)
      body = updates.transform_keys(&:to_s).merge('userId' => user_id, 'agentId' => agent_id)
      thread('PATCH', '/api/threads/' + segment(thread_id), body)
    end

    def archive_thread(thread_id:, user_id:, agent_id:)
      update_thread(thread_id: thread_id, user_id: user_id, agent_id: agent_id, updates: { archived: true })
      nil
    end

    # Permanently delete a thread and its history.
    def delete_thread(thread_id:, user_id:, agent_id:)
      request('DELETE', '/api/threads/' + segment(thread_id), {
        'userId' => user_id, 'agentId' => agent_id,
        'reason' => "Deleted via CopilotKit SDK (userId=#{user_id}, agentId=#{agent_id})"
      })
      nil
    end

    def get_thread_messages(thread_id:, user_id:)
      object('GET', '/api/threads/' + segment(thread_id) + '/messages?' + URI.encode_www_form(userId: user_id))
    end

    def get_thread_events(thread_id:)
      object('GET', '/api/_inspect/threads/' + segment(thread_id) + '/events')
    end

    def get_thread_state(thread_id:)
      object('GET', '/api/_inspect/threads/' + segment(thread_id) + '/state')
    end

    def list_memories(user_id:, include_invalidated: false, memory_grant: nil)
      path = '/api/memories' + (include_invalidated ? '?includeInvalidated=true' : '')
      object('GET', path, nil, memory_headers(user_id, memory_grant))
    end

    def create_memory(user_id:, content:, kind:, scope: nil, source_thread_ids: [], memory_grant: nil)
      body = { 'content' => content, 'kind' => kind, 'sourceThreadIds' => source_thread_ids }
      body['scope'] = scope unless scope.nil?
      object('POST', '/api/memories', body, memory_headers(user_id, memory_grant))
    end

    # Supersede a memory and retain the platform's retiredId marker.
    def update_memory(user_id:, memory_id:, content:, kind:, scope: nil, source_thread_ids: [], memory_grant: nil)
      body = { 'content' => content, 'kind' => kind, 'sourceThreadIds' => source_thread_ids }
      body['scope'] = scope unless scope.nil?
      object('PATCH', '/api/memories/' + segment(memory_id), body, memory_headers(user_id, memory_grant))
    end

    # Retire a memory without deleting its history.
    def remove_memory(user_id:, memory_id:, memory_grant: nil)
      request('DELETE', '/api/memories/' + segment(memory_id), nil, memory_headers(user_id, memory_grant))
      nil
    end

    def recall_memories(user_id:, query:, limit: nil, scope: nil, memory_grant: nil)
      body = { 'query' => query, 'limit' => limit, 'scope' => scope }.compact
      object('POST', '/api/memories/recall', body, memory_headers(user_id, memory_grant))
    end

    # Reuse client_event_id when retrying the same annotation.
    def annotate(user_id:, thread_id:, type:, client_event_id: nil, payload: nil, occurred_at: nil)
      body = { 'userId' => user_id, 'threadId' => thread_id, 'type' => type }
      body['payload'] = payload unless payload.nil?
      body['occurredAt'] = occurred_at unless occurred_at.nil?
      object('PUT', '/connector/annotate/' + segment(client_event_id || SecureRandom.uuid), body)
    end

    private

    # Synchronize registration without holding the mutex during application callbacks.
    def subscribe(event, callback)
      raise ArgumentError, 'A thread listener block is required' unless callback
      @listener_mutex.synchronize do
        @listeners[event] << callback unless @listeners[event].any? { |listener| listener.equal?(callback) }
      end
      -> { @listener_mutex.synchronize { @listeners[event].delete_if { |listener| listener.equal?(callback) } }; nil }
    end

    # Observe SDK and Runtime writes once; locks and subscriptions are not thread mutations.
    def notify_thread_mutation(method, path, body, result)
      target = %r{\A/api/threads/([^/?]+)\z}.match(path)
      event = payload = nil
      if (method == 'POST' && path == '/api/threads') || (method == 'PATCH' && target)
        thread = result['thread'] if result.is_a?(Hash)
        if thread.is_a?(Hash) && thread['id'].is_a?(String) && !thread['id'].strip.empty?
          event = method == 'POST' ? :created : :updated
          payload = thread
        end
      elsif method == 'DELETE' && target && body.is_a?(Hash) && body['userId'].is_a?(String) && body['agentId'].is_a?(String)
        event = :deleted
        payload = { 'threadId' => URI.decode_www_form_component(target[1]), 'userId' => body['userId'], 'agentId' => body['agentId'] }
      end
      return unless event
      listeners = @listener_mutex.synchronize { @listeners[event].dup }
      listeners.each do |callback|
        begin
          callback.call(payload)
        rescue StandardError => error
          warn "Intelligence thread #{event} listener failed (#{error.class})"
        end
      end
    end

    def segment(value)
      raise ArgumentError, 'A nonempty identifier is required' unless value.is_a?(String) && !value.strip.empty?
      URI.encode_www_form_component(value).gsub('+', '%20')
    end

    def object(method, path, payload = nil, headers = {})
      value = request(method, path, payload, headers)
      raise Error.new(502, 'Invalid Intelligence response') unless value.is_a?(Hash)
      value
    end

    def thread(method, path, payload = nil)
      value = object(method, path, payload)['thread']
      raise Error.new(502, 'Invalid thread response') unless value.is_a?(Hash) && value['id'].is_a?(String) && !value['id'].strip.empty?
      value
    end

    def memory_headers(user_id, grant)
      segment(user_id)
      headers = { 'x-cpki-user-id' => user_id }
      unless grant.nil?
        raise ArgumentError, 'memory_grant must be a MemoryGrant' unless grant.is_a?(MemoryGrant)
        headers['x-cpki-memory-grant'] = JSON.generate(grant.to_h)
      end
      headers
    end
  end
end
