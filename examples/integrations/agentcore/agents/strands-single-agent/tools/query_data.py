# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import os

from strands import tool


@tool
def query_data(query: str) -> str:
    """
    Query financial data from the database. Use this tool to fetch data before
    rendering any charts. Returns CSV-formatted data relevant to the query.
    """
    db_path = os.path.join(os.path.dirname(__file__), "db.csv")
    try:
        with open(db_path) as f:
            content = f.read()
        return content
    except FileNotFoundError:
        return "No data available."
