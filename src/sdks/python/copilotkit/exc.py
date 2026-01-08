"""Exceptions for CopilotKit."""

class ActionNotFoundException(Exception):
    """Exception raised when an action or agent is not found."""

    def __init__(self, name: str):
        self.name = name
        super().__init__(f"Action '{name}' not found.")

class AgentNotFoundException(Exception):
    """Exception raised when an agent is not found."""

    def __init__(self, name: str):
        self.name = name
        super().__init__(f"Agent '{name}' not found.")

class ActionExecutionException(Exception):
    """Exception raised when an action fails to execute."""

    def __init__(self, name: str, error: Exception):
        self.name = name
        self.error = error
        super().__init__(f"Action '{name}' failed to execute: {error}")

class AgentExecutionException(Exception):
    """Exception raised when an agent fails to execute."""

    def __init__(self, name: str, error: Exception):
        self.name = name
        self.error = error
        super().__init__(f"Agent '{name}' failed to execute: {error}")
