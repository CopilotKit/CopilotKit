# frozen_string_literal: true
require 'uri'
require 'ipaddr'

module CopilotKit
  # Sanitized project display metadata. This data does not grant resource access.
  module InspectorMetadata
    # Copy supported V1 fields into native Hash values, preserving optional modules.
    # @return [Hash, nil] A V1 hash, or nil for an unsupported schema.
    def self.parse(value)
      return nil unless value.is_a?(Hash) && [Integer, Float].any? { |type| value['schemaVersion'].is_a?(type) } && value['schemaVersion'] == 1
      result = { 'schemaVersion' => 1 }
      identity = object(value['identity'])
      organization, project = text(identity['organizationName']), text(identity['projectName'])
      result['identity'] = { 'organizationName' => organization, 'projectName' => project } if organization && project
      plan = object(value['plan'])
      code, label = text(plan['code']), text(plan['label'])
      result['plan'] = { 'code' => code, 'label' => label } if code && label
      state = object(value['license'])['state']
      result['license'] = { 'state' => state.dup } if %w[valid none expired unknown].include?(state)
      action = object(value['action'])
      action_url = safe_url(action['url'])
      if %w[manage_plan renew enable_intelligence].include?(action['kind']) && action_url
        result['action'] = { 'kind' => action['kind'].dup, 'url' => action_url }
      end
      usage = object(value['usage'])
      used = integer(usage['used'])
      limit = object(usage['limit'])
      parsed_limit = case limit['kind']
      when 'finite'
        count = integer(limit['value'], 1)
        { 'kind' => 'finite', 'value' => count } if count
      when 'unlimited' then { 'kind' => 'unlimited' }
      when 'unknown' then { 'kind' => 'unknown' }
      end
      if used && parsed_limit
        result['usage'] = { 'used' => used, 'limit' => parsed_limit }
        expiring = integer(usage['expiringSoonCount'])
        result['usage']['expiringSoonCount'] = expiring if expiring
      end
      result
    end

    def self.object(value)
      value.is_a?(Hash) ? value : {}
    end

    def self.text(value)
      return nil unless value.is_a?(String) && value.valid_encoding?
      # Match the whitespace set used by the TypeScript parser, including BOM but not NEL.
      cleaned = value.encode(Encoding::UTF_8).gsub(/\A[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+\z/, '')
      cleaned.empty? ? nil : cleaned
    rescue EncodingError
      nil
    end

    def self.integer(value, minimum = 0)
      return nil unless value.is_a?(Integer) || value.is_a?(Float)
      return nil unless value.finite? && value >= minimum && value <= 9_007_199_254_740_991 && value == value.to_i
      value.to_i
    end

    def self.safe_url(value)
      raw = text(value)
      return nil unless raw && !raw.include?('?') && !raw.include?('#') && raw.include?('://')
      authority = raw.split('://', 2).last.split('/', 2).first.to_s
      return nil if authority.include?('@')
      parsed = URI(raw.tr('\\', '/'))
      return nil unless parsed.is_a?(URI::HTTP) && parsed.host && !parsed.host.empty? && !parsed.userinfo && parsed.port.between?(0, 65_535)
      host = URI::DEFAULT_PARSER.unescape(parsed.hostname).downcase
      return nil if host.each_char.any? { |character| character.ord <= 32 || '%#/<>?@[]\\^|'.include?(character) }
      return raw if parsed.scheme == 'https'
      loopback = %w[localhost 127.0.0.1].include?(host)
      loopback ||= host.include?(':') && IPAddr.new(host) == IPAddr.new('::1')
      loopback ? raw : nil
    rescue URI::InvalidURIError, IPAddr::InvalidAddressError, ArgumentError
      nil
    end

    private_class_method :object, :text, :integer, :safe_url
  end
end
