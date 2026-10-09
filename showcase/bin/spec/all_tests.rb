#!/usr/bin/env ruby
# frozen_string_literal: true

# Entry point for bin/railway minitest suite. Discovers and runs every test_*.rb
# in this directory.

$LOAD_PATH.unshift(File.expand_path("..", __dir__))
$LOAD_PATH.unshift(__dir__)

require "minitest/autorun"

Dir.glob(File.join(__dir__, "test_*.rb")).sort.each { |f| require f }
