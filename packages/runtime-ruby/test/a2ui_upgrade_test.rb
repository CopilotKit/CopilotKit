# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'copilotkit/runtime'

class A2UIUpgradeTest < Minitest::Test
  UP = CopilotKit::A2UIUpgrade
  BASIC = 'https://a2ui.org/specification/v0_9/basic_catalog.json'
  STANDARD = 'copilotkit/standard@1'
  SCHEMA = CopilotKit::A2UI::SCHEMA_CONTEXT
  PLAN_V09 = [
    { 'version' => 'v0.9', 'createSurface' => { 'surfaceId' => 'plans', 'catalogId' => BASIC } },
    { 'version' => 'v0.9', 'updateComponents' => { 'surfaceId' => 'plans', 'components' => [
      { 'id' => 'root', 'component' => 'Column', 'children' => %w[title choose] },
      { 'id' => 'title', 'component' => 'Text', 'text' => { 'path' => '/title' } },
      { 'id' => 'choose', 'component' => 'Button', 'child' => 'label',
        'action' => { 'event' => { 'name' => 'choose', 'context' => { 'plan' => { 'path' => '/plan' } } } } }
    ] } },
    { 'version' => 'v0.9', 'updateDataModel' => { 'surfaceId' => 'plans', 'path' => '/', 'value' => {} } }
  ].freeze

  def test_v09_operations_convert_to_v10
    operations, dropped = UP.upgrade_operations(PLAN_V09)
    assert_equal [], dropped
    assert_equal [
      { 'version' => '1.0', 'createSurface' => { 'surfaceId' => 'plans', 'catalogId' => STANDARD } },
      { 'version' => '1.0', 'updateComponents' => { 'surfaceId' => 'plans', 'components' => [
        { 'id' => 'root', 'component' => 'Column', 'children' => %w[title choose] },
        { 'id' => 'title', 'component' => 'Text', 'text' => { '@path' => '/title' } },
        { 'id' => 'choose', 'component' => 'Button', 'child' => 'label',
          'onClick' => { 'event' => { 'name' => 'choose', 'context' => { 'plan' => { '@path' => '/plan' } } } } }
      ] } },
      { 'version' => '1.0', 'updateDataModel' => { 'surfaceId' => 'plans', 'path' => '/', 'value' => {} } }
    ], operations
  end

  def test_basic_catalog_props_take_their_standard_catalog_form
    components = [
      { 'id' => 'h', 'component' => 'Text', 'variant' => 'h1', 'weight' => 'bold', 'text' => 'T' },
      { 'id' => 'c', 'component' => 'Text', 'variant' => 'caption', 'weight' => 'bold', 'text' => 'c' },
      { 'id' => 'b', 'component' => 'Text', 'variant' => 'body', 'text' => 'b' },
      { 'id' => 'f', 'component' => 'TextField', 'value' => { 'path' => '/email' }, 'validationRegexp' => '@' },
      { 'id' => 'n', 'component' => 'Text', 'text' => { 'call' => 'formatNumber', 'args' => { 'value' => 1 } } }
    ]
    operations, = UP.upgrade_operations([{ 'updateComponents' => { 'surfaceId' => 's', 'components' => components } }])
    converted = operations[0]['updateComponents']['components']
    assert_equal [
      { 'id' => 'h', 'component' => 'Title', 'text' => 'T', 'size' => '2xl' },
      { 'id' => 'c', 'component' => 'Caption', 'text' => 'c' },
      { 'id' => 'b', 'component' => 'Text', 'text' => 'b' },
      { 'id' => 'f', 'component' => 'TextField', 'value' => { '@path' => '/email' },
        'checks' => [{ 'condition' => { '@call' => 'regex', 'args' => { 'value' => { '@path' => '/email' }, 'pattern' => '@' } } }] },
      { 'id' => 'n', 'component' => 'Text', 'text' => { '@call' => 'formatNumber', 'args' => { 'value' => 1 } } }
    ], converted
    # Key order is part of the byte-identical output.
    assert_equal %w[id component text size], converted[0].keys
  end

  def test_left_out_values_remove_and_unconvertible_operations_are_dropped
    operations, dropped = UP.upgrade_operations([
      { 'version' => 'v0.9', 'updateDataModel' => { 'surfaceId' => 's', 'path' => 'items' } },
      { 'version' => 'v0.9', 'updateDataModel' => { 'surfaceId' => 's' } },
      { 'version' => '1.0', 'deleteSurface' => { 'surfaceId' => 's' } },
      { 'version' => 'v0.8', 'deleteSurface' => { 'surfaceId' => 's' } },
      { 'version' => 'v0.9', 'updateDataModel' => { 'surfaceId' => 's', 'path' => '/', 'value' => 3 } },
      { 'version' => 'v0.9', 'updateComponents' => { 'surfaceId' => 's', 'components' => [{ 'id' => 'x' }] } }
    ])
    assert_equal [{ 'surfaceId' => 's', 'path' => '/items', 'value' => nil }, { 'surfaceId' => 's', 'path' => '/', 'value' => {} }],
                 operations[0, 2].map { |operation| operation['updateDataModel'] }
    assert_equal({ 'version' => '1.0', 'deleteSurface' => { 'surfaceId' => 's' } }, operations[2])
    assert_equal [
      'unsupported A2UI version "v0.8"; only v0.9 operations are converted',
      'a root updateDataModel value must be a JSON object in A2UI 1.0',
      'component "x": the component type must be a string (the v0.9 flat format)'
    ], dropped.map { |(_, reason)| reason }
  end

  def activity(message_id, operations, kind = 'ACTIVITY_SNAPSHOT')
    { 'type' => kind, 'messageId' => message_id, 'activityType' => 'a2ui-surface', 'content' => { 'a2ui_operations' => operations }, 'replace' => true }
  end

  def test_upgrader_sends_one_cumulative_surface_per_surface_id
    upgrader = UP::ActivityUpgrader.new
    assert_equal [], upgrader.transform(activity('m', []).merge('content' => { 'status' => 'building' }))
    first = upgrader.transform(activity('m', PLAN_V09[0, 2]))
    assert_equal 1, first.length
    assert_equal 'genui:plans', first[0]['messageId']
    assert_equal 'ready', first[0].dig('content', 'status')
    assert_equal '0.9', first[0].dig('content', 'a2uiSourceVersion')
    patch = [{ 'op' => 'add', 'path' => '/a2ui_operations/-', 'value' => PLAN_V09[2] }]
    second = upgrader.transform('type' => 'ACTIVITY_DELTA', 'messageId' => 'm', 'activityType' => 'a2ui-surface', 'patch' => patch)
    assert_equal 3, second[0].dig('content', 'operations').length
    # Unchanged content is not sent again; a patch that does not apply is skipped.
    assert_equal [], upgrader.transform(activity('m', PLAN_V09))
    bad = [{ 'op' => 'replace', 'path' => '/missing/x', 'value' => 1 }]
    assert_equal [], upgrader.transform(activity('m', []).merge('type' => 'ACTIVITY_DELTA', 'patch' => bad))
    other = { 'type' => 'ACTIVITY_SNAPSHOT', 'activityType' => 'mcp-apps', 'content' => {} }
    assert_equal [other], upgrader.transform(other)
  end

  def test_upgrader_appends_updates_of_a_surface_from_an_earlier_run
    upgrader = UP::ActivityUpgrader.new
    update = { 'version' => 'v0.9', 'updateDataModel' => { 'surfaceId' => 'old', 'path' => '/a', 'value' => 1 } }
    deltas = upgrader.transform(activity('m', [update, { 'updateComponents' => { 'surfaceId' => 'old' } }]))
    assert_equal 1, deltas.length
    assert_equal 'ACTIVITY_DELTA', deltas[0]['type']
    assert_equal 'genui:old', deltas[0]['messageId']
    assert_equal [
      { 'op' => 'add', 'path' => '/operations/-', 'value' => { 'version' => '1.0', 'updateDataModel' => { 'surfaceId' => 'old', 'path' => '/a', 'value' => 1 } } },
      { 'op' => 'replace', 'path' => '/rejected', 'value' => [{ 'index' => 1, 'reason' => 'updateComponents.components must be a non-empty array' }] }
    ], deltas[0]['patch']
  end

  def test_json_patch_applies_rfc6902_operations_and_rejects_bad_paths
    result = UP.apply_json_patch({ 'a' => [1, 2], 'b' => { 'c' => 1 } }, [
      { 'op' => 'add', 'path' => '/a/1', 'value' => 9 },
      { 'op' => 'remove', 'path' => '/a/0' },
      { 'op' => 'move', 'from' => '/b/c', 'path' => '/d' },
      { 'op' => 'copy', 'from' => '/d', 'path' => '/a/-' },
      { 'op' => 'test', 'path' => '/a', 'value' => [9, 2, 1] }
    ])
    assert_equal({ 'a' => [9, 2, 1], 'b' => {}, 'd' => 1 }, result)
    [
      [{ 'op' => 'replace', 'path' => '/x', 'value' => 1 }],
      [{ 'op' => 'add', 'path' => '/__proto__', 'value' => 1 }],
      [{ 'op' => 'add', 'path' => '/a/9', 'value' => 1 }],
      [{ 'op' => 'test', 'path' => '/d', 'value' => 2 }]
    ].each do |patch|
      assert_raises(UP::PatchError) { UP.apply_json_patch(Marshal.load(Marshal.dump(result)), patch) }
    end
  end

  FUNCTIONS = {
    'pick' => { 'description' => 'Pick with {"@path": "/id"}', 'parameters' => { 'type' => 'object', 'properties' => { 'id' => { 'type' => 'string' } } } },
    'secret' => { 'allowedCallers' => 'agentOnly', 'parameters' => { 'type' => 'object' } }
  }.freeze
  BUTTON = { 'props' => { 'type' => 'object', 'properties' => { 'label' => { 'type' => 'string' } } },
             'events' => { 'onClick' => { 'description' => 'Clicked', 'parameters' => {} } } }.freeze
  TITLE = { 'props' => { 'type' => 'object', 'properties' => { 'text' => { 'type' => 'string' } } } }.freeze
  CARD = {
    'description' => 'Bind with {"@path": "/x"}',
    'props' => { 'type' => 'object', 'properties' => {
      'name' => { 'type' => 'string', 'description' => 'Its name' },
      'tags' => { 'type' => 'array', 'items' => { 'type' => 'string' } },
      'size' => { 'type' => 'string', 'enum' => %w[sm lg] }
    }, 'required' => ['name'] },
    'slots' => { 'footer' => 'single' },
    'parameterOrder' => ['footer']
  }.freeze
  CLICK = { 'version' => '1.0', 'action' => { 'name' => 'confirm', 'surfaceId' => 'card', 'sourceComponentId' => 'button',
                                              'timestamp' => '2026-10-20T10:00:00.000Z', 'context' => { 'selected' => 2 } } }.freeze
  USER_ACTION = { 'name' => 'confirm', 'surfaceId' => 'card', 'sourceComponentId' => 'button', 'context' => { 'selected' => 2 },
                  'timestamp' => '2026-10-20T10:00:00.000Z' }.freeze
  HISTORY = [{ 'id' => '1', 'role' => 'user', 'content' => 'Hi' }, { 'id' => '2', 'role' => 'user', 'content' => 'Ok' }].freeze

  def ui(surfaces: nil, action: nil, components: nil, ids: ['shop'])
    extensions = { 'copilotkit_format' => 3, 'copilotkit_transport' => 'tool', 'copilotkit_targets' => [{ 'id' => 'chat', 'kind' => 'chat' }],
                   'copilotkit_surfaces' => surfaces || {}, 'copilotkit_contextSent' => false }
    extensions['copilotkit_action'] = action if action
    catalog = { 'catalogId' => ids[0], 'protocolVersion' => '1.0', 'functions' => FUNCTIONS }
    catalog['components'] = components unless components.nil?
    { 'copilotkit' => { 'ui' => { '1.0' => { 'supportedCatalogIds' => ids, 'inlineCatalogs' => [catalog] }, 'metadata' => { 'extensions' => extensions } } } }
  end

  def test_click_reaches_a_v09_agent_as_its_action_without_the_message
    input = { 'messages' => HISTORY, 'forwardedProps' => ui(action: CLICK) }
    original = Marshal.load(Marshal.dump(input))
    agent_input = UP.downgrade_action(input, '0.9')
    assert_equal original, input
    assert_equal HISTORY[0, 1], agent_input['messages']
    assert_equal({ 'userAction' => USER_ACTION }, agent_input['forwardedProps']['a2uiAction'])
    assert_equal USER_ACTION.keys, agent_input['forwardedProps']['a2uiAction']['userAction'].keys
    assert_same input, UP.downgrade_action(input, '1.0')
  end

  def test_surface_origin_decides_before_the_agent_version
    [['0.9', '1.0', true], ['1.0', '0.9', false]].each do |source, agent_version, converted|
      activity_message = { 'id' => 'a', 'role' => 'activity', 'activityType' => 'generative-ui-surface',
                           'content' => { 'surfaceId' => 'card', 'a2uiSourceVersion' => source } }
      from_message = { 'messages' => [activity_message] + HISTORY, 'forwardedProps' => ui(action: CLICK) }
      from_summary = { 'messages' => HISTORY, 'forwardedProps' => ui(action: CLICK, surfaces: { 'card' => { 'target' => 'chat', 'a2uiSourceVersion' => source } }) }
      [from_message, from_summary].each do |input|
        assert_equal converted, UP.downgrade_action(input, agent_version)['forwardedProps'].key?('a2uiAction')
      end
    end
  end

  def test_an_existing_v09_action_is_kept
    input = { 'messages' => HISTORY, 'forwardedProps' => ui(action: CLICK).merge('a2uiAction' => { 'userAction' => { 'name' => 'old' } }) }
    assert_same input, UP.downgrade_action(input, '0.9')
  end

  def schema_of(context)
    JSON.parse(context.find { |entry| entry['description'] == SCHEMA }['value'])
  end

  def test_standard_catalog_becomes_the_basic_catalog_plus_custom_components
    catalog_id, context = UP.build_catalog_context('forwardedProps' => ui(components: { 'Button' => BUTTON, 'Title' => TITLE, 'ProductCard' => CARD }, ids: ['app', STANDARD]))
    assert_equal BASIC, catalog_id
    schema = schema_of(context)
    # Title is a standard component that v0.9 never had; Button keeps its v0.9 prop name.
    assert_equal %w[Button ProductCard], schema['components'].keys
    assert_equal %w[component label action], schema['components']['Button']['allOf'][1]['properties'].keys
    card = schema['components']['ProductCard']
    assert_equal 'Bind with {"path": "/x"}', card['description']
    assert_equal({
      'component' => { 'const' => 'ProductCard' },
      'footer' => { '$ref' => 'common_types.json#/$defs/ComponentId' },
      'name' => { '$ref' => 'common_types.json#/$defs/DynamicString', 'description' => 'Its name' },
      'tags' => { '$ref' => 'common_types.json#/$defs/DynamicStringList' },
      'size' => { 'anyOf' => [{ 'type' => 'string', 'enum' => %w[sm lg] }, { '$ref' => 'common_types.json#/$defs/DataBinding' }, { '$ref' => 'common_types.json#/$defs/FunctionCall' }] }
    }, card['allOf'][1]['properties'])
    assert_equal %w[component footer name tags size], card['allOf'][1]['properties'].keys
    assert_equal %w[component name], card['allOf'][1]['required']
    names = schema['functions'].map { |fn| fn['name'] }
    assert_equal 'pick', names.last
    refute_includes names, 'secret'
    refute_includes names, 'calc'
    assert_equal 'boolean', schema['functions'].find { |fn| fn['name'] == 'email' }['returnType']
    assert_equal "Available A2UI catalog:\n- #{BASIC}\n  Custom catalog (does NOT include all basic components).\n  Custom components:\n  - ProductCard", context[0]['value']
  end

  def test_a_custom_catalog_keeps_its_id_and_a_catalog_without_schemas_only_names_it
    catalog_id, context = UP.build_catalog_context('forwardedProps' => ui(components: { 'Title' => TITLE }))
    assert_equal 'shop', catalog_id
    assert_equal ['Title'], schema_of(context)['components'].keys
    assert_equal 4, context.length
    assert_equal ['shop', [{ 'description' => 'A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.',
                             'value' => "Available A2UI catalog:\n- shop" }]], UP.build_catalog_context('forwardedProps' => ui)
    assert_nil UP.build_catalog_context('forwardedProps' => {})
  end

  def test_v09_agent_input_replaces_the_client_schema_entry
    input = { 'messages' => [], 'context' => [{ 'description' => SCHEMA, 'value' => '{}' }, { 'description' => 'x' }],
              'forwardedProps' => ui(components: { 'ProductCard' => CARD }) }
    agent_input = UP.prepare_agent_input(input, '0.9')
    descriptions = agent_input['context'].map { |entry| entry['description'] }
    assert_equal 1, descriptions.count(SCHEMA)
    assert_equal 'x', descriptions[0]
    assert_equal 'shop', schema_of(agent_input['context'])['catalogId']
    assert_same input, UP.prepare_agent_input(input, '1.0')
  end

  def test_args_schema_from_signature_maps_types_to_dynamic_refs
    assert_equal({
      'type' => 'object',
      'properties' => { 'value' => { '$ref' => 'common_types.json#/$defs/DynamicString' }, 'min' => { '$ref' => 'common_types.json#/$defs/DynamicNumber' } },
      'required' => ['value'],
      'additionalProperties' => { '$ref' => 'common_types.json#/$defs/DynamicValue' }
    }, UP.args_schema_from_signature('{ value: string; min?: number; [k: string]: unknown }'))
  end
end
