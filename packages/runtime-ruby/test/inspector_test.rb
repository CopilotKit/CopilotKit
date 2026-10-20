# frozen_string_literal: true
require 'minitest/autorun'
require 'minitest/mock'
require 'timeout'
require 'socket'
require 'copilotkit/intelligence'

class InspectorTest < Minitest::Test
  def client(&handler)
    transport = Object.new
    transport.define_singleton_method(:request, &handler)
    CopilotKit::Intelligence.new(api_key: 'server-key', transport: transport)
  end

  def with_native_platform(status: 200, body: '{"schemaVersion":1}', stall: nil)
    listener = TCPServer.new('127.0.0.1', 0)
    requests, closed = Queue.new, Queue.new
    worker = Thread.new do
      socket = listener.accept
      headers = []
      while (line = socket.gets) && line != "\r\n"
        headers << line.strip
      end
      requests << headers
      unless stall == :headers
        length = stall == :body ? 1000 : body.bytesize
        location = status.between?(300, 399) ? "Location: http://127.0.0.1:#{listener.addr[1]}/redirect\r\n" : ''
        socket.write("HTTP/1.1 #{status} Test\r\nContent-Length: #{length}\r\n#{location}Connection: close\r\n\r\n")
        socket.write(body) unless stall == :body
      end
      socket.read if stall
      closed << true
    ensure
      socket&.close
    end
    sdk = CopilotKit::Intelligence.new(api_key: 'server-key', api_url: "http://127.0.0.1:#{listener.addr[1]}/base")
    yield sdk, requests, closed
  ensure
    listener&.close
    worker&.kill
    worker&.join
  end

  def with_short_deadline
    original = Timeout.method(:timeout)
    Timeout.stub(:timeout, ->(seconds, *args, &block) { original.call([seconds, 0.1].min, *args, &block) }) { yield }
  end

  def test_native_transport_uses_server_credentials
    with_native_platform do |sdk, requests, _|
      assert_equal({ 'schemaVersion' => 1 }, sdk.get_inspector_metadata)
      headers = Timeout.timeout(1) { requests.pop }
      assert_equal 'GET /base/api/inspector/metadata HTTP/1.1', headers.first
      assert_includes headers, 'Authorization: Bearer server-key'
      refute headers.any? { |line| line.downcase.start_with?('cookie:') }
    end
  end

  def test_native_404_closes_without_waiting_for_the_body
    with_native_platform(status: 404, stall: :body) do |sdk, _, closed|
      with_short_deadline { assert_nil sdk.get_inspector_metadata }
      assert Timeout.timeout(1) { closed.pop }
    end
  end

  def test_native_200_empty_body_is_not_compatible_absence
    with_native_platform(body: '') do |sdk, _, _|
      error = assert_raises(CopilotKit::Error) { sdk.get_inspector_metadata }
      assert_equal 502, error.status
    end
  end

  def test_native_deadline_interrupts_headers_and_body_and_closes_connections
    [:headers, :body].each do |phase|
      with_native_platform(stall: phase) do |sdk, _, closed|
        with_short_deadline do
          error = assert_raises(Timeout::Error) { sdk.get_inspector_metadata }
          assert_equal 'Inspector metadata request timed out', error.message
          assert_nil error.cause
        end
        assert Timeout.timeout(1) { closed.pop }
      end
    end
  end

  def test_native_provider_errors_and_invalid_json_never_disclose_the_body
    [301, 302, 401, 403, 429, 500, 503, 200].each do |status|
      with_native_platform(status: status, body: 'private-key') do |sdk, requests, _|
        error = assert_raises(CopilotKit::Error) { sdk.get_inspector_metadata }
        assert_equal(status == 200 ? 502 : status, error.status)
        refute_includes error.full_message, 'private-key'
        assert_nil error.cause
        assert_equal 'GET /base/api/inspector/metadata HTTP/1.1', Timeout.timeout(1) { requests.pop }.first
        assert requests.empty?
      end
    end
    with_native_platform(status: 204) { |sdk, _, _| assert_nil sdk.get_inspector_metadata }
  end

  def test_action_urls_match_the_supported_navigation_policy
    ['https://cloud.test/manage', 'http://localhost/manage', 'http://localhost:3000/manage',
     'http://127.0.0.1:3000/manage', 'http://[::1]:3000/manage'].each do |url|
      expected = { 'schemaVersion' => 1, 'action' => { 'kind' => 'renew', 'url' => url } }
      assert_equal expected, CopilotKit::InspectorMetadata.parse(expected)
    end
    ['', ' ', '/manage', 'mailto:billing@cloud.test', 'ftp://cloud.test/manage', 'http://cloud.test/manage',
     'http://localhost.example.com/manage', 'http://sub.localhost/manage', 'http://127.0.0.2/manage',
     'http://[::2]/manage', 'http://0.0.0.0/manage', 'https://@cloud.test/manage', 'https://user:pass@cloud.test/manage',
     'https://cloud.test/manage?', 'https://cloud.test/manage?key=private', 'https://cloud.test/manage#',
     'https://bad host/manage', 'https://cloud.test:65536/manage', 'https://cloud.test:bad/manage',
     'https://[broken/manage', 'https://[broken]/manage', 'https://%20/manage'].each do |url|
      result = CopilotKit::InspectorMetadata.parse('schemaVersion' => 1, 'action' => { 'kind' => 'renew', 'url' => url },
        'plan' => { 'code' => 'team', 'label' => 'Team' })
      assert_equal({ 'schemaVersion' => 1, 'plan' => { 'code' => 'team', 'label' => 'Team' } }, result, url)
    end
  end

  def test_usage_counts_reject_non_safe_numbers_without_hiding_other_fields
    [nil, true, -1, 1.5, 9_007_199_254_740_992, Float::INFINITY, Float::NAN, '1'].each do |invalid|
      base = { 'used' => 3, 'limit' => { 'kind' => 'finite', 'value' => 10 } }
      assert_equal({ 'schemaVersion' => 1 }, CopilotKit::InspectorMetadata.parse('schemaVersion' => 1, 'usage' => base.merge('used' => invalid)))
      assert_equal({ 'schemaVersion' => 1 }, CopilotKit::InspectorMetadata.parse('schemaVersion' => 1, 'usage' => base.merge('limit' => { 'kind' => 'finite', 'value' => invalid })))
      assert_equal({ 'schemaVersion' => 1, 'usage' => base }, CopilotKit::InspectorMetadata.parse('schemaVersion' => 1, 'usage' => base.merge('expiringSoonCount' => invalid)))
    end
  end

  def test_unsupported_schemas_and_invalid_modules_do_not_escape
    [nil, [], 1, '1', {}, { 'schemaVersion' => true }, { 'schemaVersion' => 2 }].each do |value|
      assert_nil CopilotKit::InspectorMetadata.parse(value)
    end
    value = { 'schemaVersion' => 1.0,
      'identity' => { 'organizationName' => "\ufeff Org \ufeff".dup, 'projectName' => "\u0085" },
      'plan' => { 'code' => '', 'label' => 'Invalid' }, 'license' => { 'state' => 'unknown'.dup, 'private' => 'secret' },
      'action' => { 'kind' => 'unsupported', 'url' => 'https://cloud.test' },
      'usage' => { 'used' => 0.0, 'limit' => { 'kind' => 'unlimited', 'value' => 3 }, 'expiringSoonCount' => 0 } }

    result = CopilotKit::InspectorMetadata.parse(value)
    value['identity']['organizationName'].replace('changed')
    value['license']['state'].replace('changed')

    assert_equal({ 'schemaVersion' => 1, 'identity' => { 'organizationName' => 'Org', 'projectName' => "\u0085" },
      'license' => { 'state' => 'unknown' }, 'usage' => { 'used' => 0, 'limit' => { 'kind' => 'unlimited' }, 'expiringSoonCount' => 0 } }, result)
  end

  def test_404_is_compatible_absence
    sdk = client { |*_| raise CopilotKit::Error.new(404, 'private provider response') }

    assert_nil sdk.get_inspector_metadata
  end

  def test_metadata_uses_a_five_second_full_request_deadline
    durations = []
    sdk = client { |*_| nil }
    timeout = lambda do |duration, &block|
      durations << duration
      raise Timeout::Error, 'internal timeout'
    end

    Timeout.stub(:timeout, timeout) do
      error = assert_raises(Timeout::Error) { sdk.get_inspector_metadata }
      assert_equal 'Inspector metadata request timed out', error.message
      assert_nil error.cause
    end

    assert_equal [5], durations
  end

  def test_metadata_errors_retain_status_without_private_messages_or_causes
    sdk = client { |*_| raise CopilotKit::Error.new(503, 'private provider response') }

    error = assert_raises(CopilotKit::Error) { sdk.get_inspector_metadata }

    assert_equal 503, error.status
    refute_includes error.full_message, 'private provider response'
    assert_nil error.cause
  end

  def test_metadata_sanitizes_independent_modules_and_uses_the_shared_transport
    requests = []
    sdk = client do |*args|
      requests << args
      { 'schemaVersion' => 1,
        'identity' => { 'organizationName' => ' Org ', 'projectName' => ' App ', 'private' => 'secret' },
        'plan' => { 'code' => ' team ', 'label' => ' Team ' },
        'license' => { 'state' => 'valid', 'private' => 'secret' },
        'action' => { 'kind' => 'manage_plan', 'url' => ' https://cloud.test/manage ' },
        'usage' => { 'used' => 3, 'limit' => { 'kind' => 'finite', 'value' => 10 }, 'expiringSoonCount' => 0 },
        'private' => 'secret' }
    end

    metadata = sdk.get_inspector_metadata

    assert_equal({ 'schemaVersion' => 1,
      'identity' => { 'organizationName' => 'Org', 'projectName' => 'App' },
      'plan' => { 'code' => 'team', 'label' => 'Team' }, 'license' => { 'state' => 'valid' },
      'action' => { 'kind' => 'manage_plan', 'url' => 'https://cloud.test/manage' },
      'usage' => { 'used' => 3, 'limit' => { 'kind' => 'finite', 'value' => 10 }, 'expiringSoonCount' => 0 } }, metadata)
    assert_equal [['GET', '/api/inspector/metadata', nil, {}]], requests
  end
end
