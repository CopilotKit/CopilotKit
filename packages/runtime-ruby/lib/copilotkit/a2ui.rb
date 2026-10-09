# frozen_string_literal: true
require 'set'
module CopilotKit
  # A2UI 0.9 transform compatible with middleware 0.0.10. State belongs to one run.
  class A2UI
    SCHEMA_CONTEXT = 'A2UI Component Schema — available components for generating UI surfaces. Use these component names and properties when creating A2UI operations.'
    BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/basic_catalog.json'

    def initialize(config)
      @config = config
      @names = Set.new(config.fetch('a2uiToolNames', ['render_a2ui']))
      @tool_name = config['injectA2UITool'].is_a?(String) ? config['injectA2UITool'] : 'render_a2ui'
      @names << @tool_name if config['injectA2UITool']
      @calls, @painted, @outer, @attempts = {}, Set.new, nil, Hash.new(0)
      @retrying = Set.new
    end

    # Adds server-owned schema and tool context without mutating browser input.
    def prepare(input)
      result = Marshal.load(Marshal.dump(input))
      entry = result.fetch('context', []).find { |context| context['description'] == SCHEMA_CONTEXT }
      if entry && entry['value'].is_a?(String)
        frontend_schema = JSON.parse(entry['value'])
        @frontend_catalog = frontend_schema['catalogId'] if frontend_schema.is_a?(Hash)
      end
      action = result.dig('forwardedProps', 'a2uiAction', 'userAction')
      if action.is_a?(Hash)
        id = SecureRandom.uuid
        result['messages'] ||= []
        result['messages'] << { 'id' => SecureRandom.uuid, 'role' => 'assistant', 'content' => '', 'toolCalls' => [
          { 'id' => id, 'type' => 'function', 'function' => { 'name' => 'log_a2ui_event', 'arguments' => JSON.generate(action) } }
        ] }
        text = "User performed action \"#{action.fetch('name', 'unknown_action')}\" on surface \"#{action.fetch('surfaceId', 'unknown_surface')}\""
        text += " (component: #{action['sourceComponentId']})" if action['sourceComponentId']
        text += '. Context: ' + JSON.generate(action.fetch('context', {}))
        result['messages'] << { 'id' => SecureRandom.uuid, 'role' => 'tool', 'toolCallId' => id, 'content' => text }
      end
      result['context'] ||= []
      if @config['schema'] && !@config['schema'].empty?
        result['context'].reject! { |context| context['description'] == SCHEMA_CONTEXT }
        result['context'] << { 'description' => SCHEMA_CONTEXT, 'value' => JSON.generate(@config['schema']) }
      end
      if @config['injectA2UITool']
        result['tools'] = result.fetch('tools', []).reject { |tool| tool['name'] == @tool_name } + [tool]
        result['forwardedProps'] = result.fetch('forwardedProps', {}).merge('injectA2UITool' => @config['injectA2UITool'])
        description = "A2UI render tool usage guide — how to call #{@tool_name} with valid arguments."
        result['context'].reject! { |context| context['description'] == description }
        result['context'] << { 'description' => description, 'value' => "Call #{@tool_name} with surfaceId, components, and optional data. Use flat v0.9 components with unique id and component fields. Include id root. Reference child IDs, never nest components or create cycles. Only use catalog types and required properties. Bind with {\"path\":\"/key\"}. Repeat via children:{componentId,path}. The host owns catalogId; do not choose it." }
      end
      result
    rescue JSON::ParserError
      @frontend_catalog = nil
      # Invalid frontend schema is ignored, as in the reference middleware.
      sanitized = input.merge('context' => input.fetch('context', []).reject { |context| context['description'] == SCHEMA_CONTEXT })
      prepare(sanitized)
    end

    # Returns only generated events; the caller preserves original AG-UI events.
    def accept(event)
      events = []
      id = event['toolCallId']
      case event['type']
      when 'TOOL_CALL_START'
        if @names.include?(event['toolCallName'])
          key = @outer || id
          @attempts[key] += 1
          @calls[id] = { args: '', key: key, painted: false, resolved: false, count: 0, tokens: 0 }
          events << activity(key, 'status' => 'building') unless @retrying.include?(key)
        elsif !%w[log_a2ui_event].include?(event['toolCallName'])
          @outer = id
        end
      when 'TOOL_CALL_ARGS'
        call = @calls[id]
        return events unless call
        call[:args] += event.fetch('delta', '')
        raise Error.new(502, 'A2UI arguments exceeded size limit') if call[:args].bytesize > 1_048_576
        tokens = (call[:args].length / 4.0).round
        if @config.dig('recovery', 'showProgressTokens') != false && !call[:painted] && !call[:rejected] && !@retrying.include?(call[:key]) && tokens - call[:tokens] >= 20
          call[:tokens] = tokens
          events << activity(call[:key], 'status' => 'building', 'progressTokens' => tokens)
        end
        events.concat(progress(call))
      when 'TOOL_CALL_RESULT'
        @calls[id][:resolved] = true if @calls[id]
        parsed = parse_result(event['content'])
        if parsed.is_a?(Hash) && parsed['a2ui_operations'].is_a?(Array)
          ops = parsed['a2ui_operations'].select { |operation| operation.is_a?(Hash) && !@painted.include?(surface_id(operation)) }
          groups = ops.group_by { |operation| surface_id(operation) || 'default' }
          groups.each do |surface, group|
            key = @outer || id
            key = "#{surface}-#{key}" if groups.length > 1
            events << activity(key, 'a2ui_operations' => group)
          end
        elsif parsed.is_a?(Hash) && parsed['code'] == 'a2ui_recovery_exhausted'
          events << activity(@outer || id, 'status' => 'failed', 'error' => parsed.fetch('error', 'A2UI generation failed'),
                             'attempts' => parsed.fetch('attempts', []), 'maxAttempts' => parsed.fetch('attempts', []).length)
        end
        @outer = nil if @outer == id
      end
      events
    end

    # Completes only render calls that do not already have an agent result.
    def finish
      @calls.filter_map do |id, call|
        next if call[:resolved]
        { 'type' => 'TOOL_CALL_RESULT', 'messageId' => SecureRandom.uuid, 'toolCallId' => id, 'content' => JSON.generate('status' => 'rendered') }
      end
    end

    private

    def tool
      { 'name' => @tool_name, 'description' => 'Render a dynamic A2UI v0.9 surface with structured parameters. Follow the A2UI render tool usage guide provided in context.',
        'parameters' => { 'type' => 'object', 'properties' => { 'surfaceId' => { 'type' => 'string' },
          'components' => { 'type' => 'array', 'items' => { 'type' => 'object' } }, 'data' => { 'type' => 'object' } }, 'required' => %w[surfaceId components] } }
    end

    def activity(key, content)
      exposure = @config.dig('recovery', 'debugExposure')
      content = content.merge('debugExposure' => exposure) if exposure && content['status']
      { 'type' => 'ACTIVITY_SNAPSHOT', 'messageId' => "a2ui-surface-#{key}", 'activityType' => 'a2ui-surface', 'content' => content, 'replace' => true }
    end

    def progress(call)
      return [] if call[:rejected]
      surface = field(call[:args], 'surfaceId')
      return [] unless surface.is_a?(String) && !surface.empty?
      components = field(call[:args], 'components')
      events = []
      if components.is_a?(Array) && !call[:painted]
        errors = validate(components)
        unless errors.empty?
          call[:rejected] = true
          @retrying << call[:key]
          maximum = @config.dig('recovery', 'maxAttempts') || 3
          return [activity(call[:key], 'status' => 'retrying', 'attempt' => [@attempts[call[:key]] + 1, maximum].min, 'maxAttempts' => maximum, 'errors' => errors)]
        end
        call[:components] = components
        call[:surface] = surface
        streamed_catalog = field(call[:args], 'catalogId')
        streamed_catalog = nil if streamed_catalog == 'basic'
        call[:catalog] = [@config['defaultCatalogId'], @frontend_catalog, streamed_catalog].find { |id| id.is_a?(String) && !id.empty? } || BASIC_CATALOG
        call[:painted] = true
        @retrying.delete(call[:key])
        @painted << surface
        repeated = components.find { |component| component['children'].is_a?(Hash) && component['children']['path'].is_a?(String) }
        call[:data_key] = repeated ? repeated['children']['path'].sub(%r{\A/}, '') : 'items'
        events << snapshot(call)
      end
      return events unless call[:painted] && !call[:data_complete]
      data = field(call[:args], 'data')
      if data.is_a?(Hash)
        call[:data_complete] = true
        events << snapshot(call, data)
      else
        data_start = field_start(call[:args], 'data')
        items = data_start && partial_array(call[:args][data_start..-1], call[:data_key])
        if items && items.length > call[:count]
          call[:count] = items.length
          events << snapshot(call, call[:data_key] => items)
        end
      end
      events
    end

    def snapshot(call, data = nil)
      surface = call[:surface]
      operations = [
        { 'version' => 'v0.9', 'createSurface' => { 'surfaceId' => surface, 'catalogId' => call[:catalog] } },
        { 'version' => 'v0.9', 'updateComponents' => { 'surfaceId' => surface, 'components' => call[:components] } }
      ]
      operations << { 'version' => 'v0.9', 'updateDataModel' => { 'surfaceId' => surface, 'path' => '/', 'value' => data } } if data
      activity(call[:key], 'a2ui_operations' => operations)
    end

    def parse_result(content)
      parsed = JSON.parse(content)
      parsed = JSON.parse(parsed) if parsed.is_a?(String)
      parsed
    rescue JSON::ParserError, TypeError
      nil
    end

    def surface_id(operation)
      %w[createSurface updateComponents updateDataModel deleteSurface].each do |key|
        return operation[key]['surfaceId'] if operation[key].is_a?(Hash) && operation[key]['surfaceId']
      end
      nil
    end

    # Finds field boundaries lexically so quoted JSON inside strings is not mistaken for structure.
    def field_start(text, name)
      index = 0
      while index < text.length
        if text[index] == '"'
          ending = string_end(text, index)
          return nil unless ending
          key = JSON.parse(text[index..ending])
          next_index = ending + 1
          next_index += 1 while text[next_index]&.match?(/\s/)
          if key == name && text[next_index] == ':'
            next_index += 1
            next_index += 1 while text[next_index]&.match?(/\s/)
            return next_index
          end
          index = ending
        end
        index += 1
      end
      nil
    end

    def string_end(text, start)
      escaped = false
      ((start + 1)...text.length).each do |index|
        char = text[index]
        return index if char == '"' && !escaped
        escaped = char == '\\' && !escaped
      end
      nil
    end

    def value_end(text, start)
      return string_end(text, start) if text[start] == '"'
      unless ['{', '['].include?(text[start])
        ending = text.index(/[\s,\]}]/, start)
        return ending && ending > start ? ending - 1 : nil
      end
      stack, index = [], start
      while index < text.length
        char = text[index]
        if char == '"'
          index = string_end(text, index)
          return nil unless index
        elsif ['{', '['].include?(char)
          stack << char
        elsif ['}', ']'].include?(char)
          stack.pop
          return index if stack.empty?
        end
        index += 1
      end
      nil
    end

    def field(text, name)
      start = field_start(text, name)
      ending = start && value_end(text, start)
      ending && JSON.parse(text[start..ending])
    rescue JSON::ParserError
      nil
    end

    def partial_array(text, name)
      start = field_start(text, name)
      return nil unless start && text[start] == '['
      index, items = start + 1, []
      loop do
        index += 1 while text[index]&.match?(/[\s,]/)
        ending = value_end(text, index)
        break unless ending
        items << JSON.parse(text[index..ending])
        index = ending + 1
      end
      items
    rescue JSON::ParserError
      nil
    end

    # Semantic gate: IDs, root, catalog, required properties, refs, and cycles.
    def validate(components)
      errors = []
      add = ->(code, path) { errors << { 'code' => code, 'path' => path, 'message' => code.tr('_', ' ') } }
      return [{ 'code' => 'empty_components', 'path' => 'components', 'message' => 'A2UI components must be a non-empty array' }] if components.empty?
      ids = components.filter_map { |component| component['id'] if component.is_a?(Hash) }
      ids.group_by(&:itself).each { |id, matches| add.call('duplicate_id', "components[id=#{id}]") if matches.length > 1 }
      add.call('no_root', 'components') unless ids.include?('root')
      catalog = @config['schema'].is_a?(Hash) ? @config['schema']['components'] : nil
      edges = {}
      components.each_with_index do |component, index|
        unless component.is_a?(Hash)
          add.call('missing_id', "components[#{index}].id")
          next
        end
        id, type = component.values_at('id', 'component')
        add.call('missing_id', "components[#{index}].id") unless id.is_a?(String) && !id.empty?
        add.call('missing_component_type', "components[#{index}].component") unless type.is_a?(String) && !type.empty?
        schema = catalog && catalog[type]
        if catalog && !catalog.empty?
          add.call('unknown_component', "components[#{index}].component") unless schema
          (schema || {}).fetch('required', []).each { |prop| add.call('missing_required_prop', "components[#{index}].#{prop}") unless component.key?(prop) }
        end
        refs = references(component, schema)
        refs.each { |ref| add.call('unresolved_child', "components[#{index}]") unless ids.include?(ref) }
        edges[id] = refs
      end
      visited, visiting = Set.new, Set.new
      visit = lambda do |id|
        if visiting.include?(id)
          add.call('child_cycle', "components[id=#{id}]")
          return
        end
        return if visited.include?(id)
        visiting << id
        (edges[id] || []).each { |child| visit.call(child) }
        visiting.delete(id)
        visited << id
      end
      edges.each_key { |id| visit.call(id) }
      errors
    end

    def references(component, schema)
      collect = lambda do |value|
        values = value.is_a?(Array) ? value : [value]
        values.filter_map { |entry| entry.is_a?(String) ? entry : (entry.is_a?(Hash) ? entry['componentId'] : nil) }
      end
      refs = collect.call(component['child']) + collect.call(component['children'])
      (schema || {}).fetch('properties', {}).each do |field, property|
        next unless property.is_a?(Hash) && !%w[child children].include?(field)
        if %w[componentRef componentRefList].include?(property['format'])
          refs.concat(collect.call(component[field]))
        elsif property['type'] == 'array' && component[field].is_a?(Array)
          property.fetch('items', {}).fetch('properties', {}).each do |sub, sub_schema|
            next unless %w[componentRef componentRefList].include?(sub_schema['format'])
            component[field].each { |item| refs.concat(collect.call(item[sub])) if item.is_a?(Hash) }
          end
        end
      end
      refs
    end
  end
end
