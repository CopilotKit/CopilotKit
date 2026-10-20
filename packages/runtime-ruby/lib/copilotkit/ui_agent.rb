# frozen_string_literal: true
require_relative 'a2ui'
require_relative 'mcp_apps'
module CopilotKit
  class UIAgent < Agent
    def initialize(agent:, a2ui: nil, mcp_servers: [])
      @agent, @a2ui, @mcp_servers = agent, a2ui, mcp_servers
      super(description: agent.description)
    end
    def each_event(input, &block)
      input = input.merge('tools' => input['tools'] || [], 'context' => input['context'] || [],
        'messages' => input.fetch('messages').map { |message| message.key?('toolCalls') && message['toolCalls'].nil? ? message.merge('toolCalls' => []) : message })
      mcp = MCPApps.new(@mcp_servers)
      if (request = input.dig('forwardedProps', '__proxiedMCPRequest'))
        block.call('type' => 'RUN_FINISHED', 'result' => mcp.proxy(request))
        return
      end
      middleware = @a2ui && A2UI.new(@a2ui)
      prepared = middleware ? middleware.prepare(input) : input
      prepared = mcp.prepare(prepared)
      terminal = nil
      @agent.each_event(prepared) do |event|
        if event['type'] == 'RUN_FINISHED'
          terminal = event
        else
          mcp.accept(event)
          generated = middleware ? middleware.accept(event) : []
          generated.each(&block) unless event['type'] == 'TOOL_CALL_RESULT'
          block.call(event)
          generated.each(&block) if event['type'] == 'TOOL_CALL_RESULT'
        end
      end
      middleware&.finish&.each(&block) if terminal
      mcp.finish(&block) if terminal
      block.call(terminal) if terminal
    end
  end
end
