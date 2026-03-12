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

from typing import Optional
import logging

from a2a import types as a2a_types
from google.genai import types as genai_types

from google.adk.a2a.converters import part_converter
from a2ui.a2ui_extension import is_a2ui_part

import pydantic

logger = logging.getLogger(__name__)

def convert_a2a_part_to_genai_part(
    a2a_part: a2a_types.Part,
) -> Optional[genai_types.Part]:           
    if is_a2ui_part(a2a_part):                
        genai_part = genai_types.Part(text=a2a_part.model_dump_json())
        logger.info(f'Converted A2UI part from A2A: {a2a_part.model_dump_json(exclude_none=True)} to GenAI: {genai_part.model_dump_json(exclude_none=True)}'[:200] + "...")    
        return genai_part
        
    return part_converter.convert_a2a_part_to_genai_part(a2a_part)

def convert_genai_part_to_a2a_part(    
    part: genai_types.Part,
) -> Optional[a2a_types.Part]:
    if part.text:
        try:
            a2a_part = a2a_types.Part.model_validate_json(part.text)
            if is_a2ui_part(a2a_part):           
                logger.info(f'Converted A2UI part from GenAI: {part.model_dump_json(exclude_none=True)} to A2A: {a2a_part.model_dump_json(exclude_none=True)}'[:200] + "...")    
                return a2a_part        
        except pydantic.ValidationError:
            # Expected for normal text input
            pass
        
    return part_converter.convert_genai_part_to_a2a_part(part)