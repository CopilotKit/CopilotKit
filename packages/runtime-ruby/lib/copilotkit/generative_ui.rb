# frozen_string_literal: true
require 'json'
require 'securerandom'
require 'set'

module CopilotKit
  # Generative UI (A2UI 1.0): the render_ui tool, its guide, and validated surface events.
  #
  # Ports `generative-ui-middleware.ts` of the TypeScript runtime and the shared helpers it
  # uses (`a2ui-envelope.ts`, `validate-operation.ts`, `render-ui-args.ts`, `prompt.ts`).
  # The browser sends its catalog in `forwardedProps.copilotkit.ui`; nothing in it is trusted.
  module GenerativeUI
    A2UI_VERSION = '1.0'
    ACTIVITY_TYPE = 'generative-ui-surface'
    RENDER_TOOL = 'render_ui'
    CHAT_TARGET = 'chat'
    CONTEXT_DESCRIPTION = 'Generative UI guide: available components, functions, targets, and how to call render_ui.'
    STANDARD_CATALOG_ID = 'copilotkit/standard@1'
    COMPONENT_ID_REF = 'common_types.json#/$defs/ComponentId'
    CHILD_LIST_REF = 'common_types.json#/$defs/ChildList'
    # The agent may not call renderer functions yet (`GENERATIVE_UI_AGENT_FUNCTION_CALLS`).
    AGENT_FUNCTION_CALLS_OFF_REASON = 'callRendererFunction is not supported in this version: the agent cannot call renderer ' \
                                      'functions until their results can be sent back to it reliably'
    ENVELOPE_FORMAT = 3
    MAX_TARGET_COMPONENTS = 100
    MAX_SUMMARY_REJECTIONS = 20
    MAX_REJECTION_LENGTH = 500
    MAX_USER_VALUES_LENGTH = 500
    VERSIONS = %w[0.9 1.0].freeze
    # Marks a key that is not present, as distinct from a present `null`.
    UNSET = Object.new.freeze

    # A function of the A2UI basic catalog (or a CopilotKit addition), callable by the UI.
    BasicFunction = Struct.new(:description, :parameters, :return_type, :requires_user_activation)

    A2UI_BASIC_FUNCTIONS = {
      'required' => BasicFunction.new('Valid when the value is not empty', '{ value: unknown }', 'validationResult', false),
      'regex' => BasicFunction.new('Valid when the value matches the pattern', '{ value: string; pattern: string }', 'validationResult', false),
      'length' => BasicFunction.new('Valid when the length of the value is within min and max', '{ value: string; min?: number; max?: number }', 'validationResult', false),
      'numeric' => BasicFunction.new('Valid when the value is a number within min and max', '{ value: number; min?: number; max?: number }', 'validationResult', false),
      'email' => BasicFunction.new('Valid when the value is an email address', '{ value: string }', 'validationResult', false),
      'formatString' => BasicFunction.new('Interpolates ${/path}, ${relative/path} and ${fn(arg: value)} in the value; \${ is a literal', '{ value: string }', 'string', false),
      'formatNumber' => BasicFunction.new('The number in the locale of the user', '{ value: number; decimals?: number; grouping?: boolean }', 'string', false),
      'formatCurrency' => BasicFunction.new('The amount as money, with an ISO 4217 currency code', '{ value: number; currency: string; decimals?: number; grouping?: boolean }', 'string', false),
      'formatDate' => BasicFunction.new('A date or ISO string in a TR35 pattern, for example "MMM d, yyyy" or "HH:mm"', '{ value: string | number; format: string }', 'string', false),
      'pluralize' => BasicFunction.new('The string of the plural category of the value', '{ value: number; zero?: string; one?: string; two?: string; few?: string; many?: string; other: string }', 'string', false),
      'openUrl' => BasicFunction.new('Opens an http(s) URL in a new tab. Only from an event', '{ url: string }', 'void', true),
      'and' => BasicFunction.new('True when every value is true', '{ values: boolean[] }', 'boolean', false),
      'or' => BasicFunction.new('True when any value is true', '{ values: boolean[] }', 'boolean', false),
      'not' => BasicFunction.new('The negated value', '{ value: boolean }', 'boolean', false)
    }.freeze
    COPILOTKIT_FUNCTIONS = {
      'calc' => BasicFunction.new(
        "The value of an arithmetic expression over the other args, by name: + - * / % ( ), x ^ y (power), comparisons, && || !, cond ? a : b, min max round floor ceil abs pow sqrt exp ln log10, the constants pi and e, 'text' + name",
        '{ expression: string; [name: string]: number | string | boolean }', 'any', false
      ),
      'series' => BasicFunction.new(
        'A list of count copies of item, for chart data and template lists. Put arithmetic in ${expression} strings in item, ' \
        'using the loop variable (default i, counting from start, default 1) and other named args. A whole-expression string ' \
        'retains the result type, so "${i * monthlyCost}" yields a number. Arguments, including nested calc or formatString ' \
        'calls in item, resolve before the series loop; those calls cannot use the loop variable. Example: ' \
        '{"@call":"series","args":{"count":6,"item":{"month":"${i}","cost":"${i * monthlyCost}"},"monthlyCost":{"@path":"/monthlyCost"}}}. ' \
        'Omit variable to use i.',
        '{ count: number; item: unknown; variable?: string; start?: number; [name: string]: unknown }', 'array', false
      )
    }.freeze
    FUNCTIONS = A2UI_BASIC_FUNCTIONS.merge(COPILOTKIT_FUNCTIONS).freeze
    INDEX_FUNCTION = '@index'

    # What the client renders: its catalog, functions, targets and surfaces.
    Manifest = Struct.new(:catalog_id, :catalog_ids, :components, :functions, :targets, :surfaces,
                          :transport, :has_components, :action, keyword_init: true)
    # The component names that one target takes.
    AllowedComponents = Struct.new(:target, :names)

    module_function

    # Serializes like `JSON.stringify`, so prompts and payloads match the TypeScript runtime.
    def compact_json(value)
      JSON.generate(value)
    end

    def record?(value)
      value.is_a?(Hash)
    end

    # True for a finite JSON number, never a boolean.
    def number?(value)
      (value.is_a?(Integer) || value.is_a?(Float)) && value.finite?
    end

    def nonempty_str?(value)
      value.is_a?(String) && !value.empty?
    end

    # JavaScript truthiness for JSON values, as the TypeScript runtime tests them.
    def truthy?(value)
      !(value.nil? || value == false || value == '' || (number?(value) && value.zero?) || (value.is_a?(Float) && value.nan?))
    end

    # The activity message id of a surface. One message per surface.
    def surface_message_id(surface_id)
      "genui:#{surface_id}"
    end

    # Deep copy of JSON data; strings are shared.
    def deep_copy(value)
      case value
      when Hash then value.each_with_object({}) { |(key, item), copy| copy[key] = deep_copy(item) }
      when Array then value.map { |item| deep_copy(item) }
      else value
      end
    end

    # Python-style split: an empty string has one empty segment, and trailing empty segments stay.
    def split_segments(text, separator)
      text.empty? ? [''] : text.split(separator, -1)
    end

    # True for a built-in function name: basic, CopilotKit, or `@index`.
    def basic_function?(name)
      name == INDEX_FUNCTION || FUNCTIONS.key?(name)
    end

    # True for a built-in function that a prop or a check may call.
    def value_function?(name)
      return true if name == INDEX_FUNCTION
      info = FUNCTIONS[name]
      !info.nil? && !info.requires_user_activation
    end

    # Who may call a function, as [renderer, agent]. An undeclared caller is the renderer.
    def function_callers(fn)
      return [true, false] if fn.is_a?(BasicFunction)
      return [true, false] if truthy?(fn['requiresUserActivation'])
      callers = truthy?(fn['allowedCallers']) ? fn['allowedCallers'] : 'rendererOnly'
      [callers != 'agentOnly', callers != 'rendererOnly']
    end

    VALUE_FUNCTION_LIST = ('@index and the built-in functions (' + FUNCTIONS.keys.select { |name| value_function?(name) }.join(', ') + ')').freeze

    # -----------------------------------------------------------------------
    # Envelope (`a2ui-envelope.ts`)

    def optional_str?(record, key)
      !record.key?(key) || record[key].is_a?(String)
    end

    def record_of?(value, &check)
      record?(value) && value.values.all?(&check)
    end

    def schema_entry?(value)
      record?(value) && record?(value['parameters']) && optional_str?(value, 'description')
    end

    def props_schema?(value)
      return false unless record?(value)
      (!value.key?('properties') || record?(value['properties'])) &&
        (!value.key?('required') || (value['required'].is_a?(Array) && value['required'].all? { |name| name.is_a?(String) }))
    end

    def component_manifest?(value)
      return false unless record?(value) && props_schema?(value['props']) && optional_str?(value, 'description')
      return false if value.key?('events') && !record_of?(value['events']) { |entry| schema_entry?(entry) }
      return false if value.key?('slots') && !record_of?(value['slots']) { |kind| %w[single multiple].include?(kind) }
      return true unless value.key?('parameterOrder')
      order = value['parameterOrder']
      keys = Set.new((value['props']['properties'] || {}).keys + (value['slots'] || {}).keys + (value['events'] || {}).keys)
      order.is_a?(Array) && order.all? { |key| key.is_a?(String) && keys.include?(key) } && order.uniq.length == order.length
    end

    def inline_catalog?(value)
      record?(value) && nonempty_str?(value['catalogId']) && value['protocolVersion'] == '1.0' &&
        (!value.key?('components') || record_of?(value['components']) { |entry| component_manifest?(entry) }) &&
        record_of?(value['functions']) { |entry| schema_entry?(entry) } && optional_str?(value, 'instructions')
    end

    def capabilities?(value)
      return false unless record?(value)
      ids = value['supportedCatalogIds']
      ids.is_a?(Array) && !ids.empty? && ids.all? { |entry| nonempty_str?(entry) } &&
        (!value.key?('inlineCatalogs') || (value['inlineCatalogs'].is_a?(Array) && value['inlineCatalogs'].all? { |entry| inline_catalog?(entry) }))
    end

    def target?(value)
      return false unless record?(value)
      components = value['components']
      nonempty_str?(value['id']) && %w[chat inline].include?(value['kind']) && optional_str?(value, 'description') &&
        (!value.key?('components') || (components.is_a?(Array) && components.length <= MAX_TARGET_COMPONENTS && components.all? { |name| nonempty_str?(name) }))
    end

    def surface_entry?(value)
      return false unless record?(value)
      rejected = value['rejected']
      nonempty_str?(value['target']) && (!value.key?('dataModel') || record?(value['dataModel'])) &&
        (!value.key?('rejected') || (rejected.is_a?(Array) && rejected.length <= MAX_SUMMARY_REJECTIONS &&
          rejected.all? { |entry| entry.is_a?(String) && entry.length <= MAX_REJECTION_LENGTH })) &&
        (!value.key?('status') || %w[deleted failed].include?(value['status']))
    end

    def extensions?(value)
      return false unless record?(value)
      format = value['copilotkit_format']
      targets = value['copilotkit_targets']
      number?(format) && format == ENVELOPE_FORMAT && %w[tool markdown].include?(value['copilotkit_transport']) &&
        targets.is_a?(Array) && targets.all? { |target| target?(target) } &&
        record_of?(value['copilotkit_surfaces']) { |entry| surface_entry?(entry) } &&
        [true, false].include?(value['copilotkit_contextSent'])
    end

    # Reads the generative UI envelope from `forwardedProps`, or nil when it is malformed.
    def read_envelope(forwarded_props)
      return nil unless record?(forwarded_props)
      namespace = forwarded_props['copilotkit']
      return nil unless record?(namespace)
      envelope = namespace['ui']
      return envelope if record?(envelope) && capabilities?(envelope['1.0']) && record?(envelope['metadata']) &&
                         extensions?(envelope['metadata']['extensions'])
      nil
    end

    # Turns an envelope from `read_envelope` into the manifest of the run.
    def envelope_to_manifest(envelope)
      capabilities = envelope['1.0']
      catalog_ids = capabilities['supportedCatalogIds']
      catalog = (capabilities['inlineCatalogs'] || []).find { |entry| entry['catalogId'] == catalog_ids[0] }
      extensions = envelope['metadata']['extensions']
      action = extensions['copilotkit_action']
      Manifest.new(
        catalog_id: catalog_ids[0], catalog_ids: catalog_ids,
        components: catalog ? catalog.fetch('components', {}) : {},
        functions: catalog ? catalog['functions'] : {},
        targets: extensions['copilotkit_targets'], surfaces: extensions['copilotkit_surfaces'],
        transport: extensions['copilotkit_transport'],
        has_components: !catalog.nil? && catalog.key?('components'),
        action: record?(action) ? action : nil
      )
    end

    # The manifest of a "tool" run whose catalog has components; otherwise the run passes.
    def read_tool_manifest(forwarded_props)
      envelope = read_envelope(forwarded_props)
      return nil unless envelope
      manifest = envelope_to_manifest(envelope)
      manifest.transport == 'tool' && manifest.has_components ? manifest : nil
    end

    # -----------------------------------------------------------------------
    # Runtime option (`GenerativeUIOptions` of `core/runtime.ts`)
    #
    # The option is nil (default: on for a run whose client sends a "tool" catalog), true
    # (on for every run), false (off), or a Hash with the TypeScript option names:
    # `agents`, `a2uiVersion` ("0.9", "1.0", or a Hash of agent id to version), and the
    # A2UI v0.9 middleware options `schema`, `injectA2UITool`, `a2uiToolNames`,
    # `defaultCatalogId` and `recovery`, which apply to 0.9 agents only.

    # Raises ArgumentError for an invalid option, before a run starts.
    def validate_option!(option)
      return option if option.nil? || option == true || option == false
      raise ArgumentError, 'generative_ui must be nil, true, false, or a Hash' unless record?(option)
      version = option.fetch('a2uiVersion', '1.0')
      versions = record?(version) ? version.values : [version]
      unless versions.all? { |entry| VERSIONS.include?(entry) }
        raise ArgumentError, 'a2uiVersion must be "0.9", "1.0", or a Hash of agent ids to them'
      end
      agents = option['agents']
      raise ArgumentError, 'generative UI agents must be an Array of agent ids' unless agents.nil? || (agents.is_a?(Array) && agents.all? { |id| id.is_a?(String) })
      inject = option['injectA2UITool']
      raise ArgumentError, 'injectA2UITool must be true, false, or a tool name' unless inject.nil? || inject == true || inject == false || nonempty_str?(inject)
      exposure = option.dig('recovery', 'debugExposure') if record?(option['recovery'])
      raise ArgumentError, 'Invalid A2UI debug exposure' unless [nil, 'hidden', 'collapsed', 'verbose'].include?(exposure)
      option
    end

    # The A2UI version of one agent; "1.0" unless the option says "0.9".
    def resolve_a2ui_version(option, agent_id)
      return '1.0' unless record?(option)
      version = option['a2uiVersion']
      version = version[agent_id] if record?(version)
      version == '0.9' ? '0.9' : '1.0'
    end

    # Whether a run gets generative UI, as `configureAgentForRequest` decides.
    #
    # On for a run with a "tool" envelope, and for every run when the option turns it on.
    # A "markdown" envelope gets no render tool. `false` and the `agents` filter always win.
    def generative_ui_run?(option, agent_id, forwarded_props)
      return false if option == false
      envelope = read_envelope(forwarded_props)
      transport = envelope && envelope['metadata']['extensions']['copilotkit_transport']
      return false if transport != 'tool' && (transport == 'markdown' || !option)
      !(record?(option) && option['agents'].is_a?(Array) && !option['agents'].include?(agent_id))
    end

    # The v0.9 middleware of a run: full options for a 0.9 agent, extraction only for 1.0.
    def a2ui_middleware_config(option, version, forwarded_props)
      return {} unless version == '0.9'
      envelope = read_envelope(forwarded_props)
      tool = !envelope.nil? && envelope['metadata']['extensions']['copilotkit_transport'] == 'tool'
      config = record?(option) ? option.reject { |key, _| %w[agents a2uiVersion].include?(key) } : {}
      config.merge('injectA2UITool' => config['injectA2UITool'].nil? ? tool : config['injectA2UITool'])
    end

    # The `generativeUI` field of `/info`.
    def info(option)
      return { 'enabled' => false } if option == false
      return { 'enabled' => true, 'agents' => option['agents'].dup } if record?(option) && option['agents'].is_a?(Array)
      { 'enabled' => true }
    end

    # -----------------------------------------------------------------------
    # Component references (`child-refs.ts`)

    # "single" or "multiple" for a component reference schema, else nil.
    def child_ref_kind(schema)
      case schema['$ref']
      when COMPONENT_ID_REF then 'single'
      when CHILD_LIST_REF then 'multiple'
      end
    end

    # Every component reference in a props schema, as [path, kind] ("*" for array items).
    def collect_child_refs(schema)
      refs = []
      seen = Set.new
      add = lambda do |path, kind|
        next if seen.include?(path)
        seen << path
        refs << [path, kind]
      end
      visit = lambda do |node, path|
        next unless record?(node)
        kind = child_ref_kind(node)
        if kind
          add.call(path, kind)
          next
        end
        [node['anyOf'], node['oneOf']].each do |variants|
          next unless variants.is_a?(Array) && !variants.empty?
          kinds = variants.map { |variant| record?(variant) ? child_ref_kind(variant) : nil }
          if kinds[0] && kinds.all? { |entry| entry == kinds[0] }
            add.call(path, kinds[0])
          elsif kinds.all?(&:nil?)
            # A nested reference counts only when every alternative has it.
            per_variant = variants.map { |variant| collect_child_refs(variant) }
            per_variant[0].each do |ref_path, ref_kind|
              add.call(path + ref_path, ref_kind) if per_variant.all? { |entries| entries.include?([ref_path, ref_kind]) }
            end
          end
        end
        node['allOf'].each { |variant| visit.call(variant, path) } if node['allOf'].is_a?(Array)
        node['properties'].each { |key, value| visit.call(value, path + [key]) } if record?(node['properties'])
        visit.call(node['items'], path + ['*']) if record?(node['items'])
      end
      visit.call(schema, [])
      refs
    end

    # -----------------------------------------------------------------------
    # Operation validation (`validate-operation.ts`)

    OPERATION_KINDS = %w[createSurface updateComponents updateDataModel deleteSurface callRendererFunction].freeze
    V09_PATH_REASON = 'bind data with {"@path": "/x"}, not {"path": "/x"}'
    FORBIDDEN_SEGMENTS = Set.new(%w[__proto__ constructor prototype]).freeze
    ACCESSIBILITY_KEYS = %w[label description live hidden].freeze
    LIVE_VALUES = %w[off polite assertive].freeze

    # The one operation key of `op`, when it has exactly one.
    def operation_kind(op)
      return nil unless record?(op)
      kinds = OPERATION_KINDS.select { |kind| op.key?(kind) }
      kinds.length == 1 ? kinds[0] : nil
    end

    # The `surfaceId` of a surface operation.
    def operation_surface_id(op)
      kind = operation_kind(op)
      return nil unless kind
      payload = op[kind]
      record?(payload) && payload['surfaceId'].is_a?(String) ? payload['surfaceId'] : nil
    end

    def path_binding?(value)
      record?(value) && value['@path'].is_a?(String) && value.length == 1
    end

    def v09_path_binding?(value)
      record?(value) && value['path'].is_a?(String) && value.length == 1
    end

    def call_binding?(value)
      record?(value) && value['@call'].is_a?(String)
    end

    def index_call?(value)
      return false unless record?(value) && value['@call'] == INDEX_FUNCTION
      return false unless value.keys.all? { |key| %w[@call args].include?(key) }
      return true unless value.key?('args')
      args = value['args']
      record?(args) && args.keys.all? { |key| key == 'offset' } && (!args.key?('offset') || number?(args['offset']))
    end

    # `String(value)` for the rejection reasons.
    def js_string(value)
      case value
      when String then value
      when true then 'true'
      when false then 'false'
      when nil then 'null'
      when Hash then '[object Object]'
      when Array then value.map { |item| item.nil? ? '' : js_string(item) }.join(',')
      else value.to_s
      end
    end

    Validation = Struct.new(:manifest, :known_surfaces, :created_surfaces, :functions, :allowed)

    # Checks one A2UI 1.0 operation from the model. Returns the rejection reason, or nil.
    def validate_operation(op, manifest, known_surfaces, created_surfaces = nil, functions = nil, allowed = nil)
      options = Validation.new(manifest, known_surfaces, created_surfaces || Set.new, functions, allowed)
      return 'operation must be a JSON object' unless record?(op)
      if !op.key?('version') || op['version'] != A2UI_VERSION
        version = op['version']
        return version.is_a?(String) ? "unsupported version \"#{version}\"; use \"#{A2UI_VERSION}\"" : "operation needs \"version\":\"#{A2UI_VERSION}\""
      end
      kind = operation_kind(op)
      return "operation must contain exactly one of #{OPERATION_KINDS.join(', ')}" unless kind
      return AGENT_FUNCTION_CALLS_OFF_REASON if kind == 'callRendererFunction'
      payload = op[kind]
      return "#{kind}.surfaceId is required" unless record?(payload) && nonempty_str?(payload['surfaceId'])
      surface_id = payload['surfaceId']
      return create_surface_problem(payload, surface_id, options) if kind == 'createSurface'
      return "surface \"#{surface_id}\" does not exist; send createSurface first" unless known_surfaces.include?(surface_id)
      return data_model_problem(payload) if kind == 'updateDataModel'
      return components_problem(payload['components'], 'updateComponents.components', options) if kind == 'updateComponents'
      nil
    end

    # A `catalogId` can name the catalog of the run or one of its bases.
    def catalog_problem(catalog_id, manifest)
      ids = manifest.catalog_ids && !manifest.catalog_ids.empty? ? manifest.catalog_ids : [manifest.catalog_id]
      return nil if catalog_id.equal?(UNSET) || ids.include?(catalog_id)
      names = ids.map { |entry| "\"#{entry}\"" }.join(', ')
      use = ids.length == 1 ? names : "one of: #{names}"
      "unknown catalog \"#{js_string(catalog_id)}\"; leave out catalogId or use #{use}"
    end

    def create_surface_problem(payload, surface_id, options)
      return "surface \"#{surface_id}\" already exists" if options.known_surfaces.include?(surface_id)
      return "surface id \"#{surface_id}\" was used before; use a new surfaceId" if options.created_surfaces.include?(surface_id)
      reason = catalog_problem(payload.fetch('catalogId', UNSET), options.manifest)
      return reason if reason
      return 'createSurface.dataModel must be a JSON object' if payload.key?('dataModel') && !record?(payload['dataModel'])
      return nil unless payload.key?('components')
      components_problem(payload['components'], 'createSurface.components', options)
    end

    def data_model_problem(payload)
      return 'updateDataModel.value is required; use "value":null to delete' unless payload.key?('value')
      path = payload['path']
      path = '/' if path.nil?
      return 'updateDataModel.path must be an absolute JSON pointer' unless path.is_a?(String) && path.start_with?('/')
      if path == '/'
        return 'a root updateDataModel value must be a JSON object' unless record?(payload['value'])
        return nil
      end
      path_problem(path, 'updateDataModel.path')
    end

    # Checks the segments of an absolute pointer or of a template-relative path.
    def path_problem(path, label)
      segments = split_segments(path.start_with?('/') ? path[1..-1] : path, '/')
      return "#{label} must not contain empty segments" if segments.any?(&:empty?)
      segments.each do |segment|
        decoded = segment.gsub(/~([01])/) { Regexp.last_match(1) == '1' ? '/' : '~' }
        return "path segment \"#{decoded}\" is not allowed in #{label}" if FORBIDDEN_SEGMENTS.include?(decoded)
      end
      nil
    end

    def components_problem(components, label, options)
      return "#{label} must be a non-empty array" unless components.is_a?(Array) && !components.empty?
      ids = Set.new
      components.each do |node|
        return 'component must be a JSON object' unless record?(node)
        identifier = node['id']
        return 'id is required' unless nonempty_str?(identifier)
        reason = node_problem(node, identifier, options)
        return "component \"#{identifier}\": #{reason}" if reason
        return "component \"#{identifier}\" appears twice in one update" if ids.include?(identifier)
        ids << identifier
      end
      nil
    end

    def node_problem(node, identifier, options)
      name = node['component']
      return 'component type is required' unless name.is_a?(String)
      entry = options.manifest.components[name]
      return "unknown component \"#{name}\"" if entry.nil?
      allowed = options.allowed
      if allowed && !allowed.names.include?(name)
        names = allowed.names.empty? ? 'none' : allowed.names.join(', ')
        return "\"#{name}\" is not allowed in target \"#{allowed.target}\"; use one of: #{names}"
      end
      props = entry['props']
      properties = props['properties']
      prop_names = record?(properties) ? properties.keys : []
      events = entry['events'] || {}
      slots = entry['slots'] || {}
      node.each do |key, value|
        next if %w[id component].include?(key)
        if key == 'catalogId'
          reason = catalog_problem(value, options.manifest)
          return "#{key}: #{reason}" if reason
          next
        end
        if key == 'metadata'
          return 'metadata must be { "extensions": { ... } }' unless record?(value) && (!value.key?('extensions') || record?(value['extensions']))
          next
        end
        if key == 'accessibility'
          reason = accessibility_problem(value)
          return "#{key}: #{reason}" if reason
          next
        end
        if events.key?(key)
          reason = action_binding_problem(value, options)
          return "#{key}: #{reason}" if reason
          next
        end
        slot = slots[key]
        unless slot.nil?
          reason = slot_problem(value, slot, identifier)
          return "#{key}: #{reason}" if reason
          next
        end
        return "unknown prop \"#{key}\"" unless prop_names.include?(key)
        return "#{key}: #{V09_PATH_REASON}" if v09_path_binding?(value)
        call = forbidden_call(value)
        return "#{key}: #{call}; a data prop can call only #{VALUE_FUNCTION_LIST}" unless call.nil?
      end
      collect_child_refs(props).each do |ref|
        reason = child_ref_problem(node, ref, identifier)
        return reason if reason
      end
      required = props['required']
      (required.is_a?(Array) ? required : []).each do |prop|
        return "missing required prop \"#{prop}\"" if prop.is_a?(String) && !node.key?(prop)
      end
      nil
    end

    def accessibility_problem(value)
      return 'must be { "label": "...", "description": "...", "live": "polite", "hidden": false }' unless record?(value)
      value.each do |key, entry|
        return "unknown key \"#{key}\"" unless ACCESSIBILITY_KEYS.include?(key)
        return "#{key}: #{V09_PATH_REASON}" if v09_path_binding?(entry)
        if path_binding?(entry) || call_binding?(entry)
          call = forbidden_call(entry)
          return "#{key}: #{call}" unless call.nil?
          next
        end
        if key == 'live'
          return "live must be one of #{LIVE_VALUES.join(', ')}" unless entry.is_a?(String) && LIVE_VALUES.include?(entry)
        elsif key == 'hidden'
          return 'hidden must be a boolean' unless [true, false].include?(entry)
        elsif !entry.is_a?(String)
          return "#{key} must be a string"
        end
      end
      nil
    end

    def action_binding_problem(value, options)
      return 'must be an action object' unless record?(value)
      keys = value.keys
      return 'must be { "event": ... } or { "functionCall": ... }' unless keys.length == 1 && %w[functionCall event].include?(keys[0])
      return function_call_problem(value['functionCall'], 'functionCall', options) if keys[0] == 'functionCall'
      event_problem(value['event'])
    end

    def function_call_problem(call, label, options)
      return "#{label} must be { \"@call\": \"<function>\", \"args\": { ... } }" unless record?(call)
      name = call['@call']
      unless nonempty_str?(name)
        return call['call'].is_a?(String) ? "#{label} names the function with \"@call\", not \"call\"" : "#{label}[\"@call\"] must be a function name"
      end
      return "#{label}.args must be an object" if call.key?('args') && !record?(call['args'])
      reason = catalog_problem(call.fetch('catalogId', UNSET), options.manifest)
      return "#{label}: #{reason}" if reason
      (call['args'] || {}).each do |key, arg|
        return "#{label}.args.#{key}: #{V09_PATH_REASON}" if v09_path_binding?(arg)
      end
      # A function the app declares under a built-in name is the app's own.
      app_functions = options.functions
      declared = app_functions.nil? ? nil : app_functions[name]
      built_in = declared.nil? ? FUNCTIONS[name] : nil
      if declared.nil? && built_in.nil?
        return app_functions.nil? ? nil : "function \"#{name}\" is not exposed to generative UI"
      end
      return nil if declared.nil? && app_functions.nil?
      fn = declared.nil? ? built_in : declared
      renderer, agent = function_callers(fn)
      if label.start_with?('callRendererFunction') && !agent
        user_activation = fn.is_a?(BasicFunction) ? fn.requires_user_activation : truthy?(fn['requiresUserActivation'])
        return user_activation ? "function \"#{name}\" runs only from a user gesture; the agent cannot call it" : "function \"#{name}\" runs only in the UI (allowedCallers \"rendererOnly\"); the agent cannot call it"
      end
      return "function \"#{name}\" runs only for the agent (allowedCallers \"agentOnly\"); the UI cannot call it" if !label.start_with?('callRendererFunction') && !renderer
      nil
    end

    def event_problem(event)
      return 'event.name is required' unless record?(event) && nonempty_str?(event['name'])
      message = event.fetch('userMessage', UNSET)
      is_message = message.equal?(UNSET) || message.is_a?(String) || path_binding?(message) ||
                   (record?(message) && message['@call'].is_a?(String) && forbidden_call(message).nil?)
      unless is_message
        return v09_path_binding?(message) ? "event.userMessage: #{V09_PATH_REASON}" : 'event.userMessage must be a string, {"@path": "/x"} or a function value'
      end
      return nil unless event.key?('context')
      context = event['context']
      return 'event.context must be an object' unless record?(context)
      context.each do |key, entry|
        return "event.context.#{key}: #{V09_PATH_REASON}" if v09_path_binding?(entry)
        call = forbidden_call(entry)
        return "event.context.#{key}: #{call}; a context value can call only #{VALUE_FUNCTION_LIST}" unless call.nil?
      end
      nil
    end

    def slot_problem(value, kind, own_id)
      template = record?(value) && value.key?('componentId')
      return 'a template { "componentId", "path" } is only allowed in a "multiple" slot' if kind == 'single' && template
      return template_problem(value, own_id) if kind == 'multiple' && template
      return 'must be an array of component ids or a template { "componentId", "path" }' if kind == 'multiple' && !value.is_a?(Array)
      (kind == 'multiple' ? value : [value]).each do |identifier|
        return 'must reference component ids (strings)' unless nonempty_str?(identifier)
        return 'a component cannot be its own child' if identifier == own_id
      end
      nil
    end

    def template_problem(template, own_id)
      return 'a template takes only "componentId" and "path"' unless template.keys.all? { |key| %w[componentId path].include?(key) }
      component_id = template['componentId']
      path = template['path']
      return 'template componentId must be a component id' unless nonempty_str?(component_id)
      return 'a component cannot be its own child' if component_id == own_id
      return 'template path must be a JSON pointer or a relative path' unless nonempty_str?(path)
      path_problem(path, 'template path')
    end

    # The first function call in a data value that is not a value function, at any depth.
    def forbidden_call(value)
      if value.is_a?(Array)
        value.each do |item|
          reason = forbidden_call(item)
          return reason unless reason.nil?
        end
        return nil
      end
      return nil unless record?(value)
      return nil if index_call?(value)
      return '@index takes only an offset' if value['@call'] == INDEX_FUNCTION
      return 'name the function with "@call", not "call"' if value['call'].is_a?(String)
      return 'an event binding is not a value' if value.key?('functionCall')
      name = value['@call']
      if name.is_a?(String)
        unless value_function?(name)
          return basic_function?(name) ? "\"#{name}\" runs only from an event" : "\"#{name}\" is not a basic function"
        end
        return nil unless value.key?('args')
        return "the args of \"#{name}\" must be an object" unless record?(value['args'])
        return forbidden_call(value['args'])
      end
      value.each_value do |item|
        reason = forbidden_call(item)
        return reason unless reason.nil?
      end
      nil
    end

    # Checks the component ids at one typed reference of a node, at any depth.
    def child_ref_problem(node, ref, own_id)
      path, kind = ref
      label = path.reject { |step| step == '*' }.join('.')
      visit = lambda do |value, steps|
        # A bound or computed value is known only at render.
        next nil if path_binding?(value) || (record?(value) && value.key?('@call'))
        if steps.empty?
          reason = slot_problem(value, kind, own_id)
          next reason ? "#{label}: #{reason}" : nil
        end
        head = steps[0]
        rest = steps[1..-1]
        if head == '*'
          next nil unless value.is_a?(Array)
          found = nil
          value.each do |item|
            found = visit.call(item, rest)
            break if found
          end
          next found
        end
        next nil unless record?(value) && value.key?(head)
        visit.call(value[head], rest)
      end
      visit.call(node, path)
    end

    # -----------------------------------------------------------------------
    # Streamed render_ui arguments (`render-ui-args.ts`)

    def parse_object(raw)
      value = JSON.parse(raw)
      record?(value) ? value : nil
    rescue JSON::ParserError
      nil
    end

    # Reads `target` and every complete `operations[]` element from streamed arguments.
    #
    # Each push scans only the new text. An element that is balanced but not a JSON object
    # is reported as nil.
    class ArgsStream
      attr_reader :text, :target, :operations

      def initialize
        @text = +''
        @target = nil
        @operations = []
        @emitted = 0
        @stack = []
        @in_string = false
        @escaped = false
        @string_start = -1
        @pending_key = nil
        @current_key = nil
        @expecting_value = false
        @in_operations = false
        @element_start = -1
      end

      # True when the text so far ends inside an `operations[]` element.
      def incomplete_operation?
        @element_start >= 0
      end

      # Adds a delta; returns the target so far and the operations not reported before.
      def push(delta)
        start = @text.length
        @text << delta
        text = @text
        stack = @stack
        delta.each_char.with_index(start) do |char, index|
          if @in_string
            if @escaped
              @escaped = false
            elsif char == '\\'
              @escaped = true
            elsif char == '"'
              @in_string = false
              if stack.length == 1
                literal = text[@string_start..index]
                if @expecting_value
                  if @current_key == 'target'
                    begin
                      @target = JSON.parse(literal)
                    rescue JSON::ParserError
                      nil
                    end
                  end
                  @expecting_value = false
                else
                  @pending_key = literal
                end
              end
            end
            next
          end
          case char
          when '"'
            @in_string = true
            @string_start = index
          when ':'
            if stack.length == 1 && !@pending_key.nil?
              @current_key = begin
                JSON.parse(@pending_key)
              rescue JSON::ParserError
                nil
              end
              @pending_key = nil
              @expecting_value = true
            end
          when ','
            if stack.length == 1
              @expecting_value = false
              @current_key = nil
            end
          when '{'
            @element_start = index if @in_operations && stack.length == 2
            stack << '{'
          when '['
            @in_operations = true if stack.length == 1 && @expecting_value && @current_key == 'operations'
            stack << '['
          when '}', ']'
            stack.pop
            if char == '}' && @in_operations && stack.length == 2 && @element_start >= 0
              @operations << GenerativeUI.parse_object(text[@element_start..index])
              @element_start = -1
            end
            if char == ']' && @in_operations && stack.length == 1
              @in_operations = false
              @expecting_value = false
            end
          end
        end
        fresh = @operations[@emitted..-1]
        @emitted = @operations.length
        [@target, fresh]
      end
    end

    # -----------------------------------------------------------------------
    # The guide (`prompt.ts`, `prompt-spec.ts`, `schema-render.ts`)

    WHEN_TO_SHOW = 'Show UI when it conveys the answer better than prose: to illustrate a concept (a diagram, ' \
                   'a chart of how something changes), to compare options side by side, to let the user ' \
                   'explore or adjust values, or to collect input. A small, focused surface next to your ' \
                   'explanation often lands better than a long description. Reply in prose alone for a quick ' \
                   'fact, a short answer, or conversation, and never add UI only as decoration.'
    TOOL_INTRO = "Call `#{RENDER_TOOL}` to show UI. Arguments: `target` first, then " \
                 '`operations` (A2UI v1.0 operations, applied in order).'
    # Each item is a rule, or [features, rules] for rules that apply only when every feature holds.
    TOOL_OPERATIONS = [
      '{"version":"1.0","createSurface":{"surfaceId":"<new id>","dataModel":{...},"components":' \
      '[{"id":"root","component":"<Name>","children":["<child id>"]}]}}: the first operation of ' \
      'a new surface. "dataModel" and "components" are optional.',
      '{"version":"1.0","updateComponents":{"surfaceId":"<id>","components":[<component>, ...]}}: ' \
      'add or replace components by id.',
      '{"version":"1.0","updateDataModel":{"surfaceId":"<id>","path":"/some/path","value":<json>}}' \
      ': set the value at "path". Always give "value". "value":null deletes the key at "path".',
      '{"version":"1.0","deleteSurface":{"surfaceId":"<id>"}}: remove the surface.',
      [%w[agentCalls], [
        '{"version":"1.0","callRendererFunction":{"functionCallId":"<unique id>",' \
        '"callFunction":{"@call":"<function>","args":{...}}}}: run an app function now, ' \
        'with no click. It needs no surface.'
      ]]
    ].freeze
    TOOL_RULES = [
      'Components are flat objects: {"id":"...","component":"<Name>", ...props}. Every surface ' \
      'renders from the component with id "root". Reference children by id in slot props.',
      'A component may take "accessibility":{"label":"<1 to 3 words>","description":"<what it ' \
      'does>"} for screen readers: on the component it describes, when nothing visible names it. ' \
      'Not on every component, and "live":"polite" only on text that changes by itself.',
      'Stream progressively: put the initial data in "dataModel" and the root in "components" of ' \
      'the createSurface operation, then send one updateComponents operation per child, so the UI ' \
      'appears while you are still writing. The root must already list the ids of its children in ' \
      'its slot props (for example "children":["card-1","card-2"]), even though the children come ' \
      'later. A component that no slot references is never shown.',
      'Updating a component replaces all of its props, so resend every prop.',
      'Prop values are literals or data bindings {"@path":"/data/path"}. Never write ' \
      '{"path":"/data/path"} as a binding.',
      [%w[events functions], [
        'Event props take an action. {"functionCall":{"@call":"<function>","args":{...}}} ' \
        'runs an app function in the browser immediately, and you are not told about it. ' \
        '{"event":{"name":"<name>","userMessage":"<text>","context":{...}}} sends the ' \
        'interaction back to you as a user message, with "userMessage" as its first line. ' \
        '"userMessage" is plain text: ${...} is not interpolated in it; put values in ' \
        '"context". Only call functions listed below.'
      ]],
      [%w[events noFunctions], [
        'Event props take an action: {"event":{"name":"<name>","userMessage":"<text>",' \
        '"context":{...}}} sends the interaction back to you as a user message, with ' \
        '"userMessage" as its first line. "userMessage" is plain text: ${...} is not ' \
        'interpolated in it; put values in "context".'
      ]],
      'To show a different view, create a new surface with a new surfaceId (for example, a ' \
      'checkout form after a cart summary). Update an existing surface only when the user asks to ' \
      'change that same view: then do not send createSurface, use its surfaceId, and pass its ' \
      'existing target. Never reuse an earlier chat surface for a different view, because that ' \
      'replaces the earlier UI and anything the user typed into it.',
      'Never use a surfaceId again, also after deleteSurface.',
      'A prop can also be a function value that updates with the data: {"@call":"formatCurrency",' \
      '"args":{"value":{"@path":"/total"},"currency":"EUR"}}. Only call functions listed below. ' \
      'formatString interpolates ${/path} and ${fn(arg: value)} in its value.',
      '${...} is evaluated only in the value of formatString and in the item of series; in other ' \
      'strings it stays literal text. Inside formatString, ${...} does not support operators. For ' \
      'arithmetic use calc, with the values as named args: {"@call":"calc","args":{"expression":' \
      '"seats * 29 * (annual ? 0.8 : 1)","seats":{"@path":"/seats"},"annual":{"@path":"/annual"}}}.',
      'For a computed list (chart data, template items) use series. Its description under ' \
      'Functions gives the rules and an example.',
      [%w[checks], [
        'Validate an input with "checks": [{"condition":{"@call":"email","args":{"value":' \
        '{"@path":"/form/email"}}},"message":"Enter a valid email"}]. The check functions ' \
        'are required, regex, length, numeric and email. A failed check shows the message ' \
        'under the input and disables a Button that has the same checks.'
      ]],
      [%w[templates], [
        'To repeat a component for each item of a list, give a multiple slot a template: ' \
        '"children":{"componentId":"row","path":"/items"}. Inside the template, paths are ' \
        'relative to the item ("name", not "/name"). {"@call":"@index"} gives the position ' \
        'of the item, from 0; {"@call":"@index","args":{"offset":1}} counts from 1.'
      ]],
      [%w[agentCalls], [
        'Give every callRendererFunction a new functionCallId. Call only a function marked ' \
        '(UI or agent) or (agent only); a function with no mark is for the UI only. A ' \
        'function marked (agent only) is only for callRendererFunction: do not bind an ' \
        'event to it.',
        'The result of a callRendererFunction comes back to you in a new turn, as a ' \
        'developer message: {"version":"1.0","rendererFunctionResponse":{"functionCallId":' \
        '"<id>","value":...}}. If the call failed, it has "error" in place of "value". Do ' \
        'not wait for the result in this reply, and do not guess it.'
      ]]
    ].freeze

    def child_list?(schema)
      return schema.any? { |item| child_list?(item) } if schema.is_a?(Array)
      return false unless record?(schema)
      return true if schema['$ref'] == CHILD_LIST_REF
      schema.values.any? { |value| child_list?(value) }
    end

    # Which optional rule groups apply to the manifest (`generativeUIGuideFeatures`).
    def prompt_features(manifest)
      components = manifest.components.values
      functions = manifest.functions.keys.any? { |name| !basic_function?(name) }
      {
        'functions' => functions,
        'noFunctions' => !functions,
        'events' => components.any? { |component| !(component['events'] || {}).empty? },
        'templates' => components.any? { |component| (component['slots'] || {}).values.include?('multiple') || child_list?(component['props']) },
        'checks' => components.any? { |component| record?(component['props']['properties']) && component['props']['properties'].key?('checks') },
        # `GENERATIVE_UI_AGENT_FUNCTION_CALLS` is off.
        'agentCalls' => false
      }
    end

    def select_items(items, features)
      items.each_with_object([]) do |item, selected|
        if item.is_a?(String)
          selected << item
        elsif item[0].all? { |feature| features[feature] }
          selected.concat(item[1])
        end
      end
    end

    def one_line(text)
      text.gsub(/[[:space:]]*\n[[:space:]]*/, ' ')
    end

    # The component list of the tool guide, in the "json-schema" notation.
    def component_list(components)
      components.map do |name, component|
        description = component['description']
        lines = ["- **#{name}**" + (truthy?(description) ? ": #{one_line(description)}" : ''), "  props: #{compact_json(component['props'])}"]
        lines << "  event props: #{compact_json(component['events'])}" unless component['events'].nil?
        lines << "  slot props (component ids): #{compact_json(component['slots'])}" unless component['slots'].nil?
        lines.join("\n")
      end.join("\n")
    end

    def shorten(text)
      text.length > MAX_USER_VALUES_LENGTH ? text[0, MAX_USER_VALUES_LENGTH] + '...' : text
    end

    # The guide the runtime adds to a tool-transport run (`buildGenerativeUIPrompt`).
    def build_prompt(manifest)
      targets = manifest.targets.map do |target|
        place = target['kind'] == 'chat' ? 'inside the chat transcript' : 'a named area of the app'
        components = target['components']
        limit = components.nil? ? '' : "; only #{components.empty? ? 'no components' : components.join(', ')}"
        description = truthy?(target['description']) ? ": #{target['description']}" : ''
        "- \"#{target['id']}\" (#{place}#{limit})#{description}"
      end
      functions = manifest.functions.map do |name, fn|
        # A built-in function carries its short signature in the description of its parameters.
        signature = fn['parameters']['description']
        args = signature.is_a?(String) && signature.start_with?('{') && fn['parameters'].length == 2 ? signature : compact_json(fn['parameters'])
        description = truthy?(fn['description']) ? ": #{fn['description']}" : ''
        "- **#{name}**#{description}\n  args: #{args}"
      end
      surfaces = manifest.surfaces.map do |surface_id, summary|
        state = if summary['status'] == 'deleted'
                  ', deleted: never use this id again'
                elsif summary['status'] == 'failed'
                  ', not created: send a corrected createSurface with this id'
                else
                  ''
                end
        lines = ["- \"#{surface_id}\" (target \"#{summary['target']}\"#{state})"]
        lines << "  user values: #{shorten(compact_json(summary['dataModel']))}" unless summary['dataModel'].nil?
        (summary['rejected'] || []).each { |rejection| lines << "  rejected: #{rejection}" }
        lines.join("\n")
      end
      notes_needed = manifest.surfaces.values.any? { |summary| summary.key?('dataModel') || !(summary['rejected'] || []).empty? }
      notes = notes_needed ? "User values are what the user entered, by path. Your writes to those paths are ignored. Rejected operations were dropped: send them again with the problem fixed.\n" : ''
      features = prompt_features(manifest)
      operations = select_items(TOOL_OPERATIONS, features).map { |op| "- #{op}" }.join("\n")
      rules = select_items(TOOL_RULES, features).each_with_index.map { |rule, index| "#{index + 1}. #{rule}" }.join("\n")
      [
        "## Generative UI\n#{TOOL_INTRO}\n\n#{WHEN_TO_SHOW}\n\n" \
        "Every operation has \"version\":\"1.0\" and exactly one of:\n#{operations}\n\nRules:\n#{rules}",
        "### Targets\n" + (targets.empty? ? '- none' : targets.join("\n")),
        "### Components\n" + (manifest.components.empty? ? '- none' : component_list(manifest.components)),
        "### Functions\n" + (functions.empty? ? '- none' : functions.join("\n")),
        "### Existing surfaces\n" + notes + (surfaces.empty? ? '- none' : surfaces.join("\n"))
      ].join("\n\n")
    end

    # -----------------------------------------------------------------------
    # The middleware (`generative-ui-middleware.ts`)

    # Lets an agent render generative UI surfaces with the `render_ui` tool.
    #
    # Each complete operation in the streamed arguments is validated against the client's
    # catalog and committed at once: `ACTIVITY_SNAPSHOT` for a new surface, `ACTIVITY_DELTA`
    # for every further operation on it. Create one per run.
    class Middleware
      def initialize(manifest)
        @manifest = manifest
      end

      # Adds the `render_ui` tool and the generative UI guide; never mutates `input`.
      def prepare(input)
        tools = (input['tools'] || []).reject { |tool| tool.is_a?(Hash) && tool['name'] == RENDER_TOOL }
        tools << {
          'name' => RENDER_TOOL,
          'description' => 'Render or update generative UI surfaces, or call app functions, with A2UI v1.0 operations. Follow the generative UI guide in context.',
          'parameters' => {
            'type' => 'object',
            'properties' => {
              'target' => { 'type' => 'string', 'enum' => @manifest.targets.map { |target| target['id'] },
                            'description' => 'Where the surface is shown: "chat" or a named inline target.' },
              'operations' => { 'type' => 'array', 'description' => 'A2UI v1.0 operations, applied in order.', 'items' => { 'type' => 'object' } }
            },
            'required' => %w[target operations]
          }
        }
        context = (input['context'] || []).reject { |entry| entry.is_a?(Hash) && entry['description'] == CONTEXT_DESCRIPTION }
        context << { 'description' => CONTEXT_DESCRIPTION, 'value' => GenerativeUI.build_prompt(@manifest) }
        input.merge('tools' => tools, 'context' => context)
      end

      # The run state of one agent run, for `prepared` agent input.
      def start(prepared)
        SurfaceRun.new(@manifest, prepared)
      end
    end

    RenderCall = Struct.new(:stream, :target, :buffered, :next_index, :applied, :rejected, :touched, :finished) do
      def self.create
        new(ArgsStream.new, nil, [], 0, 0, [], {}, false)
      end
    end

    # The surfaces, created ids and render_ui calls of one run. `handle` passes one event
    # through with the surface events it caused; `complete` answers each call before a held
    # RUN_FINISHED.
    class SurfaceRun
      def initialize(manifest, input)
        @manifest = manifest
        # Only live surfaces take updates; a deleted or never-created one has a status.
        @surfaces = {}
        manifest.surfaces.each { |surface_id, summary| @surfaces[surface_id] = summary['target'] unless GenerativeUI.truthy?(summary['status']) }
        # A surface id is unique for the life of the page. A failed create can be retried.
        @created = Set.new(manifest.surfaces.reject { |_, summary| summary['status'] == 'failed' }.keys)
        @target_components = {}
        manifest.targets.each { |target| @target_components[target['id']] = target['components'] unless target['components'].nil? }
        @catalog_ids = manifest.catalog_ids && !manifest.catalog_ids.empty? ? manifest.catalog_ids : [manifest.catalog_id]
        @calls = {}
        @answered = Set.new((input['messages'] || []).select { |message| message.is_a?(Hash) && message['role'] == 'tool' }.map { |message| message['toolCallId'] })
        @answered_at_finish = Set.new
        @out = []
      end

      # Records the calls answered when RUN_FINISHED arrives.
      def finishing
        @answered_at_finish = @answered.dup
      end

      # Passes one event through and returns it with the surface events it caused.
      def handle(event)
        @out = [event]
        kind = event['type']
        call_id = event['toolCallId']
        return @out unless call_id.is_a?(String)
        if kind == 'TOOL_CALL_RESULT'
          @answered << call_id
        elsif kind == 'TOOL_CALL_START' && event['toolCallName'] == RENDER_TOOL
          @calls[call_id] = RenderCall.create
        elsif kind == 'TOOL_CALL_ARGS' && @calls.key?(call_id)
          state = @calls[call_id]
          delta = event['delta']
          if !state.finished && delta.is_a?(String)
            target, operations = state.stream.push(delta)
            if !target.nil? && state.target.nil?
              state.target = target
              buffered = state.buffered
              state.buffered = []
              buffered.each { |op| process(state, op) }
            end
            operations.each { |op| accept(state, op) }
          end
        elsif kind == 'TOOL_CALL_END' && @calls.key?(call_id)
          finish(@calls[call_id])
        end
        @out
      end

      # Finishes every call and, before a held RUN_FINISHED, answers the unanswered ones.
      def complete(finished)
        @out = []
        @calls.each_value { |state| finish(state) }
        return @out unless finished
        @calls.each do |call_id, state|
          next if @answered_at_finish.include?(call_id)
          result = if state.applied.zero? && state.rejected.empty?
                     { 'status' => 'error', 'applied' => 0, 'calls' => 0, 'rejected' => [],
                       'reason' => 'operations must be a JSON array of A2UI operation objects; nothing was rendered' }
                   else
                     { 'status' => 'rendered', 'applied' => state.applied, 'calls' => 0, 'rejected' => state.rejected }
                   end
          @out << { 'type' => 'TOOL_CALL_RESULT', 'messageId' => SecureRandom.uuid, 'toolCallId' => call_id, 'content' => GenerativeUI.compact_json(result) }
        end
        @out
      end

      private

      def patch(surface_id, ops)
        @out << { 'type' => 'ACTIVITY_DELTA', 'messageId' => GenerativeUI.surface_message_id(surface_id), 'activityType' => ACTIVITY_TYPE, 'patch' => ops }
      end

      # Marks a surface streaming and clears its rejections the first time a call touches it.
      def begin_update(state, surface_id)
        return [] if state.touched.key?(surface_id)
        state.touched[surface_id] = true
        [{ 'op' => 'replace', 'path' => '/status', 'value' => 'streaming' }, { 'op' => 'replace', 'path' => '/rejected', 'value' => [] }]
      end

      def reject(state, index, reason, surface_id)
        entry = { 'index' => index, 'reason' => reason }
        state.rejected << entry
        return unless surface_id && @surfaces.key?(surface_id)
        patch(surface_id, begin_update(state, surface_id) + [{ 'op' => 'add', 'path' => '/rejected/-', 'value' => entry }])
      end

      # A createSurface keeps a listed catalogId and gets the run's catalog otherwise.
      def with_catalog_id(op)
        create = op['createSurface']
        return op unless create.is_a?(Hash)
        catalog_id = create['catalogId']
        catalog_id = @manifest.catalog_id unless @catalog_ids.include?(catalog_id)
        op.merge('createSurface' => create.merge('catalogId' => catalog_id))
      end

      def process(state, op)
        index = state.next_index
        state.next_index += 1
        if op.nil?
          reject(state, index, 'operation is not valid JSON', nil)
          return
        end
        surface_id = nil
        begin
          surface_id = GenerativeUI.operation_surface_id(op)
          apply(state, index, with_catalog_id(op), surface_id)
        rescue StandardError => error
          # One bad operation must not take down the run; the tool result reports it.
          reject(state, index, "operation could not be processed: #{error.message}", surface_id)
        end
      end

      def apply(state, index, op, surface_id)
        kind = GenerativeUI.operation_kind(op)
        target = kind == 'createSurface' ? state.target : @surfaces[surface_id || '']
        names = target.nil? ? nil : @target_components[target]
        reason = GenerativeUI.validate_operation(op, @manifest, Set.new(@surfaces.keys), @created, @manifest.functions,
                                                 !target.nil? && !names.nil? ? AllowedComponents.new(target, names) : nil)
        if reason
          reject(state, index, reason, surface_id)
          return
        end
        if kind == 'createSurface'
          create(state, index, surface_id, op)
          return
        end
        patch(surface_id, begin_update(state, surface_id) + [{ 'op' => 'add', 'path' => '/operations/-', 'value' => op }])
        @surfaces.delete(surface_id) if kind == 'deleteSurface'
        state.applied += 1
      end

      def create(state, index, surface_id, op)
        target = state.target
        if target.nil?
          reject(state, index, 'render_ui was called without a target', nil)
          return
        end
        unless @manifest.targets.any? { |entry| entry['id'] == target }
          reject(state, index, "target \"#{target}\" is not mounted", nil)
          return
        end
        @surfaces[surface_id] = target
        @created << surface_id
        catalog_id = op['createSurface']['catalogId']
        @out << {
          'type' => 'ACTIVITY_SNAPSHOT', 'messageId' => GenerativeUI.surface_message_id(surface_id), 'activityType' => ACTIVITY_TYPE,
          'content' => { 'surfaceId' => surface_id, 'target' => target, 'catalogId' => GenerativeUI.truthy?(catalog_id) ? catalog_id : @manifest.catalog_id,
                         'operations' => [op], 'status' => 'streaming', 'rejected' => [] },
          'replace' => true
        }
        state.touched[surface_id] = true
        state.applied += 1
      end

      # Holds operations until the target is known.
      def accept(state, op)
        if state.target.nil?
          state.buffered << op
        else
          process(state, op)
        end
      end

      # Recovers operations that the model sent as a JSON-encoded string.
      def recover(state)
        args = begin
          JSON.parse(state.stream.text)
        rescue JSON::ParserError
          return
        end
        return unless args.is_a?(Hash)
        state.target = args['target'] if state.target.nil? && args['target'].is_a?(String)
        operations = args['operations']
        if operations.is_a?(String)
          begin
            operations = JSON.parse(operations)
          rescue JSON::ParserError
            return
          end
        end
        return unless operations.is_a?(Array)
        operations.each { |op| accept(state, op.is_a?(Hash) ? op : nil) }
      end

      def finish(state)
        return if state.finished
        state.finished = true
        recover(state) if state.next_index.zero? && state.buffered.empty?
        if state.target.nil?
          # Function calls need no target; every other operation is rejected.
          buffered = state.buffered
          state.buffered = []
          buffered.each do |op|
            if GenerativeUI.operation_kind(op) == 'callRendererFunction'
              process(state, op)
              next
            end
            state.rejected << { 'index' => state.next_index, 'reason' => 'render_ui was called without a target' }
            state.next_index += 1
          end
        end
        if state.stream.incomplete_operation?
          # The arguments ended inside an element, for example at the output limit.
          state.rejected << { 'index' => state.next_index, 'reason' => 'operation was truncated' }
          state.next_index += 1
        end
        state.touched.each_key { |surface_id| patch(surface_id, [{ 'op' => 'replace', 'path' => '/status', 'value' => 'ready' }]) }
      end
    end
  end
end
