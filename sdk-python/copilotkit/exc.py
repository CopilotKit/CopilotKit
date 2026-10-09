"""Exceptions for CopilotKit."""


class CopilotKitError(Exception):
    """Base exception for all CopilotKit errors.

    Catch this to handle any CopilotKit-specific exception.
    """

    pass


class ActionNotFoundException(CopilotKitError):
    """Exception raised when an action or agent is not found."""

    def __init__(self, name: str):
        self.name = name
        super().__init__(f"Action '{name}' not found.")


class AgentNotFoundException(CopilotKitError):
    """Exception raised when an agent is not found."""

    def __init__(self, name: str):
        self.name = name
        super().__init__(f"Agent '{name}' not found.")


class ActionExecutionException(CopilotKitError):
    """Exception raised when an action fails to execute."""

    def __init__(self, name: str, error: Exception):
        self.name = name
        self.error = error
        super().__init__(f"Action '{name}' failed to execute: {error}")


class AgentExecutionException(CopilotKitError):
    """Exception raised when an agent fails to execute."""

    def __init__(self, name: str, error: Exception):
        self.name = name
        self.error = error
        super().__init__(f"Agent '{name}' failed to execute: {error}")


class CopilotKitMisuseError(CopilotKitError, ValueError):
    """Exception raised when CopilotKit detects incorrect usage of its APIs.

    Inherits from both CopilotKitError (for ``except CopilotKitError``) and
    ValueError (for backward compatibility with ``except ValueError`` handlers).
    """

    pass
