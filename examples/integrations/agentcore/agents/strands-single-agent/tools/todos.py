# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

from typing import Literal, TypedDict

from strands import tool


class Todo(TypedDict):
    id: str
    title: str
    description: str
    emoji: str
    status: Literal["pending", "completed"]


@tool
def manage_todos(todos: list) -> str:
    """
    Manage the current todos. Replaces the entire todo list.
    Each todo should have: id (str), title (str), description (str), emoji (str), status ('pending' or 'completed').
    """
    return "Todos updated successfully"
