"""
Partial Json.

Parsing ChatGPT JSON stream response — Partial and incomplete JSON parser python library for OpenAI
"""
from .json_parser import JSONParser

__version__ = "0.0.8"
__author__ = 'Nima Akbarzadeh'
__author_email__ = "iw4p@protonmail.com"
__license__ = "MIT"
__url__ = "https://github.com/iw4p/partialjson"

PYPI_SIMPLE_ENDPOINT: str = "https://pypi.org/project/partialjson"

__all__ = [
    "JSONParser",
    "PYPI_SIMPLE_ENDPOINT",
]