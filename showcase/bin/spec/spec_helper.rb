# frozen_string_literal: true

# Helper that loads bin/railway as a library (so we can access Railway:: classes
# without invoking the CLI).

require "minitest/autorun"

# Stub $PROGRAM_NAME so the bottom-of-file invocation guard is skipped.
unless defined?(::Railway)
    load File.expand_path("../railway", __dir__)
end
