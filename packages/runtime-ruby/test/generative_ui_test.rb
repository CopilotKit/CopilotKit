# frozen_string_literal: true
require 'minitest/autorun'
require 'stringio'
require 'json'
require 'copilotkit/runtime'

class GenerativeUITest < Minitest::Test
  GUI = CopilotKit::GenerativeUI
  PRODUCT_CARD = {
    'description' => 'A product',
    'props' => { 'type' => 'object', 'properties' => { 'name' => { 'type' => 'string' }, 'price' => { 'type' => 'number' } }, 'required' => ['name'] },
    'events' => { 'onBuy' => { 'description' => 'Buys it', 'parameters' => {} } },
    'slots' => { 'footer' => 'single', 'children' => 'multiple' }
  }.freeze
  TEXT = { 'props' => { 'type' => 'object', 'properties' => { 'text' => { 'type' => 'string' } } } }.freeze

  class RecordingAgent < CopilotKit::Agent
    attr_reader :inputs
    def initialize(events)
      super(description: 'Recording agent')
      @events = events
      @inputs = []
    end
    def each_event(input)
      @inputs << input
      @events.each { |event| yield event }
    end
  end

  def envelope(transport: 'tool', components: nil, surfaces: nil, **extensions)
    catalog = { 'catalogId' => 'shop', 'protocolVersion' => '1.0', 'functions' => {} }
    catalog['components'] = components || { 'ProductCard' => PRODUCT_CARD, 'Text' => TEXT } unless components == false
    { 'copilotkit' => { 'ui' => {
      '1.0' => { 'supportedCatalogIds' => ['shop'], 'inlineCatalogs' => [catalog] },
      'metadata' => { 'extensions' => {
        'copilotkit_format' => 3, 'copilotkit_transport' => transport,
        'copilotkit_targets' => [{ 'id' => 'chat', 'kind' => 'chat' }, { 'id' => 'side', 'kind' => 'inline', 'components' => ['Text'] }],
        'copilotkit_surfaces' => surfaces || {}, 'copilotkit_contextSent' => false
      }.merge(extensions.transform_keys(&:to_s)) }
    } } }
  end

  def op(operation)
    { 'version' => '1.0' }.merge(operation)
  end

  def render_call(call_id, *chunks)
    [{ 'type' => 'TOOL_CALL_START', 'toolCallId' => call_id, 'toolCallName' => 'render_ui' }] +
      chunks.map { |chunk| { 'type' => 'TOOL_CALL_ARGS', 'toolCallId' => call_id, 'delta' => chunk } } +
      [{ 'type' => 'TOOL_CALL_END', 'toolCallId' => call_id }]
  end

  # Runs events through render_ui the way UIAgent does: RUN_FINISHED is held to the end.
  def render(events, forwarded = nil, messages = [])
    manifest = GUI.read_tool_manifest(forwarded || envelope)
    refute_nil manifest
    surfaces = GUI::Middleware.new(manifest).start('messages' => messages)
    output = []
    terminal = nil
    events.each do |event|
      if event['type'] == 'RUN_FINISHED'
        terminal = event
        surfaces.finishing
      else
        output.concat(surfaces.handle(event))
      end
    end
    output.concat(surfaces.complete(!terminal.nil?))
    output << terminal if terminal
    output
  end

  def test_prepare_adds_one_render_tool_and_guide_without_mutating_input
    manifest = GUI.read_tool_manifest(envelope)
    input = { 'tools' => [{ 'name' => 'render_ui', 'description' => 'stale' }, { 'name' => 'search' }],
              'context' => [{ 'description' => GUI::CONTEXT_DESCRIPTION, 'value' => 'stale' }] }
    original = Marshal.load(Marshal.dump(input))
    prepared = GUI::Middleware.new(manifest).prepare(input)
    assert_equal original, input
    assert_equal %w[search render_ui], prepared['tools'].map { |tool| tool['name'] }
    assert_equal %w[chat side], prepared['tools'][1].dig('parameters', 'properties', 'target', 'enum')
    assert_equal 1, prepared['context'].length
    guide = prepared['context'][0]
    assert_equal GUI::CONTEXT_DESCRIPTION, guide['description']
    assert_includes guide['value'], '- "side" (a named area of the app; only Text)'
    assert_includes guide['value'], '  props: {"type":"object","properties":{"name":{"type":"string"}'
    assert_includes guide['value'], '  slot props (component ids): {"footer":"single","children":"multiple"}'
  end

  def test_guide_includes_feature_rules_only_when_the_catalog_uses_them
    with_events = GUI.build_prompt(GUI.read_tool_manifest(envelope))
    plain = GUI.build_prompt(GUI.read_tool_manifest(envelope(components: { 'Text' => TEXT })))
    assert_includes with_events, 'Event props take an action:'
    assert_includes with_events, 'give a multiple slot a template'
    refute_includes plain, 'Event props take an action'
    refute_includes plain, 'give a multiple slot a template'
  end

  def test_guide_lists_existing_surfaces_with_user_values_and_rejections
    surfaces = { 'cart' => { 'target' => 'chat', 'dataModel' => { 'qty' => 2 }, 'rejected' => ['operation 1: bad'] },
                 'old' => { 'target' => 'chat', 'status' => 'deleted' } }
    guide = GUI.build_prompt(GUI.read_tool_manifest(envelope(surfaces: surfaces)))
    assert_includes guide, %(- "cart" (target "chat")\n  user values: {"qty":2}\n  rejected: operation 1: bad)
    assert_includes guide, '- "old" (target "chat", deleted: never use this id again)'
    assert_includes guide, 'User values are what the user entered'
  end

  def test_runs_without_a_tool_catalog_pass_through
    malformed = { 'copilotkit' => { 'ui' => envelope['copilotkit']['ui'].merge('1.0' => {}) } }
    [envelope(transport: 'markdown'), envelope(components: false), malformed, {}].each do |forwarded|
      assert_nil GUI.read_tool_manifest(forwarded)
    end
  end

  def test_streamed_operations_create_then_patch_one_surface
    create = op('createSurface' => { 'surfaceId' => 'card', 'catalogId' => 'unknown',
                                     'components' => [{ 'id' => 'root', 'component' => 'ProductCard', 'name' => 'A', 'footer' => 't' }] })
    update = op('updateComponents' => { 'surfaceId' => 'card', 'components' => [{ 'id' => 't', 'component' => 'Text' }] })
    invalid = op('updateComponents' => { 'surfaceId' => 'card', 'components' => [{ 'id' => 'x', 'component' => 'Nope' }] })
    args = JSON.generate('target' => 'chat', 'operations' => [create, update, invalid])
    events = render(render_call('call', args[0, 60], args[60..-1]) + [{ 'type' => 'RUN_FINISHED' }])
    snapshots = events.select { |event| event['type'] == 'ACTIVITY_SNAPSHOT' }
    assert_equal 1, snapshots.length
    assert_equal 'genui:card', snapshots[0]['messageId']
    # The model does not pick the catalog: an unlisted id gets the run's catalog.
    assert_equal 'shop', snapshots[0].dig('content', 'catalogId')
    assert_equal 'shop', snapshots[0].dig('content', 'operations', 0, 'createSurface', 'catalogId')
    rejection = { 'index' => 2, 'reason' => 'component "x": unknown component "Nope"' }
    assert_equal [
      [{ 'op' => 'add', 'path' => '/operations/-', 'value' => update }],
      [{ 'op' => 'add', 'path' => '/rejected/-', 'value' => rejection }],
      [{ 'op' => 'replace', 'path' => '/status', 'value' => 'ready' }]
    ], events.select { |event| event['type'] == 'ACTIVITY_DELTA' }.map { |event| event['patch'] }
    result, finished = events[-2..-1]
    assert_equal 'RUN_FINISHED', finished['type']
    assert_equal 'TOOL_CALL_RESULT', result['type']
    assert_equal({ 'status' => 'rendered', 'applied' => 2, 'calls' => 0, 'rejected' => [rejection] }, JSON.parse(result['content']))
  end

  def test_operations_wait_for_a_late_target_and_respect_its_components
    args = JSON.generate('operations' => [
      op('createSurface' => { 'surfaceId' => 'panel' }),
      op('updateComponents' => { 'surfaceId' => 'panel', 'components' => [{ 'id' => 'root', 'component' => 'ProductCard', 'name' => 'A' }] })
    ], 'target' => 'side')
    events = render(render_call('call', args) + [{ 'type' => 'RUN_FINISHED' }])
    snapshots = events.select { |event| event['type'] == 'ACTIVITY_SNAPSHOT' }
    assert_equal ['side'], snapshots.map { |event| event.dig('content', 'target') }
    assert_equal [{ 'index' => 1, 'reason' => 'component "root": "ProductCard" is not allowed in target "side"; use one of: Text' }],
                 JSON.parse(events[-2]['content'])['rejected']
  end

  def test_operations_sent_as_a_string_are_recovered
    operations = JSON.generate([op('createSurface' => { 'surfaceId' => 'late' })])
    events = render(render_call('call', JSON.generate('target' => 'chat', 'operations' => operations)) + [{ 'type' => 'RUN_FINISHED' }])
    assert_equal ['genui:late'], events.select { |event| event['type'] == 'ACTIVITY_SNAPSHOT' }.map { |event| event['messageId'] }
  end

  def test_answered_calls_get_no_result_and_empty_calls_report_an_error
    events = render(render_call('empty', '{"target":"chat"}') + render_call('answered', '{"target":"chat","operations":[]}') +
                 [{ 'type' => 'TOOL_CALL_RESULT', 'toolCallId' => 'answered', 'content' => 'ok' }, { 'type' => 'RUN_FINISHED' }])
    results = events.select { |event| event['type'] == 'TOOL_CALL_RESULT' }
    assert_equal %w[answered empty], results.map { |result| result['toolCallId'] }
    assert_equal 'error', JSON.parse(results[1]['content'])['status']
    assert_equal 'RUN_FINISHED', events[-1]['type']
  end

  def test_existing_and_deleted_surfaces_follow_the_client_summary
    surfaces = { 'live' => { 'target' => 'chat' }, 'gone' => { 'target' => 'chat', 'status' => 'deleted' } }
    args = JSON.generate('target' => 'chat', 'operations' => [
      op('updateDataModel' => { 'surfaceId' => 'live', 'path' => '/x', 'value' => 1 }),
      op('createSurface' => { 'surfaceId' => 'gone' }),
      op('createSurface' => { 'surfaceId' => 'live' })
    ])
    events = render(render_call('call', args) + [{ 'type' => 'RUN_FINISHED' }], envelope(surfaces: surfaces))
    assert_equal ['surface id "gone" was used before; use a new surfaceId', 'surface "live" already exists'],
                 JSON.parse(events[-2]['content'])['rejected'].map { |entry| entry['reason'] }
    first_patch = events.find { |event| event['type'] == 'ACTIVITY_DELTA' }['patch']
    # The first touch of an existing surface marks it streaming and clears old rejections.
    assert_equal [{ 'op' => 'replace', 'path' => '/status', 'value' => 'streaming' }, { 'op' => 'replace', 'path' => '/rejected', 'value' => [] }], first_patch[0, 2]
  end

  def test_validation_rejects_components_with_the_typescript_reasons
    manifest = GUI.read_tool_manifest(envelope)
    [
      [{ 'id' => 'a', 'component' => 'Text', 'text' => { 'path' => '/x' } }, 'component "a": text: bind data with {"@path": "/x"}, not {"path": "/x"}'],
      [{ 'id' => 'a', 'component' => 'Text', 'size' => 1 }, 'component "a": unknown prop "size"'],
      [{ 'id' => 'a', 'component' => 'ProductCard' }, 'component "a": missing required prop "name"'],
      [{ 'id' => 'a', 'component' => 'ProductCard', 'name' => 'x', 'footer' => 'a' }, 'component "a": footer: a component cannot be its own child'],
      [{ 'id' => 'a', 'component' => 'ProductCard', 'name' => 'x', 'onBuy' => { 'event' => 'buy' } }, 'component "a": onBuy: event.name is required'],
      [{ 'id' => 'a', 'component' => 'Text', 'text' => { '@call' => 'openUrl' } },
       'component "a": text: "openUrl" runs only from an event; a data prop can call only @index and the built-in functions ' \
       '(required, regex, length, numeric, email, formatString, formatNumber, formatCurrency, formatDate, pluralize, and, or, not, calc, series)'],
      [{ 'id' => 'a', 'component' => 'ProductCard', 'name' => 'x', 'children' => { 'componentId' => 'b', 'path' => '/__proto__' } },
       'component "a": children: path segment "__proto__" is not allowed in template path'],
      [{ 'id' => 'a', 'component' => 'ProductCard', 'name' => 'x', 'children' => { 'componentId' => 'b', 'path' => '/' } },
       'component "a": children: template path must not contain empty segments']
    ].each do |component, reason|
      operation = op('updateComponents' => { 'surfaceId' => 's', 'components' => [component] })
      assert_equal reason, GUI.validate_operation(operation, manifest, Set.new(['s']), nil, {})
    end
  end

  def test_validation_requires_an_existing_surface_and_a_value
    manifest = GUI.read_tool_manifest(envelope)
    assert_equal 'surface "s" does not exist; send createSurface first', GUI.validate_operation(op('deleteSurface' => { 'surfaceId' => 's' }), manifest, Set.new)
    assert_equal 'updateDataModel.value is required; use "value":null to delete', GUI.validate_operation(op('updateDataModel' => { 'surfaceId' => 's' }), manifest, Set.new(['s']))
    assert_equal 'operation needs "version":"1.0"', GUI.validate_operation({ 'deleteSurface' => { 'surfaceId' => 's' } }, manifest, Set.new(['s']))
  end

  def test_generative_ui_runs_follow_option_transport_and_agent_scope
    [
      [nil, envelope, true], [nil, {}, false], [true, {}, true], [true, envelope(transport: 'markdown'), false],
      [false, envelope, false], [{}, {}, true], [{ 'agents' => ['other'] }, envelope, false]
    ].each do |option, forwarded, expected|
      assert_equal expected, GUI.generative_ui_run?(option, 'default', forwarded), "option #{option.inspect}"
    end
  end

  def test_a2ui_version_and_info_resolve_per_agent
    option = { 'a2uiVersion' => { 'legacy' => '0.9' }, 'agents' => %w[legacy current] }
    assert_equal '0.9', GUI.resolve_a2ui_version(option, 'legacy')
    assert_equal '1.0', GUI.resolve_a2ui_version(option, 'current')
    assert_equal '1.0', GUI.resolve_a2ui_version(true, 'legacy')
    assert_equal({ 'enabled' => true, 'agents' => %w[legacy current] }, GUI.info(option))
    assert_equal({ 'enabled' => true }, GUI.info(nil))
    assert_equal({ 'enabled' => false }, GUI.info(false))
    assert_raises(ArgumentError) { GUI.validate_option!('a2uiVersion' => '2.0') }
    assert_raises(ArgumentError) { GUI.validate_option!('injectA2UITool' => '') }
    assert_raises(ArgumentError) { GUI.validate_option!('yes') }
  end

  def test_a2ui_middleware_config_is_full_for_v09_and_extraction_only_for_v10
    option = { 'agents' => ['default'], 'a2uiVersion' => '0.9', 'schema' => { 'components' => {} }, 'defaultCatalogId' => 'app' }
    assert_equal({ 'schema' => { 'components' => {} }, 'defaultCatalogId' => 'app', 'injectA2UITool' => true }, GUI.a2ui_middleware_config(option, '0.9', envelope))
    assert_equal false, GUI.a2ui_middleware_config(option, '0.9', {})['injectA2UITool']
    assert_equal 'mine', GUI.a2ui_middleware_config(option.merge('injectA2UITool' => 'mine'), '0.9', envelope)['injectA2UITool']
    assert_equal({}, GUI.a2ui_middleware_config(option, '1.0', envelope))
  end

  def test_args_stream_reads_target_and_operations_across_chunks
    stream = GUI::ArgsStream.new
    assert_equal [nil, []], stream.push('{"target":"ch')
    assert_equal ['chat', [{ 'a' => '}' }]], stream.push('at","operations":[{"a":"}"},')
    target, fresh = stream.push('[1],{"b":2}')
    assert_equal ['chat', [{ 'b' => 2 }]], [target, fresh]
    stream.push(',{"c":')
    assert stream.incomplete_operation?
  end

  def build_runtime(agent, generative_ui)
    CopilotKit::Runtime.new(api_key: 'secret', api_url: 'http://127.0.0.1:1', identify_user: ->(_) { { 'id' => 'user' } },
      telemetry: CopilotKit::Telemetry.new(disabled: true), agents: { 'default' => agent }, generative_ui: generative_ui)
  end

  def info(runtime)
    _, _, chunks = runtime.call('REQUEST_METHOD' => 'GET', 'PATH_INFO' => '/info', 'QUERY_STRING' => '', 'rack.input' => StringIO.new(''))
    JSON.parse(chunks.join)
  end

  def test_info_reports_generative_ui_instead_of_a2ui
    body = info(build_runtime(RecordingAgent.new([]), 'agents' => ['default']))
    assert_equal({ 'enabled' => true, 'agents' => ['default'] }, body['generativeUI'])
    refute body.key?('a2uiEnabled')
    refute body.key?('a2ui')
    assert_equal({ 'enabled' => false }, info(build_runtime(RecordingAgent.new([]), false))['generativeUI'])
    assert_raises(ArgumentError) { build_runtime(RecordingAgent.new([]), 'a2uiVersion' => '2.0') }
  end

  def test_each_agent_version_gets_its_own_render_tool
    input = { 'messages' => [], 'tools' => [], 'context' => [], 'forwardedProps' => envelope }
    current = RecordingAgent.new([{ 'type' => 'RUN_FINISHED' }])
    CopilotKit::UIAgent.new(agent: current).each_event(input) { |_| }
    assert_equal ['render_ui'], current.inputs[0]['tools'].map { |tool| tool['name'] }
    refute current.inputs[0]['context'].any? { |entry| entry['description'].start_with?('A2UI') }

    legacy = RecordingAgent.new([{ 'type' => 'RUN_FINISHED' }])
    CopilotKit::UIAgent.new(agent: legacy, generative_ui: { 'a2uiVersion' => '0.9' }).each_event(input) { |_| }
    agent_input = legacy.inputs[0]
    assert_equal ['render_a2ui'], agent_input['tools'].map { |tool| tool['name'] }
    refute agent_input['context'].any? { |entry| entry['description'] == GUI::CONTEXT_DESCRIPTION }
    schema = agent_input['context'].find { |entry| entry['description'].start_with?('A2UI Comp') }
    assert_equal %w[ProductCard Text], JSON.parse(schema['value'])['components'].keys
  end

  def test_v09_render_call_reaches_the_browser_as_a_v10_surface
    agent = RecordingAgent.new([
      { 'type' => 'TOOL_CALL_START', 'toolCallId' => 'call', 'toolCallName' => 'render_a2ui' },
      { 'type' => 'TOOL_CALL_ARGS', 'toolCallId' => 'call', 'delta' => JSON.generate('surfaceId' => 'card', 'components' => [{ 'id' => 'root', 'component' => 'Text', 'text' => 'Hi' }]) },
      { 'type' => 'RUN_FINISHED' }
    ])
    events = []
    CopilotKit::UIAgent.new(agent: agent, generative_ui: { 'a2uiVersion' => '0.9' }).each_event('messages' => [], 'forwardedProps' => envelope) { |event| events << event }
    refute events.any? { |event| event['activityType'] == 'a2ui-surface' }
    snapshots = events.select { |event| event['type'] == 'ACTIVITY_SNAPSHOT' }
    assert_equal 1, snapshots.length
    assert_equal 'genui:card', snapshots[0]['messageId']
    assert_equal '0.9', snapshots[0].dig('content', 'a2uiSourceVersion')
    assert_equal 'shop', snapshots[0].dig('content', 'catalogId')
    assert_equal %w[TOOL_CALL_RESULT RUN_FINISHED], events[-2..-1].map { |event| event['type'] }
  end

  def test_render_ui_surfaces_reach_the_browser_unchanged_by_the_v09_bridge
    args = JSON.generate('target' => 'chat', 'operations' => [op('createSurface' => { 'surfaceId' => 'card', 'components' => [{ 'id' => 'root', 'component' => 'Text', 'text' => 'Hi' }] })])
    agent = RecordingAgent.new(render_call('call', args) + [{ 'type' => 'RUN_FINISHED' }])
    events = []
    CopilotKit::UIAgent.new(agent: agent).each_event('messages' => [], 'forwardedProps' => envelope) { |event| events << event }
    snapshot = events.find { |event| event['type'] == 'ACTIVITY_SNAPSHOT' }
    assert_equal 'generative-ui-surface', snapshot['activityType']
    refute snapshot['content'].key?('a2uiSourceVersion')
    assert_equal %w[TOOL_CALL_RESULT RUN_FINISHED], events[-2..-1].map { |event| event['type'] }
  end
end
