# frozen_string_literal: true
require 'json'
require 'time'
require_relative 'a2ui'
require_relative 'generative_ui'

module CopilotKit
  # Serves A2UI v0.9 agents through the A2UI 1.0 client.
  #
  # Ports `a2ui-v09-operations.ts`, `a2ui-v09-actions.ts`, `a2ui-v09-catalog.ts` and
  # `a2ui-v09-middleware.ts` of the TypeScript runtime:
  # - v0.9 `a2ui-surface` activity events become 1.0 `generative-ui-surface` events;
  # - a click on a converted surface reaches the agent as the v0.9 `a2uiAction`;
  # - a 0.9 agent gets the v0.9 component schema of the client's catalog.
  module A2UIUpgrade
    GUI = GenerativeUI
    UNSET = GenerativeUI::UNSET

    # -----------------------------------------------------------------------
    # Operations (`a2ui-v09-operations.ts`)

    V09_SURFACE_ACTIVITY_TYPE = 'a2ui-surface'
    OPERATIONS_KEY = 'a2ui_operations'
    V09_VERSIONS = %w[v0.9 v0.9.1].freeze
    V09_KINDS = %w[createSurface updateComponents updateDataModel deleteSurface].freeze
    V09_BASIC_CATALOG_IDS = %w[
      https://a2ui.org/specification/v0_9/basic_catalog.json
      https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json
    ].freeze
    # v0.9 `Text` heading variants as 1.0 `Title` sizes, largest first.
    HEADING_SIZES = { 'h1' => '2xl', 'h2' => 'xl', 'h3' => 'lg', 'h4' => 'md', 'h5' => 'sm' }.freeze

    # Why an operation cannot be converted.
    class Failed < StandardError; end

    # A JSON patch that does not apply.
    class PatchError < StandardError; end

    module_function

    def v09_kind(op)
      kinds = V09_KINDS.select { |kind| op.key?(kind) }
      kinds.length == 1 ? kinds[0] : nil
    end

    # True for an A2UI v0.9 operation, also one without `version` but with one v0.9 key.
    def v09_operation?(value)
      return false unless value.is_a?(Hash)
      return value['version'].is_a?(String) && V09_VERSIONS.include?(value['version']) if value.key?('version')
      kind = v09_kind(value)
      !kind.nil? && value[kind].is_a?(Hash)
    end

    # `{ path }` becomes `{ "@path" }` and `{ call, args }` becomes `{ "@call", args }`.
    def convert_value(value)
      return value.map { |item| convert_value(item) } if value.is_a?(Array)
      return value unless value.is_a?(Hash)
      return { '@path' => value['path'] } if value.length == 1 && value['path'].is_a?(String)
      return convert_call(value) if value['call'].is_a?(String) && value.keys.all? { |key| %w[call args returnType].include?(key) }
      value.each_with_object({}) { |(key, item), result| result[key] = convert_value(item) }
    end

    def convert_call(call)
      result = { '@call' => call['call'] }
      result['args'] = convert_value(call['args']) if call.key?('args')
      result
    end

    def v09_action?(value)
      value.is_a?(Hash) && value.length == 1 && (value['event'].is_a?(Hash) || value['functionCall'].is_a?(Hash))
    end

    # A v0.9 action as a 1.0 `{ event }` or `{ functionCall }` binding.
    def convert_action(action)
      raise Failed, 'action must be { "event": ... } or { "functionCall": ... }' unless v09_action?(action)
      if action['functionCall'].is_a?(Hash)
        call = action['functionCall']
        raise Failed, 'action.functionCall.call must be a function name' unless GUI.nonempty_str?(call['call'])
        return { 'functionCall' => convert_call(call) }
      end
      event = action['event']
      raise Failed, 'action.event.name is required' unless GUI.nonempty_str?(event['name'])
      converted = { 'name' => event['name'] }
      converted['context'] = convert_value(event['context']) if event.key?('context')
      { 'event' => converted }
    end

    # The props of the basic catalog that the 1.0 standard catalog names differently.
    #
    # `Text` with a heading `variant` becomes `Title` (h1 "2xl" to h5 "sm"), with `caption`
    # it becomes `Caption`; `variant` goes, and `weight` too for Title and Caption.
    # `Button.action` becomes `onClick`. `TextField.validationRegexp` becomes a `regex` check.
    def basic_catalog_changes(node)
      if node['component'] == 'Text' && node.key?('variant')
        rest = node.reject { |key, _| key == 'variant' }
        variant = node['variant']
        size = variant.is_a?(String) ? HEADING_SIZES[variant] : nil
        unless size.nil?
          title = rest.reject { |key, _| key == 'weight' }
          title['component'] = 'Title'
          title['size'] = size
          return title
        end
        if variant == 'caption'
          caption = rest.reject { |key, _| key == 'weight' }
          caption['component'] = 'Caption'
          return caption
        end
        return rest
      end
      if node['component'] == 'Button' && node.key?('action')
        rest = node.reject { |key, _| key == 'action' }
        rest['onClick'] = node['action']
        return rest
      end
      if node['component'] == 'TextField' && node.key?('validationRegexp')
        rest = node.reject { |key, _| key == 'validationRegexp' }
        pattern = node['validationRegexp']
        return rest unless pattern.is_a?(String) && rest.key?('value')
        check = { 'condition' => { '@call' => 'regex', 'args' => { 'value' => rest['value'], 'pattern' => pattern } } }
        checks = rest['checks'].is_a?(Array) ? rest['checks'] : []
        rest['checks'] = checks + [check]
        return rest
      end
      node
    end

    # One v0.9 component (flat format) as a 1.0 component node.
    def convert_component(node)
      raise Failed, 'a component needs a string id' unless node.is_a?(Hash) && GUI.nonempty_str?(node['id'])
      unless GUI.nonempty_str?(node['component'])
        raise Failed, "component \"#{node['id']}\": the component type must be a string (the v0.9 flat format)"
      end
      converted = {}
      node.each do |key, value|
        if %w[id component].include?(key)
          converted[key] = value
        elsif key == 'action' || v09_action?(value)
          begin
            converted[key] = convert_action(value)
          rescue Failed => error
            raise Failed, "component \"#{node['id']}\": #{error.message}"
          end
        else
          converted[key] = convert_value(value)
        end
      end
      basic_catalog_changes(converted)
    end

    # v0.9 removes the key when `value` is left out; 1.0 removes it for null.
    def convert_update_data_model(payload, surface_id)
      path = payload.fetch('path', UNSET)
      raise Failed, 'updateDataModel.path must be a string' if !path.equal?(UNSET) && !path.is_a?(String)
      relative = path.is_a?(String) ? path : ''
      pointer = relative.start_with?('/') ? relative : "/#{relative}"
      root = pointer == '/'
      value = payload.fetch('value', UNSET)
      raise Failed, 'a root updateDataModel value must be a JSON object in A2UI 1.0' if root && !value.equal?(UNSET) && !value.is_a?(Hash)
      value = root ? {} : nil if value.equal?(UNSET)
      { 'version' => GUI::A2UI_VERSION, 'updateDataModel' => { 'surfaceId' => surface_id, 'path' => pointer, 'value' => value } }
    end

    # The basic catalog id becomes the standard catalog id; `theme` has no 1.0 field.
    def convert_create_surface(payload, surface_id)
      create = { 'surfaceId' => surface_id }
      catalog_id = payload['catalogId']
      if GUI.nonempty_str?(catalog_id)
        create['catalogId'] = V09_BASIC_CATALOG_IDS.include?(catalog_id) ? GUI::STANDARD_CATALOG_ID : catalog_id
      end
      send = payload['sendDataModel']
      send = payload['attachDataModel'] if send.nil?
      create['sendDataModel'] = send if [true, false].include?(send)
      { 'version' => GUI::A2UI_VERSION, 'createSurface' => create }
    end

    def upgrade_operation(op)
      raise Failed, 'operation must be a JSON object' unless op.is_a?(Hash)
      return op if op.key?('version') && op['version'] == GUI::A2UI_VERSION
      unless v09_operation?(op)
        version = op['version']
        raise Failed, (version.is_a?(String) ? "unsupported A2UI version \"#{version}\"; only v0.9 operations are converted" : 'not an A2UI v0.9 operation: it needs exactly one of ' + V09_KINDS.join(', '))
      end
      kind = v09_kind(op)
      raise Failed, 'operation must contain exactly one of ' + V09_KINDS.join(', ') if kind.nil?
      payload = op[kind]
      raise Failed, "#{kind}.surfaceId is required" unless payload.is_a?(Hash) && GUI.nonempty_str?(payload['surfaceId'])
      surface_id = payload['surfaceId']
      case kind
      when 'createSurface' then convert_create_surface(payload, surface_id)
      when 'updateComponents'
        components = payload['components']
        raise Failed, 'updateComponents.components must be a non-empty array' unless components.is_a?(Array) && !components.empty?
        { 'version' => GUI::A2UI_VERSION, 'updateComponents' => { 'surfaceId' => surface_id, 'components' => components.map { |component| convert_component(component) } } }
      when 'updateDataModel' then convert_update_data_model(payload, surface_id)
      else { 'version' => GUI::A2UI_VERSION, 'deleteSurface' => { 'surfaceId' => surface_id } }
      end
    end

    # Converts A2UI v0.9 operations to 1.0, in order. Never raises.
    #
    # A 1.0 operation stays as it is. Any other operation, and a v0.9 operation that cannot
    # be converted, is returned in the second list as [operation, reason].
    def upgrade_operations(operations)
      upgraded = []
      dropped = []
      (operations.is_a?(Array) ? operations : []).each do |operation|
        begin
          upgraded << upgrade_operation(operation)
        rescue Failed => error
          dropped << [operation, error.message]
        rescue StandardError => error
          dropped << [operation, "operation could not be read: #{error.message}"]
        end
      end
      [upgraded, dropped]
    end

    # The nested `surfaceId` of a v0.9 or 1.0 surface operation.
    def surface_id_of(op)
      return nil unless op.is_a?(Hash)
      V09_KINDS.each do |kind|
        payload = op[kind]
        return(payload['surfaceId'].empty? ? nil : payload['surfaceId']) if payload.is_a?(Hash) && payload['surfaceId'].is_a?(String)
      end
      nil
    end

    def read_operations(content)
      return [] unless content.is_a?(Hash)
      operations = content[OPERATIONS_KEY]
      operations = content['operations'] if operations.nil?
      operations.is_a?(Array) ? operations : []
    end

    FORBIDDEN_SEGMENTS = GenerativeUI::FORBIDDEN_SEGMENTS

    def pointer_segments(pointer)
      return [] if pointer == ''
      raise PatchError, "invalid pointer \"#{pointer}\"" unless pointer.start_with?('/')
      GUI.split_segments(pointer[1..-1], '/').map { |part| part.gsub('~1', '/').gsub('~0', '~') }
    end

    def pointer_index(key)
      key.match?(/\A\d+\z/) ? key.to_i : nil
    end

    # Applies RFC 6902 operations to `document` in place and returns the new root.
    #
    # Raises on a path that does not resolve, so a bad delta leaves stored content alone.
    def apply_json_patch(document, patch)
      raise PatchError, 'patch must be an array' unless patch.is_a?(Array)
      root = [document]
      parent_of = lambda do |pointer|
        segments = pointer_segments(pointer)
        key = segments.pop
        parent = root[0]
        segments.each do |segment|
          raise PatchError, 'forbidden path' if FORBIDDEN_SEGMENTS.include?(segment)
          parent = if parent.is_a?(Array)
                     index = pointer_index(segment)
                     !index.nil? && index < parent.length ? parent[index] : UNSET
                   elsif parent.is_a?(Hash)
                     parent.fetch(segment, UNSET)
                   else
                     UNSET
                   end
          raise PatchError, "path \"#{pointer}\" not found" if parent.equal?(UNSET)
        end
        raise PatchError, 'forbidden path' if !key.nil? && FORBIDDEN_SEGMENTS.include?(key)
        [parent, key]
      end
      read = lambda do |pointer|
        parent, key = parent_of.call(pointer)
        next root[0] if key.nil?
        if parent.is_a?(Array)
          index = pointer_index(key)
          next !index.nil? && index < parent.length ? parent[index] : UNSET
        end
        parent.is_a?(Hash) ? parent.fetch(key, UNSET) : UNSET
      end
      remove = lambda do |pointer|
        parent, key = parent_of.call(pointer)
        raise PatchError, 'cannot remove the root' if key.nil?
        if parent.is_a?(Array)
          index = pointer_index(key)
          raise PatchError, "path \"#{pointer}\" not found" if index.nil?
          parent.slice!(index, 1)
        elsif parent.is_a?(Hash) && parent.key?(key)
          parent.delete(key)
        else
          raise PatchError, "path \"#{pointer}\" not found"
        end
      end
      write = lambda do |pointer, value, insert|
        raise PatchError, "path \"#{pointer}\" has no value" if value.equal?(UNSET)
        parent, key = parent_of.call(pointer)
        if key.nil?
          root[0] = value
        elsif parent.is_a?(Array)
          index = key == '-' ? parent.length : pointer_index(key)
          raise PatchError, "index \"#{key}\" is out of range" if index.nil? || index > parent.length
          parent[index, insert ? 0 : 1] = [value]
        elsif parent.is_a?(Hash)
          parent[key] = value
        else
          raise PatchError, "path \"#{pointer}\" not found"
        end
      end
      patch.each do |entry|
        raise PatchError, 'invalid patch operation' unless entry.is_a?(Hash) && entry['path'].is_a?(String)
        path = entry['path']
        source = entry['from'] || ''
        case entry['op']
        when 'add' then write.call(path, GUI.deep_copy(entry['value']), true)
        when 'replace'
          raise PatchError, "path \"#{path}\" not found" if read.call(path).equal?(UNSET)
          write.call(path, GUI.deep_copy(entry['value']), false)
        when 'remove' then remove.call(path)
        when 'copy' then write.call(path, GUI.deep_copy(read.call(source)), true)
        when 'move'
          value = read.call(source)
          remove.call(source)
          write.call(path, value, true)
        when 'test'
          value = read.call(path)
          raise PatchError, "test failed at \"#{path}\"" if value.equal?(UNSET) || GUI.compact_json(value) != GUI.compact_json(entry['value'])
        else
          raise PatchError, "unknown patch op \"#{entry['op']}\""
        end
      end
      root[0]
    end

    SourcePart = Struct.new(:operations, :rejected)
    # `parts` holds the part of each source message, in the order they first touched the
    # surface. `sent_operations` are the operations sent as deltas, for a surface created in
    # an earlier run.
    SurfaceState = Struct.new(:parts, :last_snapshot, :sent_operations, :sent_rejected) do
      def self.create
        new({}, nil, [], '[]')
      end
    end

    # Converts the v0.9 surfaces of one run to 1.0 surfaces. Create one per run.
    #
    # An `a2ui-surface` snapshot or delta is kept per messageId and its operations converted.
    # Each surface becomes one `genui:<surfaceId>` message: a surface created in this run is
    # sent as a cumulative snapshot (chat target, status "ready", `a2uiSourceVersion` "0.9");
    # a surface that this run only updates gets its new operations as an `ACTIVITY_DELTA`.
    # A lifecycle snapshot (no operations) names no surface, so it is consumed.
    class ActivityUpgrader
      def initialize
        @sources = {}
        @surfaces = {}
      end

      # The events that replace one event of the run.
      def transform(event)
        kind = event['type']
        return [event] unless %w[ACTIVITY_SNAPSHOT ACTIVITY_DELTA].include?(kind) && event['activityType'] == V09_SURFACE_ACTIVITY_TYPE
        message_id = event['messageId']
        if kind == 'ACTIVITY_SNAPSHOT'
          # `replace: false` does not replace a message that already exists.
          return [] if event['replace'] == false && @sources.key?(message_id)
          @sources[message_id] = GUI.deep_copy(event['content'])
          return refresh(message_id)
        end
        return [] unless @sources.key?(message_id)
        begin
          content = A2UIUpgrade.apply_json_patch(GUI.deep_copy(@sources[message_id]), event['patch'])
        rescue StandardError
          # The AG-UI client also skips a delta that does not apply.
          return []
        end
        @sources[message_id] = content
        refresh(message_id)
      end

      private

      def snapshot(surface_id, state, operations, rejected)
        create = operations.find { |op| op.key?('createSurface') }
        catalog_id = create && create['createSurface'].is_a?(Hash) ? create['createSurface']['catalogId'] : nil
        content = {
          'surfaceId' => surface_id, 'target' => GUI::CHAT_TARGET,
          'catalogId' => GUI.truthy?(catalog_id) ? catalog_id : GUI::STANDARD_CATALOG_ID,
          'operations' => operations, 'status' => 'ready', 'rejected' => rejected, 'a2uiSourceVersion' => '0.9'
        }
        serialized = GUI.compact_json(content)
        return [] if serialized == state.last_snapshot
        state.last_snapshot = serialized
        [{ 'type' => 'ACTIVITY_SNAPSHOT', 'messageId' => GUI.surface_message_id(surface_id), 'activityType' => GUI::ACTIVITY_TYPE,
           'content' => GUI.deep_copy(content), 'replace' => true }]
      end

      def delta(surface_id, state, operations, rejected)
        sent = state.sent_operations
        same = 0
        same += 1 while same < sent.length && same < operations.length && GUI.compact_json(sent[same]) == GUI.compact_json(operations[same])
        # Operations that changed after they were sent cannot be taken back. v0.9 updates
        # replace by id or path, so sending them again is safe.
        patch = operations[same..-1].map { |op| { 'op' => 'add', 'path' => '/operations/-', 'value' => GUI.deep_copy(op) } }
        serialized = GUI.compact_json(rejected)
        patch << { 'op' => 'replace', 'path' => '/rejected', 'value' => rejected } if serialized != state.sent_rejected
        state.sent_operations = operations
        state.sent_rejected = serialized
        return [] if patch.empty?
        [{ 'type' => 'ACTIVITY_DELTA', 'messageId' => GUI.surface_message_id(surface_id), 'activityType' => GUI::ACTIVITY_TYPE, 'patch' => patch }]
      end

      def emit(surface_id)
        state = @surfaces[surface_id]
        return [] if state.nil?
        operations = []
        rejected = []
        created = false
        state.parts.each_value do |part|
          part.operations.each do |op|
            if op.key?('createSurface')
              # A second createSurface of the same id is rejected in 1.0.
              next if created
              created = true
            end
            operations << op
          end
          rejected.concat(part.rejected)
        end
        created ? snapshot(surface_id, state, operations, rejected) : delta(surface_id, state, operations, rejected)
      end

      # Converts the stored content of one source message again.
      def refresh(message_id)
        parts = {}
        A2UIUpgrade.read_operations(@sources[message_id]).each_with_index do |op, index|
          # An operation with no surface cannot be shown anywhere.
          surface_id = A2UIUpgrade.surface_id_of(op)
          next if surface_id.nil?
          part = (parts[surface_id] ||= SourcePart.new([], []))
          operations, dropped = A2UIUpgrade.upgrade_operations([op])
          part.operations.concat(operations)
          dropped.each { |(_, reason)| part.rejected << { 'index' => index, 'reason' => reason } }
        end
        touched = parts.keys
        @surfaces.each do |surface_id, state|
          touched << surface_id if !parts.key?(surface_id) && !state.parts.delete(message_id).nil?
        end
        parts.each { |surface_id, part| (@surfaces[surface_id] ||= SurfaceState.create).parts[message_id] = part }
        touched.flat_map { |surface_id| emit(surface_id) }
      end
    end

    # -----------------------------------------------------------------------
    # Clicks (`a2ui-v09-actions.ts`)

    # The 1.0 action of the user event that started the run, as a v0.9 user action.
    def read_action(envelope)
      message = envelope && envelope['metadata']['extensions']['copilotkit_action']
      return nil unless message.is_a?(Hash) && message['action'].is_a?(Hash)
      action = message['action']
      name = action['name']
      surface_id = action['surfaceId']
      return nil unless name.is_a?(String) && surface_id.is_a?(String)
      source = action['sourceComponentId']
      context = action['context']
      timestamp = action['timestamp']
      {
        'name' => name, 'surfaceId' => surface_id,
        'sourceComponentId' => source.is_a?(String) ? source : '',
        'context' => context.is_a?(Hash) ? context : {},
        'timestamp' => timestamp.is_a?(String) ? timestamp : Time.now.utc.strftime('%Y-%m-%dT%H:%M:%S.%LZ')
      }
    end

    # True when the surface was converted from v0.9.
    #
    # The client's surface summary decides, then the last `generative-ui-surface` activity
    # message of the surface, then `agent_version`.
    def v09_surface?(envelope, messages, surface_id, agent_version)
      summary = envelope['metadata']['extensions']['copilotkit_surfaces'][surface_id]
      return summary['a2uiSourceVersion'] == '0.9' if summary.is_a?(Hash) && summary['a2uiSourceVersion'].is_a?(String)
      messages.reverse_each do |message|
        next unless message.is_a?(Hash) && message['role'] == 'activity' && message['activityType'] == GUI::ACTIVITY_TYPE &&
                    message['content'].is_a?(Hash) && message['content']['surfaceId'] == surface_id
        return message['content']['a2uiSourceVersion'] == '0.9'
      end
      agent_version == '0.9'
    end

    # Turns a click on a surface of v0.9 origin into the v0.9 action of the agent side.
    #
    # The 1.0 client sends a click as a visible user message plus `copilotkit_action` in the
    # envelope. For a surface of v0.9 origin this returns a new input with
    # `forwardedProps.a2uiAction.userAction` set and that user message removed, as the v0.9
    # client sent no message for a click. Otherwise it returns `input`.
    def downgrade_action(input, agent_version = '1.0')
      forwarded = input['forwardedProps']
      # A run that already has a v0.9 action keeps it.
      return input if !forwarded.is_a?(Hash) || forwarded.key?('a2uiAction')
      envelope = GUI.read_envelope(forwarded)
      action = read_action(envelope)
      return input if envelope.nil? || action.nil?
      messages = input['messages'] || []
      return input unless v09_surface?(envelope, messages, action['surfaceId'], agent_version)
      last = messages[-1]
      # The client adds the visible click message just before the run.
      messages = messages[0...-1] if last.is_a?(Hash) && last['role'] == 'user' && last['content'].is_a?(String)
      input.merge('messages' => messages, 'forwardedProps' => forwarded.merge('a2uiAction' => { 'userAction' => action }))
    end

    # -----------------------------------------------------------------------
    # Catalog (`a2ui-v09-catalog.ts`)

    V09_BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json'
    CAPABILITIES_DESCRIPTION = 'A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.'
    GENERATION_GUIDELINES_DESCRIPTION = 'A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.'
    DESIGN_GUIDELINES_DESCRIPTION = 'A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.'
    # The components of the v0.9 basic catalog. The 1.0 standard catalog has each of them.
    V09_BASIC_COMPONENTS = %w[
      Text Image Icon Video AudioPlayer Row Column List Card Tabs Modal Divider Button TextField
      CheckBox ChoicePicker Slider DateTimeInput
    ].freeze
    # The components of the 1.0 standard catalog (`standardDeclarations`).
    STANDARD_COMPONENTS = Set.new(%w[
      Box Column Row Grid GridItem Card Flow FlowItem Carousel CarouselItem CarouselMediaItem
      Spacer Divider Tabs Title Text Caption Label Bold Italic Underline Strikethrough Badge
      Blockquote Code Markdown Math ShimmerText Link Tooltip Button Pressable Form TextField
      TextArea Select CheckBox Radio RadioGroup Slider SegmentedControl ChoicePicker
      DateTimeInput PulseIndicator FlashcardFlip Popover PopoverTrigger PopoverContent Modal
      Table TableSection TableRow TableCell List ListItem Chart Map Image Icon Favicon Svg
      Video AudioPlayer HtmlView LinkCard Citation FollowUp EntityCard ImageGrid
    ]).freeze
    # Props of standard components that v0.9 names differently: component → 1.0 → v0.9 name.
    V10_TO_V09_PROP_NAMES = { 'Button' => { 'onClick' => 'action' } }.freeze
    COMMON = 'common_types.json#/$defs/'

    def ref(name)
      { '$ref' => "#{COMMON}#{name}" }
    end

    # The v0.9 common types that the schemas reference, so every ref resolves in the payload.
    V09_COMMON_TYPES = {
      'ComponentId' => {
        'type' => 'string',
        'description' => 'The unique identifier for a component, used for both definitions and references within the same surface.'
      },
      'ComponentCommon' => {
        'type' => 'object',
        'properties' => { 'id' => ref('ComponentId'), 'accessibility' => ref('AccessibilityAttributes') },
        'required' => ['id']
      },
      'AccessibilityAttributes' => {
        'type' => 'object',
        'description' => 'Attributes to enhance accessibility when using assistive technologies like screen readers.',
        'properties' => { 'label' => ref('DynamicString'), 'description' => ref('DynamicString') }
      },
      'ChildList' => {
        'oneOf' => [
          { 'type' => 'array', 'items' => ref('ComponentId'), 'description' => 'A static list of child component IDs.' },
          {
            'type' => 'object',
            'description' => 'A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template.',
            'properties' => {
              'componentId' => ref('ComponentId'),
              'path' => { 'type' => 'string', 'description' => 'The path to the list of component property objects in the data model.' }
            },
            'required' => %w[componentId path],
            'additionalProperties' => false
          }
        ]
      },
      'DataBinding' => {
        'type' => 'object',
        'properties' => { 'path' => { 'type' => 'string', 'description' => 'A JSON Pointer path to a value in the data model.' } },
        'required' => ['path'],
        'additionalProperties' => false
      },
      'FunctionCall' => {
        'type' => 'object',
        'description' => 'Invokes a named function on the client.',
        'properties' => {
          'call' => { 'type' => 'string', 'description' => 'The name of the function to call.' },
          'args' => { 'type' => 'object', 'description' => 'Arguments passed to the function.', 'additionalProperties' => ref('DynamicValue') }
        },
        'required' => ['call'],
        'additionalProperties' => false
      },
      'DynamicValue' => {
        'description' => 'A value that can be a literal, a path, or a function call returning any type.',
        'anyOf' => [{ 'type' => 'string' }, { 'type' => 'number' }, { 'type' => 'boolean' }, { 'type' => 'array' }, ref('DataBinding'), ref('FunctionCall')]
      },
      'DynamicString' => { 'anyOf' => [{ 'type' => 'string' }, ref('DataBinding'), ref('FunctionCall')] },
      'DynamicNumber' => { 'anyOf' => [{ 'type' => 'number' }, ref('DataBinding'), ref('FunctionCall')] },
      'DynamicBoolean' => { 'anyOf' => [{ 'type' => 'boolean' }, ref('DataBinding'), ref('FunctionCall')] },
      'DynamicStringList' => { 'anyOf' => [{ 'type' => 'array', 'items' => { 'type' => 'string' } }, ref('DataBinding'), ref('FunctionCall')] },
      'Action' => {
        'description' => 'Defines an interaction handler that can either trigger a server-side event or execute a local client-side function.',
        'oneOf' => [
          {
            'type' => 'object',
            'description' => 'Triggers a server-side event.',
            'properties' => {
              'event' => {
                'type' => 'object',
                'properties' => {
                  'name' => { 'type' => 'string', 'description' => 'The name of the action to be dispatched to the server.' },
                  'context' => {
                    'type' => 'object',
                    'description' => 'A JSON object containing the key-value pairs for the action context. Values can be literals or paths.',
                    'additionalProperties' => ref('DynamicValue')
                  }
                },
                'required' => ['name'],
                'additionalProperties' => false
              }
            },
            'required' => ['event'],
            'additionalProperties' => false
          },
          {
            'type' => 'object',
            'description' => 'Executes a local client-side function.',
            'properties' => { 'functionCall' => ref('FunctionCall') },
            'required' => ['functionCall'],
            'additionalProperties' => false
          }
        ]
      }
    }.freeze

    DEFAULT_GENERATION_GUIDELINES = <<~'TEXT'.chomp
      Generate A2UI v0.9 JSON.

      ## A2UI Protocol Instructions

      A2UI (Agent to UI) is a protocol for rendering rich UI surfaces from agent responses.

      CRITICAL: You MUST call the render_a2ui tool with ALL of these arguments:
      - surfaceId: A unique ID for the surface (e.g. "product-comparison")
      - components: REQUIRED — the A2UI component array. NEVER omit this. Only use
        components listed in the Available Components schema provided as context.
      - data: OPTIONAL — a JSON object written to the root of the surface data model.
        Use for pre-filling form values or providing data for path-bound components.
      - every component must have the "component" field specifying the component type.
        ONLY use component names from the Available Components schema — do NOT invent
        component names or use names not in the schema.

      COMPONENT ID RULES:
      - Exactly one component MUST have id="root". This is the surface's entry
        point — the renderer begins at "root" and walks the child/children tree
        from there. Every other component must be reachable from "root". If no
        component has id="root", the surface renders an empty loading placeholder
        and none of your components will be shown.
      - Every component ID must be unique within the surface.
      - A component MUST NOT reference itself as child/children. This causes a
        circular dependency error. For example, if a component has id="avatar",
        its child must be a DIFFERENT id (e.g. "avatar-img"), never "avatar".
      - The child/children tree must be a DAG — no cycles allowed.

      REPEATING CONTENT (TEMPLATES):
      To repeat a component for each item in an array, use the structural children format:
        children: { componentId: "card-id", path: "/items" }
      This tells the renderer to create one instance of "card-id" per item in the "/items" array.

      PATH RULES FOR TEMPLATES:
      Components inside a repeating template use RELATIVE paths (no leading slash).
      The path is resolved relative to each array item automatically.
      If a container has children: { componentId: "card", path: "/items" } and each item
      has a key "name", use { "path": "name" } (NO leading slash — relative to item).
      CRITICAL: Do NOT use "/name" (absolute) inside templates — use "name" (relative).
      The container's path ("/items") uses a leading slash (absolute), but all
      components INSIDE the template use paths WITHOUT leading slash.

      COMPONENT VALUES — DEFAULT RULE:
      Use inline literal values for ALL component properties. Pass strings, numbers,
      arrays, and objects directly on the component. Do NOT use { "path": "..." }
      objects unless the property's schema explicitly allows it (see exception below).
      CRITICAL: USING { "path": "..." } ON A PROPERTY THAT DOES NOT DECLARE PATH
      SUPPORT IN ITS SCHEMA WILL CAUSE A RUNTIME CRASH AND BREAK THE ENTIRE UI.
      ALWAYS CHECK THE COMPONENT SCHEMA FIRST — IF THE PROPERTY ONLY ACCEPTS A
      PLAIN TYPE, YOU MUST USE A LITERAL VALUE.
      VERY IMPORTANT: THE APPLICATION WILL BREAK IF YOU DO NOT FOLLOW THIS RULE!

      For example, a chart's "data" must always be an inline array:
        "data": [{"label": "Jan", "value": 100}, {"label": "Feb", "value": 200}]
      A metric's "value" must always be an inline string:
        "value": "$1,200"

      PATH BINDING EXCEPTION — SCHEMA-DRIVEN:
      A few properties accept { "path": "/some/path" } as an alternative to a literal
      value. You can identify these in the Available Components schema: the property
      will list BOTH a literal type AND an object-with-path option. If a property only
      shows a single type (string, number, array, etc.), it does NOT support path
      binding — use a literal value only.

      Path binding is typically used for editable form inputs so the client can write
      user input back to the data model. When building forms:
      - Bind input "value" to a data model path: "value": { "path": "/form/name" }
      - Pre-fill via the "data" tool argument: "data": { "form": { "name": "Alice" } }
      - Capture values on submit via button action context:
          "action": { "event": { "name": "submit", "context": { "name": { "path": "/form/name" } } } }

      REPEATING CONTENT uses a structural children format (not the same as value binding):
        children: { componentId: "card-id", path: "/items" }
      Components inside templates use RELATIVE paths (no leading slash): { "path": "name" }.
    TEXT

    DEFAULT_DESIGN_GUIDELINES = <<~'TEXT'.chomp
      Create polished, visually appealing interfaces. ONLY use components listed in the
      Available Components schema — do NOT use component names that are not in the schema.

      Design principles:
      - Create clear visual hierarchy within cards and layouts.
      - Keep cards clean — avoid clutter. Whitespace is good.
      - Use consistent surfaceIds (lowercase, hyphenated).
      - NEVER use the same ID for a component and its child — this creates a
        circular dependency. E.g. if id="avatar", child must NOT be "avatar".
      - For side-by-side comparisons, use a container with structural children
        (children: { componentId, path }) to repeat a card template per data item.
      - Include images when relevant (logos, icons, product photos):
        - Prefer company logos via Google favicons: https://www.google.com/s2/favicons?domain=example.com&sz=128
        - Do NOT invent Unsplash photo-IDs — they will 404. Only use real, known URLs.
      - For buttons: action MUST use this exact nested format:
          "action": { "event": { "name": "myAction", "context": { "key": "value" } } }
        The "event" key holds an OBJECT with "name" (required) and "context" (optional).
        Do NOT use a flat format like {"event": "name"} — "event" must be an object.
      - For forms: check the component schema — if an input's "value" property
        supports path binding, use it for editable fields. The submit button's
        action context should reference the same paths to capture user input.

      Use the SAME surfaceId as the main surface. Match action names to button action event names.
    TEXT

    DYNAMIC_TYPES = { 'string' => 'DynamicString', 'number' => 'DynamicNumber', 'boolean' => 'DynamicBoolean' }.freeze
    DYNAMIC_REFS = { 'string' => 'DynamicString', 'number' => 'DynamicNumber', 'boolean' => 'DynamicBoolean',
                     'string[]' => 'DynamicStringList', 'unknown' => 'DynamicValue' }.freeze

    # 1.0 binding and call syntax in a description, written the v0.9 way.
    def v09_text(text)
      text.gsub('"@path"', '"path"').gsub('"@call"', '"call"')
    end

    # A copy of a schema, with its descriptions written the v0.9 way.
    def v09_schema(value)
      return value.map { |item| v09_schema(item) } if value.is_a?(Array)
      return value unless value.is_a?(Hash)
      value.each_with_object({}) do |(key, child), result|
        result[key] = key == 'description' && child.is_a?(String) ? v09_text(child) : v09_schema(child)
      end
    end

    # A prop as v0.9 states it: its literal schema, a `{ path }` or a `{ call }`.
    #
    # Only the prop itself is made dynamic, as in the v0.9 basic catalog.
    def dynamic_value(schema)
      return ref('DynamicValue') unless schema.is_a?(Hash)
      v09 = v09_schema(schema)
      return v09 if GUI.child_ref_kind(schema)
      literal = v09.reject { |key, _| key == 'description' }
      description = v09['description']
      text = description.is_a?(String) ? { 'description' => description } : {}
      if literal.length == 1 && literal['type'].is_a?(String)
        dynamic = DYNAMIC_TYPES[literal['type']]
        return ref(dynamic).merge(text) if dynamic
      end
      items = literal['items']
      if literal.length == 2 && literal['type'] == 'array' && items.is_a?(Hash) && items.length == 1 && items['type'] == 'string'
        return ref('DynamicStringList').merge(text)
      end
      text.merge('anyOf' => [literal, ref('DataBinding'), ref('FunctionCall')])
    end

    # An object schema with each of its properties made dynamic.
    def dynamic_properties(schema)
      result = v09_schema(schema)
      if schema['properties'].is_a?(Hash)
        result['properties'] = schema['properties'].each_with_object({}) { |(key, value), properties| properties[key] = dynamic_value(value) }
      end
      result
    end

    # Points the local refs (`#/...`) of a props schema to where it is embedded.
    def rebase_refs(value, base)
      return value.map { |item| rebase_refs(item, base) } if value.is_a?(Array)
      return value unless value.is_a?(Hash)
      result = value.each_with_object({}) { |(key, child), copy| copy[key] = rebase_refs(child, base) }
      target = result['$ref']
      if target == '#'
        result['$ref'] = base
      elsif target.is_a?(String) && target.start_with?('#/')
        result['$ref'] = base + target[1..-1]
      end
      result
    end

    # One component in the v0.9 inline catalog format, under its v0.9 prop names.
    def component_schema(name, manifest, renames)
      props = manifest['props']
      properties = props['properties']
      fields = {}
      (properties.is_a?(Hash) ? properties : {}).each { |key, schema| fields[key] = dynamic_value(schema) }
      (manifest['events'] || {}).each do |key, event|
        fields[key] = ref('Action').merge(GUI.truthy?(event['description']) ? { 'description' => v09_text(event['description']) } : {})
      end
      (manifest['slots'] || {}).each { |key, kind| fields[key] = ref(kind == 'single' ? 'ComponentId' : 'ChildList') }
      ordered = { 'component' => { 'const' => name } }
      ((manifest['parameterOrder'] || []) + fields.keys).each do |key|
        ordered[renames.fetch(key, key)] = fields[key] if fields.key?(key)
      end
      required = props['required']
      body = {
        'properties' => ordered,
        'required' => ['component'] + (required.is_a?(Array) ? required : []).select { |key| key.is_a?(String) }.map { |key| renames.fetch(key, key) }
      }
      %w[$defs definitions].each { |key| body[key] = v09_schema(props[key]) if props[key].is_a?(Hash) }
      segment = name.gsub('~', '~0').gsub('/', '~1')
      text = manifest['description']
      text = props['description'] if text.nil?
      (text.is_a?(String) ? { 'description' => v09_text(text) } : {})
        .merge('allOf' => [ref('ComponentCommon'), rebase_refs(body, "#/components/#{segment}/allOf/1")])
    end

    def type_schema(type)
      trimmed = type.strip
      alternatives = trimmed.split('|', -1).map(&:strip)
      return { 'anyOf' => alternatives.map { |part| type_schema(part) } } if alternatives.length > 1
      return ref(DYNAMIC_REFS[trimmed]) if DYNAMIC_REFS.key?(trimmed)
      if trimmed.end_with?('[]')
        # The whole list can be bound or computed, like any other arg.
        return { 'anyOf' => [{ 'type' => 'array', 'items' => type_schema(trimmed[0...-2]) }, ref('DataBinding'), ref('FunctionCall')] }
      end
      ref('DynamicValue')
    end

    # The JSON Schema of the args of a built-in function, from its short signature.
    def args_schema_from_signature(signature)
      body = signature.strip.sub(/\A\{/, '').sub(/\}\z/, '')
      properties = {}
      required = []
      additional = false
      body.split(';', -1).each do |part|
        entry = part.strip
        next if entry.empty?
        if (index = /\A\[\w+: string\]:\s*(.+)\z/.match(entry))
          additional = type_schema(index[1])
          next
        end
        named = /\A(\w+)(\?)?:\s*(.+)\z/.match(entry)
        next unless named
        properties[named[1]] = type_schema(named[3])
        required << named[1] unless named[2]
      end
      result = { 'type' => 'object', 'properties' => properties }
      result['required'] = required unless required.empty?
      result['additionalProperties'] = additional
      result
    end

    def function_schema(name, description, return_type, parameters)
      result = { 'name' => name }
      result['description'] = v09_text(description) if GUI.truthy?(description)
      # v0.9 has no `validationResult`: its checks are boolean function calls.
      result['returnType'] = return_type == 'validationResult' ? 'boolean' : (return_type.nil? ? 'any' : return_type)
      result['parameters'] = parameters
      result
    end

    # The basic functions, then the app functions the renderer may call.
    def catalog_functions(functions)
      result = GUI::A2UI_BASIC_FUNCTIONS.reject { |name, _| functions.key?(name) }.map do |name, info|
        function_schema(name, info.description, info.return_type, args_schema_from_signature(info.parameters))
      end
      functions.each do |name, fn|
        result << function_schema(name, fn['description'], fn['returnType'], dynamic_properties(fn['parameters'])) if GUI.function_callers(fn)[0]
      end
      result
    end

    # The catalog id, then the components beyond the v0.9 basic catalog, by name.
    def capabilities(catalog_id, names)
      lines = ['Available A2UI catalog:']
      if names.nil?
        lines << "- #{catalog_id}"
        return lines.join("\n")
      end
      extra = names.reject { |name| V09_BASIC_COMPONENTS.include?(name) }
      superset = V09_BASIC_COMPONENTS.all? { |name| names.include?(name) }
      if catalog_id == V09_BASIC_CATALOG_ID && superset && extra.empty?
        lines << "- #{catalog_id} (basic catalog)"
        return lines.join("\n")
      end
      lines << "- #{catalog_id}"
      if superset
        lines << '  Extends the basic catalog with all standard components plus:'
      else
        lines << '  Custom catalog (does NOT include all basic components).'
        lines << '  Custom components:'
      end
      extra.each { |name| lines << "  - #{name}" }
      lines.join("\n")
    end

    # The A2UI v0.9 catalog context of a run, from the client's generative UI envelope.
    #
    # The entries are the ones the v0.9 client sent: capabilities, the component schema in
    # the v0.9 inline catalog format, and the v0.9 generation and design guidelines. The
    # components are the 18 basic ones of the standard catalog plus the UI's own components.
    # The catalog id is the v0.9 basic catalog id when the UI includes the standard catalog.
    # Returns [catalog id, context entries], or nil when the run has no envelope.
    def build_catalog_context(input)
      envelope = GUI.read_envelope(input['forwardedProps'])
      return nil if envelope.nil?
      manifest = GUI.envelope_to_manifest(envelope)
      ids = manifest.catalog_ids && !manifest.catalog_ids.empty? ? manifest.catalog_ids : [manifest.catalog_id]
      extends_standard = ids.include?(GUI::STANDARD_CATALOG_ID)
      catalog_id = extends_standard ? V09_BASIC_CATALOG_ID : manifest.catalog_id
      return [catalog_id, [{ 'description' => CAPABILITIES_DESCRIPTION, 'value' => capabilities(catalog_id, nil) }]] unless manifest.has_components
      components = {}
      manifest.components.each do |name, component|
        standard = extends_standard && STANDARD_COMPONENTS.include?(name)
        # Of the standard components, a v0.9 agent knows the basic ones only.
        next if standard && !V09_BASIC_COMPONENTS.include?(name)
        components[name] = component_schema(name, component, standard ? V10_TO_V09_PROP_NAMES.fetch(name, {}) : {})
      end
      schema = {
        'catalogId' => catalog_id,
        'components' => components,
        'functions' => catalog_functions(manifest.functions),
        'common_types.json' => { '$defs' => V09_COMMON_TYPES }
      }
      [catalog_id, [
        { 'description' => CAPABILITIES_DESCRIPTION, 'value' => capabilities(catalog_id, components.keys) },
        { 'description' => A2UI::SCHEMA_CONTEXT, 'value' => GUI.compact_json(schema) },
        { 'description' => GENERATION_GUIDELINES_DESCRIPTION, 'value' => DEFAULT_GENERATION_GUIDELINES },
        { 'description' => DESIGN_GUIDELINES_DESCRIPTION, 'value' => DEFAULT_DESIGN_GUIDELINES }
      ]]
    end

    # -----------------------------------------------------------------------
    # The bridge (`a2ui-v09-middleware.ts`)

    # The input of the agent side of a run; never mutates `input`.
    #
    # A click on a surface of v0.9 origin becomes the v0.9 action. A 0.9 agent also gets the
    # v0.9 catalog context; an entry with the same description is replaced. The runtime stores
    # the client's input, so the thread keeps the click message.
    def prepare_agent_input(input, agent_version)
      agent_input = downgrade_action(input, agent_version)
      return agent_input unless agent_version == '0.9'
      catalog = build_catalog_context(agent_input)
      return agent_input if catalog.nil?
      entries = catalog[1]
      descriptions = entries.map { |entry| entry['description'] }
      context = (agent_input['context'] || []).reject { |entry| entry.is_a?(Hash) && descriptions.include?(entry['description']) }
      agent_input.merge('context' => context + entries)
    end
  end
end
