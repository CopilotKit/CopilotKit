/**
 * This file contains various errors thrown by the CopilotKit. They are all extended from Error.
 */

export enum Severity {
  Info = "info",
  Warning = "warning",
  Error = "error",
}

export enum ErrorType {
  CPKError = "CPKError",
  ConfigurationError = "ConfigurationError",
  MissingPublicApiKeyError = "MissingPublicApiKeyError",
  UpgradeRequiredError = "UpgradeRequiredError",
}

export class CPKError extends Error {
  severity: Severity;
  constructor(message: string, severity: Severity) {
    super(message);
    this.name = ErrorType.CPKError;
    this.severity = severity;
  }
}

export class ConfigurationError extends CPKError {
  constructor(message: string) {
    super(message, Severity.Error);
    this.name = ErrorType.ConfigurationError;
    this.severity = Severity.Error;
  }
}

export class MissingPublicApiKeyError extends ConfigurationError {
  constructor(message: string) {
    super(message);
    this.name = ErrorType.MissingPublicApiKeyError;
  }
}

export class UpgradeRequiredError extends CPKError {
  constructor(message: string) {
    super(message, Severity.Warning);
    this.name = ErrorType.UpgradeRequiredError;
  }
}
