# frozen_string_literal: true
# Test-only composition root. Never use these header defaults as production authentication.
$LOAD_PATH.unshift(File.expand_path('../lib', __dir__))
require 'copilotkit/runtime'
require 'webrick'
require 'stringio'

config = JSON.parse(ENV.fetch('CPK_CONFIG'))
exporter = if config['telemetryUrl']
             lambda do |event|
               uri = URI(config['telemetryUrl'])
               Net::HTTP.post(uri, JSON.generate(event), 'content-type' => 'application/json')
             end
           end
runtime = CopilotKit::Runtime.new(
  api_key: config.fetch('apiKey'), api_url: config.fetch('apiUrl'),
  runner_url: config.fetch('runnerUrl'), client_url: config.fetch('clientUrl'), base_path: '/copilotkit',
  agents: { 'default' => CopilotKit::HttpAgent.new(url: config.fetch('agentUrl')) },
  identify_user: ->(env) { { 'id' => env['HTTP_X_TEST_USER_ID'] || 'test-user', 'name' => env['HTTP_X_TEST_USER_NAME'] || 'Test User' } },
  memory_access: ->(_user, _env) { { 'user' => 'read-write', 'project' => 'read-write' } },
  telemetry: CopilotKit::Telemetry.new(exporter: exporter)
)
server = WEBrick::HTTPServer.new(Port: config.fetch('port', 0), BindAddress: '127.0.0.1', Logger: WEBrick::Log.new(File::NULL), AccessLog: [])
servlet = Class.new(WEBrick::HTTPServlet::AbstractServlet) do
  define_method(:service) do |request, response|
    env = { 'REQUEST_METHOD' => request.request_method, 'PATH_INFO' => request.path,
            'QUERY_STRING' => request.query_string.to_s, 'rack.input' => StringIO.new(request.body.to_s) }
    request.header.each { |key, value| env['HTTP_' + key.upcase.tr('-', '_')] = value.first }
    status, headers, body = runtime.call(env)
    response.status = status
    headers.each { |key, value| response[key] = value }
    response.body = body.to_a.join
  end
end
server.mount('/', servlet)
%w[TERM INT].each { |signal| trap(signal) { server.shutdown } }
$stdout.sync = true
puts JSON.generate('port' => server.listeners.first.addr[1])
begin
  server.start
ensure
  runtime.close
end
