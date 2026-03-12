#!/bin/bash

SCHEMA_DIR="/Users/gspencer/code/a2ui/specification/0.9"
SERVER_SCHEMA="${SCHEMA_DIR}/server_to_client.json"
COMMON_TYPES="${SCHEMA_DIR}/common_types.json"
COMPONENT_CATALOG="${SCHEMA_DIR}/component_catalog.json"
EXAMPLE_FILE="${SCHEMA_DIR}/contact_form_example.jsonl"
TEMP_FILE="${SCHEMA_DIR}/temp_message.json"

while read -r line; do
  echo "$line" | jq '.' > "${TEMP_FILE}"
  if [ $? -ne 0 ]; then
    echo "jq failed to parse line: $line"
    continue
  fi
  ajv validate --verbose -s "${SERVER_SCHEMA}" -r "${COMMON_TYPES}" -r "${COMPONENT_CATALOG}" --spec=draft2020 -d "${TEMP_FILE}"
  if [ $? -ne 0 ]; then
    echo "Validation failed for line: $line"
  fi
done < "${EXAMPLE_FILE}"

rm "${TEMP_FILE}"

echo "Validation complete."
