import { CopilotKitLowLevelError, CopilotKitErrorCode } from "@copilotkit/shared";

/**
 * Converts service adapter errors to structured CopilotKitError format using HTTP status codes.
 * This provides consistent error classification across all service adapters.
 */
export function convertServiceAdapterError(
  error: any,
  adapterName: string,
): CopilotKitLowLevelError {
  const errorName = error?.constructor?.name || error.name;
  const errorMessage = error?.message || String(error);
  const statusCode = error.status || error.statusCode || error.response?.status;
  const responseData = error.error || error.response?.data || error.data;

  // Create the base error with the constructor signature
  const structuredError = new CopilotKitLowLevelError({
    error: error instanceof Error ? error : new Error(errorMessage),
    url: `${adapterName} service adapter`,
    message: `${adapterName} API error: ${errorMessage}`,
  });

  // Add additional properties after construction
  if (statusCode) {
    (structuredError as any).statusCode = statusCode;
  }
  if (responseData) {
    (structuredError as any).responseData = responseData;
  }
  if (errorName) {
    (structuredError as any).originalErrorType = errorName;
  }

  // Classify error based on HTTP status codes (reliable and provider-agnostic)
  let newCode: CopilotKitErrorCode;

  if (statusCode === 401) {
    // 401 = Authentication/API key issues
    newCode = CopilotKitErrorCode.AUTHENTICATION_ERROR;
  } else if (statusCode >= 400 && statusCode < 500) {
    // 4xx = Client errors (bad request, invalid params, etc.) - these are configuration issues
    newCode = CopilotKitErrorCode.CONFIGURATION_ERROR;
  } else if (statusCode >= 500) {
    // 5xx = Server errors - keep as NETWORK_ERROR since it's infrastructure related
    newCode = CopilotKitErrorCode.NETWORK_ERROR;
  } else if (statusCode) {
    // Any other HTTP status with an error - likely configuration
    newCode = CopilotKitErrorCode.CONFIGURATION_ERROR;
  } else {
    // No status code - likely a genuine network/connection error
    newCode = CopilotKitErrorCode.NETWORK_ERROR;
  }

  // Update both the instance property and the extensions
  (structuredError as any).code = newCode;
  if ((structuredError as any).extensions) {
    (structuredError as any).extensions.code = newCode;
  }

  return structuredError;
}
