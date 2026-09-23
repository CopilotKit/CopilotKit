# frozen_string_literal: true
require 'minitest/autorun'
require 'copilotkit/runtime'
require 'webrick'

class UITest < Minitest::Test
  class ScriptAgent < CopilotKit::Agent
    attr_reader :input
    def initialize(events)
      super()
      @events = events
    end
    def each_event(input)
      @input = input
      @events.each { |event| yield event }
    end
  end

  def input
    { 'threadId' => 't', 'runId' => 'r', 'messages' => [], 'tools' => [], 'context' => [], 'forwardedProps' => {} }
  end

  def test_a2ui_injects_schema_tool_and_action_history
    agent = ScriptAgent.new([])
    schema = { 'components' => { 'Text' => { 'required' => ['text'] } } }
    run_input = input
    run_input['forwardedProps']['a2uiAction'] = { 'userAction' => { 'name' => 'save', 'surfaceId' => 's' } }
    CopilotKit::UIAgent.new(agent: agent, a2ui: { 'injectA2UITool' => true, 'schema' => schema }).each_event(run_input) { |_| }
    assert_equal 'render_a2ui', agent.input['tools'].first&.fetch('name')
    assert_equal 'log_a2ui_event', agent.input['messages'].first.dig('toolCalls', 0, 'function', 'name')
    assert_equal 2, agent.input['messages'].size
    assert agent.input['context'].any? { |entry| entry['value'] == JSON.generate(schema) }
    assert_empty run_input['messages']
  end

  def test_a2ui_stream_is_atomic_and_grows_data_before_terminal
    prefix = '{"surfaceId":"s","components":[{"id":"root","component":"List","children":{"componentId":"item","path":"/items"}},{"id":"item","component":"Text","text":{"path":"name"}}]'
    events = [
      { 'type' => 'TOOL_CALL_START', 'toolCallId' => 'call', 'toolCallName' => 'render_a2ui' },
      { 'type' => 'TOOL_CALL_ARGS', 'toolCallId' => 'call', 'delta' => prefix },
      { 'type' => 'TOOL_CALL_ARGS', 'toolCallId' => 'call', 'delta' => ',"data":{"items":[{"name":"one"}' },
      { 'type' => 'TOOL_CALL_ARGS', 'toolCallId' => 'call', 'delta' => ',{"name":"two"}]}}' },
      { 'type' => 'RUN_FINISHED' }
    ]
    output = []
    CopilotKit::UIAgent.new(agent: ScriptAgent.new(events), a2ui: { 'defaultCatalogId' => 'app' }).each_event(input) { |event| output << event }
    snapshots = output.select { |event| event['type'] == 'ACTIVITY_SNAPSHOT' }
    assert_equal ['a2ui-surface-call'], snapshots.map { |event| event['messageId'] }.uniq
    painted = snapshots.filter_map { |event| event.dig('content', 'a2ui_operations') }
    assert painted.all? { |ops| ops.any? { |op| op['updateComponents'] } }
    data = painted.filter_map { |ops| ops.find { |op| op['updateDataModel'] }&.dig('updateDataModel', 'value', 'items') }
    assert_equal [1, 2], data.map(&:size)
    assert_equal 'TOOL_CALL_RESULT', output[-2]['type']
    assert_equal 'RUN_FINISHED', output[-1]['type']
  end

  def test_a2ui_invalid_components_never_paint
    events = [
      { 'type' => 'TOOL_CALL_START', 'toolCallId' => 'bad', 'toolCallName' => 'render_a2ui' },
      { 'type' => 'TOOL_CALL_ARGS', 'toolCallId' => 'bad', 'delta' => JSON.generate('surfaceId' => 's', 'components' => [{ 'id' => 'root', 'component' => 'Text', 'child' => 'root' }]) },
      { 'type' => 'RUN_FINISHED' }
    ]
    output = []
    CopilotKit::UIAgent.new(agent: ScriptAgent.new(events), a2ui: {}).each_event(input) { |event| output << event }
    refute output.any? { |event| event.dig('content', 'a2ui_operations') if event['content'].is_a?(Hash) }
    assert output.any? { |event| event.dig('content', 'status') == 'retrying' if event['content'].is_a?(Hash) }
  end

  def test_mcp_proxy_unknown_server_never_invokes_agent
    agent = ScriptAgent.new([])
    run_input = input
    run_input['forwardedProps']['__proxiedMCPRequest'] = { 'serverId' => 'unknown', 'method' => 'resources/read', 'params' => { 'uri' => 'ui://app' } }
    output = []
    CopilotKit::UIAgent.new(agent: agent).each_event(run_input) { |event| output << event }
    assert_nil agent.input
    assert output.last.dig('result', 'error')
  end

  def test_mcp_http_session_discovers_executes_and_emits_activity
    calls = []
    server = WEBrick::HTTPServer.new(Port: 0, BindAddress: '127.0.0.1', Logger: WEBrick::Log.new(File::NULL), AccessLog: [])
    server.mount_proc('/mcp') do |request, response|
      response['content-type'] = 'application/json'
      rpc = JSON.parse(request.body || '{}')
      calls << { 'rpc' => rpc, 'auth' => request['authorization'], 'session' => request['mcp-session-id'] }
      if rpc['method'] == 'initialize'
        response['mcp-session-id'] = 'session'
        result = { 'protocolVersion' => '2025-03-26', 'capabilities' => {} }
      elsif rpc['method'] == 'notifications/initialized'
        response.status = 202
        next
      elsif rpc['method'] == 'tools/list'
        result = { 'tools' => [{ 'name' => 'dashboard', 'inputSchema' => { 'type' => 'object' }, '_meta' => { 'ui/resourceUri' => 'ui://dashboard' } }] }
      elsif rpc['method'] == 'tools/call'
        result = { 'content' => [{ 'type' => 'text', 'text' => 'done' }] }
      else
        response.status = 400
        next
      end
      response.body = JSON.generate('jsonrpc' => '2.0', 'id' => rpc['id'], 'result' => result)
    end
    thread = Thread.new { server.start }
    begin
      script = ScriptAgent.new([
        { 'type' => 'TOOL_CALL_START', 'toolCallId' => 'ui', 'toolCallName' => 'dashboard' },
        { 'type' => 'TOOL_CALL_ARGS', 'toolCallId' => 'ui', 'delta' => '{"count":2}' },
        { 'type' => 'TOOL_CALL_END', 'toolCallId' => 'ui' }, { 'type' => 'RUN_FINISHED' }
      ])
      output = []
      config = { 'type' => 'http', 'serverId' => 'dash', 'url' => "http://127.0.0.1:#{server.listeners.first.addr[1]}/mcp", 'headers' => { 'authorization' => 'Bearer server-secret' } }
      CopilotKit::UIAgent.new(agent: script, mcp_servers: [config]).each_event(input) { |event| output << event }
      assert_equal 'dashboard', script.input['tools'].first['name']
      activity = output.find { |event| event['activityType'] == 'mcp-apps' }
      assert_equal 'ui://dashboard', activity.dig('content', 'resourceUri')
      assert_equal({ 'count' => 2 }, activity.dig('content', 'toolInput'))
      assert_equal 'RUN_FINISHED', output.last['type']
      assert calls.all? { |call| call['auth'] == 'Bearer server-secret' }
      assert calls.reject { |call| call.dig('rpc', 'method') == 'initialize' }.all? { |call| call['session'] == 'session' }
    ensure
      server.shutdown
      thread.join
    end
  end

  def test_a2ui_progressive_data_accepts_scalar_items
    middleware = CopilotKit::A2UI.new({})
    middleware.prepare(input)
    middleware.accept('type' => 'TOOL_CALL_START', 'toolCallId' => 'scalar', 'toolCallName' => 'render_a2ui')
    events = middleware.accept('type' => 'TOOL_CALL_ARGS', 'toolCallId' => 'scalar', 'delta' => '{"surfaceId":"s","components":[{"id":"root","component":"Text"}],"data":{"items":[1,true,null,"x",')
    data = events.filter_map { |event| event.dig('content', 'a2ui_operations') }.flatten.find { |operation| operation['updateDataModel'] }
    assert_equal [1, true, nil, 'x'], data&.dig('updateDataModel', 'value', 'items')
  end

  def test_a2ui_retry_keeps_outer_activity_state_until_valid_paint
    middleware = CopilotKit::A2UI.new({})
    middleware.prepare(input)
    middleware.accept('type' => 'TOOL_CALL_START', 'toolCallId' => 'outer', 'toolCallName' => 'generate_ui')
    first = middleware.accept('type' => 'TOOL_CALL_START', 'toolCallId' => 'first', 'toolCallName' => 'render_a2ui')
    rejected = middleware.accept('type' => 'TOOL_CALL_ARGS', 'toolCallId' => 'first', 'delta' => '{"surfaceId":"s","components":[{"id":"no-root","component":"Text"}]}')
    next_attempt = middleware.accept('type' => 'TOOL_CALL_START', 'toolCallId' => 'second', 'toolCallName' => 'render_a2ui')
    assert_equal 'a2ui-surface-outer', first.first['messageId']
    assert_equal 'retrying', rejected.last.dig('content', 'status')
    assert_empty next_attempt
  end

  def test_mcp_sse_returns_matching_response_without_waiting_for_stream_close
    listener = TCPServer.new('127.0.0.1', 0)
    socket = nil
    server = Thread.new do
      socket = listener.accept
      length = 0
      while (line = socket.gets) && line != "\r\n"
        length = line.split(':', 2).last.to_i if line.downcase.start_with?('content-length:')
      end
      body = JSON.parse(socket.read(length))
      socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n")
      socket.write('data: ' + JSON.generate('jsonrpc' => '2.0', 'id' => body['id'], 'result' => { 'ready' => true }) + "\n\n")
      sleep 2
    end
    begin
      client = CopilotKit::MCPClient.new('type' => 'http', 'url' => "http://127.0.0.1:#{listener.addr[1]}/mcp")
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      assert_equal({ 'ready' => true }, client.rpc('ping'))
      assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 1
    ensure
      socket&.close
      listener.close
      server.kill
      server.join
    end
  end
end

class UITest
  def test_nullable_optional_arrays_are_normalized_before_middleware
    agent = ScriptAgent.new([])
    run_input = input.merge('tools' => nil, 'context' => nil, 'messages' => [{ 'id' => 'm', 'role' => 'assistant', 'toolCalls' => nil }, { 'id' => 'user', 'role' => 'user', 'content' => 'hello' }])
    CopilotKit::UIAgent.new(agent: agent, a2ui: { 'injectA2UITool' => true }).each_event(run_input) { |_| }
    assert_kind_of Array, agent.input['tools']
    assert_kind_of Array, agent.input['context']
    assert_nil run_input['messages'][0]['toolCalls']
    assert_equal run_input['messages'][1], agent.input['messages'][1]
  end

  def test_proxy_maps_expected_configuration_and_connection_failures
    [{ 'serverId' => 'test' }, { 'serverId' => 'test', 'url' => 'http://127.0.0.1:1' }].each do |server|
      result = CopilotKit::MCPApps.new([server]).proxy('serverId' => 'test', 'method' => 'ping')
      assert_equal({ 'error' => 'MCP proxy request rejected or failed' }, result)
    end
  end
end
