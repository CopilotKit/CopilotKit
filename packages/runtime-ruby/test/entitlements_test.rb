# frozen_string_literal: true
require 'minitest/autorun'
require 'minitest/mock'
require 'socket'
require 'copilotkit/intelligence'

class EntitlementsTest < Minitest::Test
  def ready(active = true)
    { 'status' => 'ready', 'entitlement' => { 'active' => active,
      'source' => 'managedOrgSubscription', 'features' => { 'memory' => true },
      'limits' => { 'threads' => 100 }, 'planCode' => 'pro' } }
  end

  def client(&handler)
    transport = Object.new
    transport.define_singleton_method(:request, &handler)
    CopilotKit::Intelligence.new(api_key: 'server-key', transport: transport)
  end

  def test_current_and_legacy_entitlements_use_the_standalone_sdk
    [false, true].each do |legacy|
      expected = ready
      payload = legacy ? expected['entitlement'].merge('organizationId' => 'org') : expected
      calls = []
      sdk = client { |*args| calls << args; payload }
      assert_respond_to sdk, :get_runtime_entitlements

      result = sdk.get_runtime_entitlements

      assert_equal expected, result
      assert_equal [['GET', '/api/entitlements/runtime', nil, {}]], calls
    end
  end

  def test_structured_nonready_entitlements_preserve_retry_and_correlation_fields
    %w[degraded misconfigured unavailable].each do |status|
      payload = { 'status' => status, 'error' => { 'code' => 'WAIT', 'message' => 'Try later',
        'retryable' => true, 'requestId' => 'request', 'traceId' => 'trace' } }
      sdk = client { |*| payload }
      assert_equal payload, sdk.get_runtime_entitlements
    end
  end

  def test_unknown_and_invalid_authority_fields_are_rejected
    grant = ready['entitlement']
    [nil, [], {}, ready.merge('extra' => true),
     ready.merge('entitlement' => grant.merge('active' => 1)),
     ready.merge('entitlement' => grant.merge('features' => { 'memory' => 1 })),
     ready.merge('entitlement' => grant.merge('limits' => { 'threads' => true })),
     ready.merge('entitlement' => grant.merge('limits' => { 'threads' => Float::INFINITY })),
     ready.merge('entitlement' => grant.merge('limits' => { 'threads' => 10**400 })),
     ready.merge('entitlement' => grant.merge('source' => 'unknown')),
     ready.merge('entitlement' => grant.merge('planCode' => nil)),
     grant.merge('organizationId' => 'org', 'extra' => true)].each do |payload|
      sdk = client { |*| payload }
      error = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
      assert_equal 502, error.status
      assert_equal false, error.retryable
    end
  end

  def test_concurrent_callers_share_one_request_and_receive_copies
    entered, started, release, calls = Queue.new, Queue.new, Queue.new, Queue.new
    response = ready
    sdk = client { |*| calls << true; started << true; release.pop; response }
    workers = Array.new(8) { Thread.new { entered << true; sdk.get_runtime_entitlements } }
    Timeout.timeout(2) { 8.times { entered.pop }; started.pop }
    8.times { release << true }
    results = workers.map(&:value)
    results.first['entitlement']['features']['memory'] = false
    response['entitlement']['features']['memory'] = false

    assert_equal 1, calls.size
    assert_equal ready, sdk.get_runtime_entitlements
    assert results.drop(1).all? { |result| result == ready }
  ensure
    workers&.each { |worker| worker.kill; worker.join }
  end

  def test_active_and_negative_results_expire_without_stale_authority
    [[true, 30], [false, 5]].each do |active, ttl|
      now, calls = [100.0], []
      payload = ready(active)
      sdk = client do |*args|
        calls << args
        raise CopilotKit::Error.new(503, 'provider-secret-payload') if calls.length > 1
        payload
      end
      sdk.define_singleton_method(:entitlement_now) { now.first }
      assert_equal payload, sdk.get_runtime_entitlements
      now[0] += ttl - 0.01
      assert_equal payload, sdk.get_runtime_entitlements
      now[0] += 0.02
      error = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
      assert_equal 503, error.status
      assert_equal 2, calls.length
    end
  end

  def test_nonready_results_and_request_errors_cache_for_five_seconds
    now, calls = [100.0], []
    sdk = client { |*args| calls << args; raise CopilotKit::Error.new(403, 'provider-secret-payload') }
    sdk.define_singleton_method(:entitlement_now) { now.first }
    first = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
    first.instance_variable_set(:@status, 999)
    second = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
    assert_equal 1, calls.length
    assert_equal 403, second.status
    assert_equal false, second.retryable
    refute_same first, second
    assert_nil second.cause
    refute_includes second.full_message, 'provider-secret-payload'
    now[0] += 5
    assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
    assert_equal 2, calls.length

    calls.clear
    payload = { 'status' => 'degraded', 'error' => { 'code' => 'WAIT', 'message' => 'Try later', 'retryable' => true } }
    sdk = client { |*args| calls << args; payload }
    sdk.define_singleton_method(:entitlement_now) { now.first }
    first = sdk.get_runtime_entitlements
    first['error']['retryable'] = false
    now[0] += 4.99
    assert_equal payload, sdk.get_runtime_entitlements
    assert_equal 1, calls.length
    now[0] += 0.02
    assert_equal payload, sdk.get_runtime_entitlements
    assert_equal 2, calls.length
  end

  def test_error_status_and_retryability_match_the_typescript_sdk
    [[401, false], [403, false], [404, false], [408, true], [425, true], [429, true], [500, true]].each do |status, retryable|
      sdk = client { |*| raise CopilotKit::Error.new(status, 'provider-secret-payload') }
      error = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
      assert_equal status, error.status
      assert_equal retryable, error.retryable
      assert_nil error.cause
      refute_includes error.full_message, 'provider-secret-payload'
    end
    [[Timeout::Error, 504], [IOError, 502], [RuntimeError, 502]].each do |type, status|
      sdk = client { |*| raise type, 'provider-secret-payload' }
      error = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
      assert_equal status, error.status
      assert_equal true, error.retryable
      assert_nil error.cause
    end
  end

  def test_custom_transport_typed_errors_do_not_expose_private_messages
    sdk = client { |*| raise CopilotKit::RuntimeEntitlementError.new(502, 'provider-secret-payload', false) }
    2.times do
      error = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
      assert_equal 502, error.status
      assert_equal false, error.retryable
      refute_includes error.full_message, 'provider-secret-payload'
      assert_nil error.cause
    end
  end

  def with_native_platform(status: 200, body: JSON.generate(ready), stall: nil)
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
        socket.write("HTTP/1.1 #{status} Test\r\nContent-Length: #{length}\r\nConnection: close\r\n\r\n")
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

  def test_native_entitlement_request_uses_a_bodyless_get_and_server_credentials
    with_native_platform do |sdk, requests, _|
      assert_equal ready, sdk.get_runtime_entitlements
      headers = Timeout.timeout(1) { requests.pop }
      assert_equal 'GET /base/api/entitlements/runtime HTTP/1.1', headers.first
      assert_includes headers, 'Authorization: Bearer server-key'
      refute headers.any? { |line| line.downcase.start_with?('cookie:', 'content-length:') }
    end
  end

  def test_native_entitlement_errors_close_without_reading_the_body
    with_native_platform(status: 401, stall: :body) do |sdk, _, closed|
      error = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
      assert_equal 401, error.status
      assert_equal false, error.retryable
      assert Timeout.timeout(1) { closed.pop }
    end
  end

  def test_native_malformed_entitlement_json_is_not_retryable
    ['', 'provider-secret-payload'].each do |body|
      with_native_platform(body: body) do |sdk, _, _|
        error = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
        assert_equal 502, error.status
        assert_equal false, error.retryable
        assert_nil error.cause
        refute_includes error.full_message, 'provider-secret-payload'
      end
    end
  end

  def test_native_entitlement_deadline_covers_headers_and_body
    [:headers, :body].each do |phase|
      with_native_platform(stall: phase) do |sdk, _, closed|
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        error = assert_raises(CopilotKit::Error) { sdk.get_runtime_entitlements }
        assert_equal 504, error.status
        assert_equal true, error.retryable
        assert_nil error.cause
        assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :<, 2.5
        assert Timeout.timeout(1) { closed.pop }
      end
    end
  end
end
