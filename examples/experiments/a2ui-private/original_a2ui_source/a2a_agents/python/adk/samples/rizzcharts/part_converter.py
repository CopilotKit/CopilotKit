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

import json
import jsonschema
import logging
from typing import Any, List

from a2a import types as a2a_types
from google.genai import types as genai_types

from google.adk.a2a.converters import part_converter
from a2ui.a2ui_extension import create_a2ui_part
from a2ui_toolset import SendA2uiJsonToClientTool

logger = logging.getLogger(__name__)

class A2uiPartConverter:

  def __init__(self):
      self._a2ui_schema = None

  def set_a2ui_schema(self, a2ui_schema: dict[str, Any]):
      self._a2ui_schema = a2ui_schema    
      
  def convert_genai_part_to_a2a_part(self, part: genai_types.Part) -> List[a2a_types.Part]:
      if (function_call := part.function_call) and function_call.name == SendA2uiJsonToClientTool.TOOL_NAME:
          if self._a2ui_schema is None:
              raise Exception("A2UI schema is not set in part converter")
          
          try:
            a2ui_json = function_call.args.get(SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME)
            if a2ui_json is None:
                raise ValueError(f"Failed to convert A2UI function call because required arg {SendA2uiJsonToClientTool.A2UI_JSON_ARG_NAME} not found in {str(part)}")
            if not a2ui_json.strip():
                logger.info("Empty a2ui_json, skipping")
                return []
            
            logger.info(f"Converting a2ui json: {a2ui_json}")

            json_data = json.loads(a2ui_json)            
            a2ui_schema_object = {"type": "array", "items": self._a2ui_schema} # Make a list since we support multiple parts in this tool call
            jsonschema.validate(
                  instance=json_data, schema=a2ui_schema_object
              )          

            final_parts = []
            if isinstance(json_data, list):
                logger.info( f"Found {len(json_data)} messages. Creating individual DataParts." )
                for message in json_data:
                  final_parts.append(create_a2ui_part(message))
            else:
                # Handle the case where a single JSON object is returned
                logger.info("Received a single JSON object. Creating a DataPart." )
                final_parts.append(create_a2ui_part(json_data))

            return final_parts
          except Exception as e:
              logger.error(f"Error converting A2UI function call to A2A parts: {str(e)}")
              return []
          
      # Don't send a2ui tool responses
      elif (function_response := part.function_response) and function_response.name == SendA2uiJsonToClientTool.TOOL_NAME:    
          return []
      
      # Use default part converter for other types (images, etc)
      converted_part = part_converter.convert_genai_part_to_a2a_part(part)

      logger.info(f"Returning converted part: {converted_part}" )
      return [converted_part] if converted_part else []
