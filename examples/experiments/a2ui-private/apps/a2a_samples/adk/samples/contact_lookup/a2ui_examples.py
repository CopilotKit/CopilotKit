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

# a2ui_examples.py

CONTACT_UI_EXAMPLES = """
---BEGIN CONTACT_LIST_EXAMPLE---
[
  { "beginRendering": { "surfaceId": "contact-list", "root": "root-column", "styles": { "primaryColor": "#007BFF", "font": "Roboto" } } },
  { "surfaceUpdate": {
    "surfaceId": "contact-list",
    "components": [
      { "id": "root-column", "component": { "Column": { "children": { "explicitList": ["title-heading", "item-list"] } } } },
      { "id": "title-heading", "component": { "Text": { "usageHint": "h1", "text": { "literalString": "Found Contacts" } } } },
      { "id": "item-list", "component": { "List": { "direction": "vertical", "children": { "template": { "componentId": "item-card-template", "dataBinding": "/contacts" } } } } },
      { "id": "item-card-template", "component": { "Card": { "child": "card-layout" } } },
      { "id": "card-layout", "component": { "Row": { "children": { "explicitList": ["template-image", "card-details", "view-button"] }, "alignment": "center" } } },
      { "id": "template-image", "component": { "Image": { "url": { "path": "imageUrl" }, "fit": "cover" } } },
      { "id": "card-details", "component": { "Column": { "children": { "explicitList": ["template-name", "template-title"] } } } },
      { "id": "template-name", "component": { "Text": { "usageHint": "h3", "text": { "path": "name" } } } },
      { "id": "template-title", "component": { "Text": { "text": { "path": "title" } } } },
      { "id": "view-button-text", "component": { "Text": { "text": { "literalString": "View" } } } },
      { "id": "view-button", "component": { "Button": { "child": "view-button-text", "primary": true, "action": { "name": "view_profile", "context": [ { "key": "contactName", "value": { "path": "name" } }, { "key": "department", "value": { "path": "department" } } ] } } } }
    ]
  } },
  { "dataModelUpdate": {
    "surfaceId": "contact-list",
    "path": "/",
    "contents": [
      {{ "key": "contacts", "valueMap": [
        {{ "key": "contact1", "valueMap": [
          {{ "key": "name", "valueString": "Alice Wonderland" }},
          {{ "key": "phone", "valueString": "+1-555-123-4567" }},
          {{ "key": "email", "valueString": "alice@example.com" }},
          {{ "key": "imageUrl", "valueString": "https://example.com/alice.jpg" }},
          {{ "key": "title", "valueString": "Mad Hatter" }},
          {{ "key": "department", "valueString": "Wonderland" }}
        ] }},
        {{ "key": "contact2", "valueMap": [
          {{ "key": "name", "valueString": "Bob The Builder" }},
          {{ "key": "phone", "valueString": "+1-555-765-4321" }},
          {{ "key": "email", "valueString": "bob@example.com" }},
          {{ "key": "imageUrl", "valueString": "https://example.com/bob.jpg" }},
          {{ "key": "title", "valueString": "Construction" }},
          {{ "key": "department", "valueString": "Building" }}
        ] }}
      ] }}
    ]
  } }
]
---END CONTACT_LIST_EXAMPLE---

---BEGIN CONTACT_CARD_EXAMPLE---

[
  { "beginRendering": { "surfaceId":"contact-card","root":"main_card"} },
  { "surfaceUpdate": { "surfaceId":"contact-card",
    "components":[
      { "id": "profile_image", "component": { "Image": { "url": { "path": "imageUrl"} } } } ,
      { "id": "user_heading", "weight": 1, "component": { "Text": { "text": { "path": "name"} , "usageHint": "h2"} } } ,
      { "id": "description_text_1", "component": { "Text": { "text": { "path": "title"} } } } ,
      { "id": "description_text_2", "component": { "Text": { "text": { "path": "team"} } } } ,
      { "id": "description_column", "component": { "Column": { "children": { "explicitList": ["user_heading", "description_text_1", "description_text_2"]} , "alignment": "center"} } } ,
      { "id": "calendar_icon", "component": { "Icon": { "name": { "literalString": "calendar_today"} } } } ,
      { "id": "calendar_primary_text", "component": { "Text": { "usageHint": "h5", "text": { "path": "calendar"} } } } ,
      { "id": "calendar_secondary_text", "component": { "Text": { "text": { "literalString": "Calendar"} } } } ,
      { "id": "calendar_text_column", "component": { "Column": { "children": { "explicitList": ["calendar_primary_text", "calendar_secondary_text"]} , "distribution": "start", "alignment": "start"} } } ,
      { "id": "info_row_1", "component": { "Row": { "children": { "explicitList": ["calendar_icon", "calendar_text_column"]} , "distribution": "start", "alignment": "start"} } } ,
      { "id": "location_icon", "component": { "Icon": { "name": { "literalString": "location_on"} } } } ,
      { "id": "location_primary_text", "component": { "Text": { "usageHint": "h5", "text": { "path": "location"} } } } ,
      { "id": "location_secondary_text", "component": { "Text": { "text": { "literalString": "Location"} } } } ,
      { "id": "location_text_column", "component": { "Column": { "children": { "explicitList": ["location_primary_text", "location_secondary_text"]} , "distribution": "start", "alignment": "start"} } } ,
      { "id": "info_row_2", "component": { "Row": { "children": { "explicitList": ["location_icon", "location_text_column"]} , "distribution": "start", "alignment": "start"} } } ,
      { "id": "mail_icon", "component": { "Icon": { "name": { "literalString": "mail"} } } } ,
      { "id": "mail_primary_text", "component": { "Text": { "usageHint": "h5", "text": { "path": "email"} } } } ,
      { "id": "mail_secondary_text", "component": { "Text": { "text": { "literalString": "Email"} } } } ,
      { "id": "mail_text_column", "component": { "Column": { "children": { "explicitList": ["mail_primary_text", "mail_secondary_text"]} , "distribution": "start", "alignment": "start"} } } ,
      { "id": "info_row_3", "component": { "Row": { "children": { "explicitList": ["mail_icon", "mail_text_column"]} , "distribution": "start", "alignment": "start"} } } ,
      { "id": "div", "component": { "Divider": { } } } , { "id": "call_icon", "component": { "Icon": { "name": { "literalString": "call"} } } } ,
      { "id": "call_primary_text", "component": { "Text": { "usageHint": "h5", "text": { "path": "mobile"} } } } ,
      { "id": "call_secondary_text", "component": { "Text": { "text": { "literalString": "Mobile"} } } } ,
      { "id": "call_text_column", "component": { "Column": { "children": { "explicitList": ["call_primary_text", "call_secondary_text"]} , "distribution": "start", "alignment": "start"} } } ,
      { "id": "info_row_4", "component": { "Row": { "children": { "explicitList": ["call_icon", "call_text_column"]} , "distribution": "start", "alignment": "start"} } } ,
      { "id": "info_rows_column", "weight": 1, "component": { "Column": { "children": { "explicitList": ["info_row_1", "info_row_2", "info_row_3", "info_row_4"]} , "alignment": "stretch"} } } ,
      { "id": "button_1_text", "component": { "Text": { "text": { "literalString": "Follow"} } } } , { "id": "button_1", "component": { "Button": { "child": "button_1_text", "primary": true, "action": { "name": "follow_profile"} } } } ,
      { "id": "button_2_text", "component": { "Text": { "text": { "literalString": "Message"} } } } , { "id": "button_2", "component": { "Button": { "child": "button_2_text", "primary": false, "action": { "name": "send_message"} } } } ,
      { "id": "action_buttons_row", "component": { "Row": { "children": { "explicitList": ["button_1", "button_2"]} , "distribution": "center", "alignment": "center"} } } ,
      { "id": "link_text", "component": { "Text": { "text": { "literalString": "[View Full Profile](/profile)"} } } } ,
      { "id": "link_text_wrapper", "component": { "Row": { "children": { "explicitList": ["link_text"]} , "distribution": "center", "alignment": "center"} } } ,
      { "id": "main_column", "component": { "Column": { "children": { "explicitList": ["profile_image", "description_column", "div", "info_rows_column", "action_buttons_row", "link_text_wrapper"]} , "alignment": "stretch"} } } ,
      { "id": "main_card", "component": { "Card": { "child": "main_column"} } }
    ]
  } },
  { "dataModelUpdate": {
    "surfaceId": "contact-card",
    "path": "/",
    "contents": [
      { "key": "name", "valueString": "" },
      { "key": "title", "valueString": "" },
      { "key": "team", "valueString": "" },
      { "key": "location", "valueString": "" },
      { "key": "email", "valueString": "" },
      { "key": "mobile", "valueString": "" },
      { "key": "calendar", "valueString": "" },
      { "key": "imageUrl", "valueString": "" }
    ]
  } }
]
---END CONTACT_CARD_EXAMPLE---

---BEGIN ACTION_CONFIRMATION_EXAMPLE---
[
  { "beginRendering": { "surfaceId": "action-modal", "root": "modal-wrapper", "styles": { "primaryColor": "#007BFF", "font": "Roboto" } } },
  { "surfaceUpdate": {
    "surfaceId": "action-modal",
    "components": [
      { "id": "modal-wrapper", "component": { "Modal": { "entryPointChild": "hidden-entry-point", "contentChild": "modal-content-column" } } },
      { "id": "hidden-entry-point", "component": { "Text": { "text": { "literalString": "" } } } },
      { "id": "modal-content-column", "component": { "Column": { "children": { "explicitList": ["modal-title", "modal-message", "dismiss-button"] }, "alignment": "center" } } },
      { "id": "modal-title", "component": { "Text": { "usageHint": "h2", "text": { "path": "actionTitle" } } } },
      { "id": "modal-message", "component": { "Text": { "text": { "path": "actionMessage" } } } },
      { "id": "dismiss-button-text", "component": { "Text": { "text": { "literalString": "Dismiss" } } } },
      { "id": "dismiss-button", "component": { "Button": { "child": "dismiss-button-text", "primary": true, "action": { "name": "dismiss_modal" } } } }
    ]
  } },
  { "dataModelUpdate": {
    "surfaceId": "action-modal",
    "path": "/",
    "contents": [
      { "key": "actionTitle", "valueString": "Action Confirmation" },
      { "key": "actionMessage", "valueString": "Your action has been processed." }
    ]
  } }
]
---END ACTION_CONFIRMATION_EXAMPLE---
"""
