"""Strands-specific wrapper for Code Interpreter - import shim."""

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

from tools.code_interpreter.code_interpreter_tools import CodeInterpreterTools
from strands import tool


class StrandsCodeInterpreterTools:
    """Strands wrapper for Code Interpreter tools."""

    def __init__(self, region: str):
        """
        Initialize Strands Code Interpreter tools.

        Args:
            region: AWS region for code interpreter
        """
        self.core_tools = CodeInterpreterTools(region)

    def cleanup(self):
        """
        Clean up code interpreter session.

        Note: AgentCore automatically cleans up inactive sessions after timeout,
        so manual cleanup is optional but recommended for immediate resource release.
        """
        self.core_tools.cleanup()

    @tool
    def execute_python_securely(self, code: str) -> str:
        """
        Execute Python code in a secure AgentCore CodeInterpreter sandbox.

        Args:
            code: Python code to execute

        Returns:
            JSON string with execution result
        """
        return self.core_tools.execute_python_securely(code)
