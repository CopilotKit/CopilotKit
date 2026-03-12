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

from typing import Any
import logging

logger = logging.getLogger(__name__)


def get_store_sales() -> dict[str, Any]:
    """
    Gets individual store sales

    Returns:
        A dict containing the stores with locations and their sales, and with outlier stores highlighted
    """

    return {
        "center": {"lat": 34, "lng": -118.2437},
        "zoom": 10,
        "locations": [
            {
                "lat": 34.0195,
                "lng": -118.4912,
                "name": "Santa Monica Branch",
                "description": "High traffic coastal location.",
                "outlier_reason": "Yes, 15% sales over baseline",
                "background": "#4285F4",
                "borderColor": "#FFFFFF",
                "glyphColor": "#FFFFFF",
            },
            {"lat": 34.0488, "lng": -118.2518, "name": "Downtown Flagship"},
            {"lat": 34.1016, "lng": -118.3287, "name": "Hollywood Boulevard Store"},
            {"lat": 34.1478, "lng": -118.1445, "name": "Pasadena Location"},
            {"lat": 33.7701, "lng": -118.1937, "name": "Long Beach Outlet"},
            {"lat": 34.0736, "lng": -118.4004, "name": "Beverly Hills Boutique"},
        ],
    }


def get_sales_data() -> dict[str, Any]:
    """
    Gets the sales data.

    Returns:
        A dict containing the sales breakdown by product category.
    """

    return {
        "sales_data": [
            {
                "label": "Apparel",
                "value": 41,
                "drillDown": [
                    {"label": "Tops", "value": 31},
                    {"label": "Bottoms", "value": 38},
                    {"label": "Outerwear", "value": 20},
                    {"label": "Footwear", "value": 11},
                ],
            },
            {
                "label": "Home Goods",
                "value": 15,
                "drillDown": [
                    {"label": "Pillow", "value": 8},
                    {"label": "Coffee Maker", "value": 16},
                    {"label": "Area Rug", "value": 3},
                    {"label": "Bath Towels", "value": 14},
                ],
            },
            {
                "label": "Electronics",
                "value": 28,
                "drillDown": [
                    {"label": "Phones", "value": 25},
                    {"label": "Laptops", "value": 27},
                    {"label": "TVs", "value": 21},
                    {"label": "Other", "value": 27},
                ],
            },
            {"label": "Health & Beauty", "value": 10},
            {"label": "Other", "value": 6},
        ]
    }
