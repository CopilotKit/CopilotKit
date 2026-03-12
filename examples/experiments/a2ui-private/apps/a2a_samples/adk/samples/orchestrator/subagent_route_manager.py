# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
from typing import Optional
from google.adk.agents.invocation_context import new_invocation_context_id
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.sessions.base_session_service import BaseSessionService
from google.adk.sessions.session import Session
from google.adk.sessions.state import State


class SubagentRouteManager:
  """Manages routing of tasks to sub-agents."""

  ROUTING_KEY_PREFIX = "route_to_subagent_name_for_surface_id_"

  @classmethod
  def _get_routing_key(cls, surface_id: str) -> str:
    return cls.ROUTING_KEY_PREFIX + surface_id

  @classmethod
  async def get_route_to_subagent_name(
      cls, surface_id: str, state: State
  ) -> Optional[str]:
    """Gets the subagent route for the given tool call id."""
    subagent_name = state.get(cls._get_routing_key(surface_id), None)
    logging.info("Got subagent route for surface_id %s to subagent_name %s", surface_id, subagent_name)    
    return subagent_name

  @classmethod
  async def set_route_to_subagent_name(
      cls,
      surface_id: str,
      subagent_name: str,
      session_service: BaseSessionService,
      session: Session,
  ):
    """Sets the subagent route for the given tool call id."""
    key = cls._get_routing_key(surface_id)    

    if session.state.get(key) != subagent_name:
      await session_service.append_event(
          session,
          Event(
              invocation_id=new_invocation_context_id(),
              author="system",
              actions=EventActions(state_delta={key: subagent_name}),
          ),
      )

      logging.info("Set subagent route for surface_id %s to subagent_name %s", surface_id, subagent_name)