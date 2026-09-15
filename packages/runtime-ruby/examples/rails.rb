# frozen_string_literal: true
# Load this initializer in a Rails application after defining its agent.
require 'copilotkit/runtime'

Rails.application.config.x.copilotkit_runtime = CopilotKit::Runtime.new(
  api_key: ENV.fetch('CPK_INTELLIGENCE_API_KEY'),
  agents: { 'default' => CopilotKit::HttpAgent.new(url: ENV.fetch('AG_UI_AGENT_URL')) },
  # This example uses Warden (as installed by Devise). Authentication belongs
  # to the application; no browser-supplied user ID becomes trusted identity.
  identify_user: lambda do |env|
    user = env['warden']&.user
    user && { 'id' => user.id.to_s, 'name' => user.name.to_s }
  end,
  memory_access: ->(_user, _env) { { 'user' => 'read-write', 'project' => 'none' } }
)

# In config/routes.rb:
# mount Rails.application.config.x.copilotkit_runtime => '/copilotkit'
#
# In the application server's worker shutdown hook:
# Rails.application.config.x.copilotkit_runtime.close(timeout: 10)
# Construct the runtime after worker fork; each worker owns its run threads.
