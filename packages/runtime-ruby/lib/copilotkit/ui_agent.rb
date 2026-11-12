# frozen_string_literal: true
require_relative 'a2ui'
require_relative 'a2ui_upgrade'
require_relative 'generative_ui'
require_relative 'mcp_apps'
module CopilotKit
  # Applies the UI middlewares of one agent to each run.
  #
  # The order matches the TypeScript runtime, outermost first: the A2UI v0.9 bridge, A2UI
  # v0.9, MCP Apps, then render_ui. Input passes them in that order and events in reverse.
  # Only the agent side gets the bridged input; the stored thread keeps the client's input.
  class UIAgent < Agent
    # `generative_ui` is the runtime option (see `GenerativeUI.validate_option!`).
    def initialize(agent:, agent_id: 'default', generative_ui: nil, mcp_servers: [])
      @agent, @agent_id, @generative_ui, @mcp_servers = agent, agent_id, generative_ui, mcp_servers
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
      forwarded = input['forwardedProps']
      generative = GenerativeUI.generative_ui_run?(@generative_ui, @agent_id, forwarded)
      version = GenerativeUI.resolve_a2ui_version(@generative_ui, @agent_id)
      agent_input = generative ? A2UIUpgrade.prepare_agent_input(input, version) : input
      a2ui = generative ? A2UI.new(GenerativeUI.a2ui_middleware_config(@generative_ui, version, forwarded)) : nil
      prepared = a2ui ? a2ui.prepare(agent_input) : agent_input
      prepared = mcp.prepare(prepared)
      # A v0.9 agent gets render_a2ui instead of render_ui.
      manifest = generative && version == '1.0' ? GenerativeUI.read_tool_manifest(prepared['forwardedProps']) : nil
      render_ui = manifest && GenerativeUI::Middleware.new(manifest)
      prepared = render_ui.prepare(prepared) if render_ui
      surfaces = render_ui&.start(prepared)
      upgrader = generative ? A2UIUpgrade::ActivityUpgrader.new : nil
      publish = ->(event) { (upgrader ? upgrader.transform(event) : [event]).each(&block) }
      # The A2UI middleware reports its own events around the event that caused them.
      a2ui_stage = lambda do |event|
        generated = a2ui ? a2ui.accept(event) : []
        generated.each(&publish) unless event['type'] == 'TOOL_CALL_RESULT'
        publish.call(event)
        generated.each(&publish) if event['type'] == 'TOOL_CALL_RESULT'
      end
      outer = lambda do |event|
        mcp.accept(event)
        a2ui_stage.call(event)
      end
      terminal = nil
      @agent.each_event(prepared) do |event|
        if event['type'] == 'RUN_FINISHED'
          terminal = event
          surfaces&.finishing
        else
          (surfaces ? surfaces.handle(event) : [event]).each(&outer)
        end
      end
      surfaces&.complete(!terminal.nil?)&.each(&outer)
      return unless terminal
      mcp.finish(&a2ui_stage)
      a2ui&.finish&.each(&publish)
      block.call(terminal)
    end
  end
end
