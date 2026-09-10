# frozen_string_literal: true
require 'json'

module CopilotKit
  # Strict normalization of current and legacy Runtime entitlement responses.
  module RuntimeEntitlements
    SOURCES = %w[managedOrgSubscription selfHostedDeploymentLicense awsMarketplaceDeploymentLicense].freeze
    module_function

    # Return a separate JSON-compatible value for each caller and cache entry.
    def copy(value)
      JSON.parse(JSON.generate(value))
    end

    def keys?(value, required, optional = [])
      value.is_a?(Hash) && (required - value.keys).empty? && (value.keys - required - optional).empty?
    end

    def boolean?(value)
      value == true || value == false
    end

    def grant?(value)
      return false unless keys?(value, %w[active source features limits], %w[planCode entitlementSource])
      return false unless boolean?(value['active']) && SOURCES.include?(value['source'])
      return false unless value['features'].is_a?(Hash) && value['features'].all? { |key, flag| key.is_a?(String) && boolean?(flag) }
      return false unless value['limits'].is_a?(Hash) && value['limits'].all? do |key, number|
        key.is_a?(String) && (number.is_a?(Integer) || number.is_a?(Float)) && number.to_f.finite?
      end
      %w[planCode entitlementSource].all? { |key| !value.key?(key) || value[key].is_a?(String) }
    end

    # @return [Hash, nil] A published response union, or nil for invalid authority.
    def parse(value)
      return nil unless value.is_a?(Hash)
      if value['status'] == 'ready' && keys?(value, %w[status entitlement]) && grant?(value['entitlement'])
        return copy(value)
      end
      if %w[degraded misconfigured unavailable].include?(value['status']) && keys?(value, %w[status error])
        error = value['error']
        return nil unless keys?(error, %w[code message retryable], %w[requestId traceId])
        return nil unless error['code'].is_a?(String) && error['message'].is_a?(String) && boolean?(error['retryable'])
        return nil unless %w[requestId traceId].all? { |key| !error.key?(key) || error[key].is_a?(String) }
        return copy(value)
      end
      if value['organizationId'].is_a?(String)
        grant = value.reject { |key, _| key == 'organizationId' }
        return copy('status' => 'ready', 'entitlement' => grant) if grant?(grant)
      end
      nil
    end
  end
end
