# frozen_string_literal: true
# Same composition root and runtime, hosted through a real Rails application.
ENV['CPK_RAILS_FIXTURE'] = 'true'
load File.expand_path('conformance.rb', __dir__)
