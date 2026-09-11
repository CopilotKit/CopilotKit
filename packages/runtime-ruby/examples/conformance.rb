# frozen_string_literal: true
# Test-only composition root. Never use these header defaults as production authentication.
$LOAD_PATH.unshift(File.expand_path('../lib', __dir__))
require 'copilotkit/runtime'
require 'webrick'
require 'stringio'

config = JSON.parse(ENV.fetch('CPK_CONFIG'))
runtime = CopilotKit::Runtime.new(
  api_key: config.fetch('apiKey'), api_url: config.fetch('apiUrl'),
  runner_url: config.fetch('runnerUrl'), client_url: config.fetch('clientUrl'), base_path: '/copilotkit',
  agents: { 'default' => CopilotKit::HttpAgent.new(url: config.fetch('agentUrl'), description: 'Conformance agent') },
  identify_user: ->(env) { { 'id' => env['HTTP_X_TEST_USER_ID'] || 'test-user', 'name' => env['HTTP_X_TEST_USER_NAME'] || 'Test User' } },
  **(config['omitMemoryPolicy'] == true ? {} : {
    memory_access: ->(_user, _env) { config.key?('memoryGrant') ? config['memoryGrant'] : { 'user' => 'read-write', 'project' => 'read-write' } }
  }),
  telemetry: CopilotKit::Telemetry.new(url: config['telemetryUrl'], sample_rate: config.fetch('telemetrySampleRate', 0.05),
    disabled: config.fetch('telemetryDisabled', false), telemetry_id: config['telemetryId'], license_token: config['licenseToken']),
  a2ui: config['a2ui'], mcp_apps: config['mcpApps']
)
app = runtime
if ENV['CPK_RAILS_FIXTURE'] == 'true'
  require 'rails'
  require 'action_controller/railtie'
  require 'rack/mock'
  class CopilotKitFixtureRails < Rails::Application
    config.eager_load = false
    config.secret_key_base = 'local-conformance-only-not-a-production-secret' * 2
    config.logger = Logger.new(File::NULL)
    config.hosts.clear
    config.active_support.cache_format_version = 7.1
  end
  CopilotKitFixtureRails.initialize!
  CopilotKitFixtureRails.routes.draw { mount runtime => '/copilotkit' }
  app = CopilotKitFixtureRails
end
server = WEBrick::HTTPServer.new(Port: config.fetch('port', 0), BindAddress: '127.0.0.1', Logger: WEBrick::Log.new(File::NULL), AccessLog: [])
servlet = Class.new(WEBrick::HTTPServlet::AbstractServlet) do
  define_method(:service) do |request, response|
    env = { 'REQUEST_METHOD' => request.request_method, 'PATH_INFO' => request.path,
            'QUERY_STRING' => request.query_string.to_s, 'rack.input' => StringIO.new(request.body.to_s) }
    if ENV['CPK_RAILS_FIXTURE'] == 'true'
      env = Rack::MockRequest.env_for(request.request_uri.to_s, method: request.request_method,
        input: request.body.to_s, 'CONTENT_TYPE' => request['content-type'])
    end
    request.header.each { |key, value| env['HTTP_' + key.upcase.tr('-', '_')] = value.first }
    status, headers, body = app.call(env)
    response.status = status
    headers.each { |key, value| response[key] = value }
    buffer = +''
    body.each { |part| buffer << part }
    body.close if body.respond_to?(:close)
    response.body = buffer
  end
end
server.mount('/', servlet)
%w[TERM INT].each { |signal| trap(signal) { server.shutdown } }
$stdout.sync = true
puts JSON.generate({ 'port' => server.listeners.first.addr[1] }.merge(ENV['CPK_RAILS_FIXTURE'] == 'true' ? { 'railsVersion' => Rails.version } : {}))
begin
  server.start
ensure
  runtime.close
end
