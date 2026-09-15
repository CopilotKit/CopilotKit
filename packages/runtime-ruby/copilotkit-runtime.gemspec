# frozen_string_literal: true
Gem::Specification.new do |spec|
  spec.name = 'copilotkit-runtime'
  spec.version = '0.1.0'
  spec.summary = 'Native Intelligence runtime for Ruby Rack applications'
  spec.authors = ['CopilotKit']
  spec.license = 'MIT'
  spec.required_ruby_version = '>= 2.7'
  spec.files = Dir['lib/**/*.rb', 'README.md', 'LICENSE']
  spec.require_paths = ['lib']
  spec.homepage = 'https://github.com/CopilotKit/CopilotKit'
  spec.add_dependency 'base64', '~> 0.2'
  spec.add_dependency 'websocket', '~> 1.2'
end
