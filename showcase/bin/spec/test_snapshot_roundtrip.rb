# frozen_string_literal: true

require_relative "spec_helper"
require "tempfile"
require "stringio"

class SnapshotRoundtripTest < Minitest::Test
    def sample_snapshot
        {
            "version"     => 1,
            "captured_at" => "2026-01-01T00:00:00Z",
            "project_id"  => Railway::PROJECT_ID,
            "environment" => { "id" => Railway::STAGING_ENV_ID, "name" => "staging" },
            "services" => [
                {
                    "name"                  => "showcase-shell",
                    "service_id"            => "svc-1",
                    "image"                 => "ghcr.io/copilotkit/showcase-shell@sha256:abc",
                    "image_tag"             => "ghcr.io/copilotkit/showcase-shell",
                    "digest"                => "sha256:abc",
                    "start_command"         => "node server.js",
                    "auto_updates_disabled" => nil,
                    "latest_deployment_id"  => "dep-1",
                    "env_keys"              => %w[KEY1 KEY2],
                    "custom_domains"        => ["showcase.staging.copilotkit.ai"],
                },
            ],
        }
    end

    def test_write_and_read_roundtrip
        snap = sample_snapshot
        Tempfile.create(["snap", ".yaml"]) do |f|
            Railway::SnapshotIO.write(f.path, snap)
            loaded = Railway::SnapshotIO.read(f.path)
            assert_equal snap["version"], loaded["version"]
            assert_equal "showcase-shell", loaded["services"][0]["name"]
            assert_equal "sha256:abc", loaded["services"][0]["digest"]
        end
    end

    def test_read_rejects_wrong_schema_version
        bad = sample_snapshot
        bad["version"] = 999
        Tempfile.create(["snap", ".yaml"]) do |f|
            File.write(f.path, YAML.dump(bad))
            orig = $stderr
            $stderr = StringIO.new
            ex = assert_raises(SystemExit) { Railway::SnapshotIO.read(f.path) }
            $stderr = orig
            assert_equal 2, ex.status
        end
    end

    def test_find_service_by_name
        snap = sample_snapshot
        svc = Railway.find_service(snap, "showcase-shell")
        assert_equal "svc-1", svc["service_id"]
        assert_nil Railway.find_service(snap, "does-not-exist")
    end
end
