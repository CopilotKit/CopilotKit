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

from functools import cache
from typing import Any, List, Optional
from pathlib import Path
import json
import logging
from agent import RIZZCHARTS_CATALOG_URI
from a2ui.a2ui_extension import STANDARD_CATALOG_ID, SUPPORTED_CATALOG_IDS_KEY, INLINE_CATALOGS_KEY
logger = logging.getLogger(__name__)


class ComponentCatalogBuilder:
    def __init__(self, a2ui_schema_path: str, uri_to_local_catalog_path: dict[str, str], default_catalog_uri: Optional[str]):
        self._a2ui_schema_path = a2ui_schema_path
        self._uri_to_local_catalog_path = uri_to_local_catalog_path
        self._default_catalog_uri = default_catalog_uri
        pass

    @cache
    def get_file_content(self, path: str) -> str:
        return Path(path).read_text()

    def load_a2ui_schema(self, client_ui_capabilities: Optional[dict[str, Any]]) -> tuple[dict[str, Any], Optional[str]]:
        """
        Returns:
            A tuple of the a2ui_schema and the catalog uri
        """
        try: 
            logger.info(f"Loading A2UI client capabilities {client_ui_capabilities}")
                 
            if client_ui_capabilities:                                
                supported_catalog_uris: List[str] = client_ui_capabilities.get(SUPPORTED_CATALOG_IDS_KEY)
                if RIZZCHARTS_CATALOG_URI in supported_catalog_uris:
                    catalog_uri = RIZZCHARTS_CATALOG_URI
                elif STANDARD_CATALOG_ID in supported_catalog_uris:
                    catalog_uri = STANDARD_CATALOG_ID
                else:
                    catalog_uri = None

                inline_catalog_str = client_ui_capabilities.get(INLINE_CATALOGS_KEY)                
            elif self._default_catalog_uri:
                logger.info(f"Using default catalog {self._default_catalog_uri} since client UI capabilities not found")
                catalog_uri = self._default_catalog_uri
                inline_catalog_str = None
            else:
                raise ValueError("Client UI capabilities not provided")        
            
            if catalog_uri and inline_catalog_str:
                raise ValueError(f"Cannot set both {SUPPORTED_CATALOG_IDS_KEY} and {INLINE_CATALOGS_KEY} in ClientUiCapabilities: {client_ui_capabilities}")    
            elif catalog_uri:
                if local_path := self._uri_to_local_catalog_path.get(catalog_uri):
                    logger.info(f"Loading local component catalog with uri {catalog_uri} and local path {local_path}")
                    catalog_str = self.get_file_content(local_path)
                    catalog_json = json.loads(catalog_str)
                else:
                    raise ValueError(f"Local component catalog with URI {catalog_uri} not found")
            elif inline_catalog_str:
                logger.info(f"Loading inline component catalog {inline_catalog_str[:200]}")
                catalog_json = json.loads(inline_catalog_str)
            else:
                raise ValueError("Client UI capabilities not provided")

            logger.info(f"Loading A2UI schema at {self._a2ui_schema_path}")
            a2ui_schema = self.get_file_content(self._a2ui_schema_path)
            a2ui_schema_json = json.loads(a2ui_schema)

            a2ui_schema_json["properties"]["surfaceUpdate"]["properties"]["components"]["items"]["properties"]["component"]["properties"] = catalog_json
            
            return a2ui_schema_json, catalog_uri
    
        except Exception as e:
            logger.error(f"Failed to a2ui schema with client ui capabilities {client_ui_capabilities}: {e}")
            raise e     

        