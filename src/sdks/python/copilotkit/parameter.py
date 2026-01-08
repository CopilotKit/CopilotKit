"""Parameter classes for CopilotKit"""

from typing import TypedDict, Optional, Literal, List, Union, cast, Any
from typing_extensions import NotRequired

class SimpleParameter(TypedDict):
    """Simple parameter class"""
    name: str
    description: NotRequired[str]
    required: NotRequired[bool]
    type: NotRequired[Literal[
        "number", 
        "boolean",
        "number[]", 
        "boolean[]"
    ]]

class ObjectParameter(TypedDict):
    """Object parameter class"""
    name: str
    description: NotRequired[str]
    required: NotRequired[bool]
    type: Literal["object", "object[]"]
    attributes: List['Parameter']

class StringParameter(TypedDict):
    """String parameter class"""
    name: str
    description: NotRequired[str]
    required: NotRequired[bool]
    type: Literal["string", "string[]"]
    enum: NotRequired[List[str]]

Parameter = Union[SimpleParameter, ObjectParameter, StringParameter]

def normalize_parameters(parameters: Optional[List[Parameter]]) -> List[Parameter]:
    """Normalize the parameters to ensure they have the correct type and format."""
    if parameters is None:
        return []
    return [_normalize_parameter(parameter) for parameter in parameters]

def _normalize_parameter(parameter: Parameter) -> Parameter:
    """Normalize a parameter to ensure it has the correct type and format."""
    if not "type" in parameter:
        cast(Any, parameter)['type'] = 'string'
    if not 'required' in parameter:
        parameter['required'] = True
    if not 'description' in parameter:
        parameter['description'] = ''

    if 'type' in parameter and (parameter['type'] == 'object' or parameter['type'] == 'object[]'):
        cast(Any, parameter)['attributes'] = normalize_parameters(parameter.get('attributes'))
    return parameter
