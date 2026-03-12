import json
from langchain.tools import tool

@tool
def generate_form() -> str:
  """
  Generates a login form for the user to sign in.
  """
  components = [
      {
          "id": "root",
          "component": {
              "Card": {
                  "child": "main-column"
              }
          }
      },
      {
          "id": "main-column",
          "component": {
              "Column": {
                  "children": {
                      "explicitList": [
                          "header",
                          "email-field",
                          "password-field",
                          "login-btn",
                          "divider",
                          "signup-text"
                      ]
                  },
                  "gap": "medium"
              }
          }
      },
      {
          "id": "header",
          "component": {
              "Column": {
                  "children": {
                      "explicitList": [
                          "title",
                          "subtitle"
                      ]
                  },
                  "alignment": "center"
              }
          }
      },
      {
          "id": "title",
          "component": {
              "Text": {
                  "text": {
                      "literalString": "Welcome back"
                  },
                  "usageHint": "h2"
              }
          }
      },
      {
          "id": "subtitle",
          "component": {
              "Text": {
                  "text": {
                      "literalString": "Sign in to your account"
                  },
                  "usageHint": "caption"
              }
          }
      },
      {
          "id": "email-field",
          "component": {
              "TextField": {
                  "value": {
                      "path": "/email"
                  },
                  "placeholder": {
                      "literalString": "Email address"
                  },
                  "label": {
                      "literalString": "Email"
                  },
                  "action": "updateEmail"
              }
          }
      },
      {
          "id": "password-field",
          "component": {
              "TextField": {
                  "value": {
                      "path": "/password"
                  },
                  "placeholder": {
                      "literalString": "Password"
                  },
                  "label": {
                      "literalString": "Password"
                  },
                  "action": "updatePassword"
              }
          }
      },
      {
          "id": "login-btn-text",
          "component": {
              "Text": {
                  "text": {
                      "literalString": "Sign in"
                  }
              }
          }
      },
      {
          "id": "login-btn",
          "component": {
              "Button": {
                  "child": "login-btn-text",
                  "action": "login"
              }
          }
      },
      {
          "id": "divider",
          "component": {
              "Divider": {}
          }
      },
      {
          "id": "signup-text",
          "component": {
              "Row": {
                  "children": {
                      "explicitList": [
                          "no-account",
                          "signup-link"
                      ]
                  },
                  "distribution": "center",
                  "gap": "small"
              }
          }
      },
      {
          "id": "no-account",
          "component": {
              "Text": {
                  "text": {
                      "literalString": "Don't have an account?"
                  },
                  "usageHint": "caption"
              }
          }
      },
      {
          "id": "signup-link-text",
          "component": {
              "Text": {
                  "text": {
                      "literalString": "Sign up"
                  }
              }
          }
      },
      {
          "id": "signup-link",
          "component": {
              "Button": {
                  "child": "signup-link-text",
                  "action": "signup"
              }
          }
      }
  ]

  return json.dumps([
      {
          "surfaceUpdate": {
              "surfaceId": "login-form",
              "components": components
          }
      },
      {
          "beginRendering": {
              "surfaceId": "login-form",
              "root": "root"
          }
      }
  ])
