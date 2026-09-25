#!/usr/bin/env bash
set -euo pipefail
package_temp=$(mktemp -d "${TMPDIR:-/tmp}/copilotkit-ruby-package.XXXXXX")
trap 'rm -rf "$package_temp"' EXIT

# Use only the built gem and its declared dependencies, outside the checkout.
export GEM_HOME="$package_temp/gems"
export GEM_PATH="$GEM_HOME"
unset BUNDLE_GEMFILE RUBYLIB RUBYOPT
gem install /tmp/copilotkit-runtime.gem --no-document
cd "$package_temp"
ruby <<'RUBY'
require 'copilotkit/intelligence'
abort 'SDK unexpectedly loaded Runtime' if defined?(CopilotKit::Runtime)
sdk = CopilotKit::Intelligence.new(api_key: 'package-smoke-test')
require 'copilotkit/runtime'
runtime = CopilotKit::Runtime.new(intelligence: sdk, identify_user: ->(_env) { nil })
abort 'Runtime did not retain the SDK' unless runtime.intelligence.equal?(sdk)
abort 'Missing AG-UI HTTP agent' unless CopilotKit::HttpAgent < CopilotKit::Agent
runtime.close
puts "Installed #{Gem.loaded_specs.fetch('copilotkit-runtime').full_name}: SDK, Runtime, and AG-UI loaded successfully."
RUBY
