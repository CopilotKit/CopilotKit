"""
Shared helpers for reading the signed-in user from the demo token.

Both the agent (through the run config) and the file routes (through the
Authorization header) use these, so the same user identity guards both.
"""

import base64
import binascii
import json
from typing import Any, Dict, Optional


def get_user_info_from_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decodes user information from a JWT-like token.

    NOTE: This is a simplified decoder for demonstration purposes and does NOT
    perform signature verification. In a production environment, always use a
    trusted JWT library (e.g., PyJWT) to validate the token's signature
    and claims.
    """
    if not token:
        return None

    try:
        parts = token.split('.')
        if len(parts) != 3:
            # Not a valid JWT format
            return None

        payload = parts[1]

        # Add padding if necessary and decode
        padded_payload = payload + '=' * (-len(payload) % 4)
        decoded_payload = base64.urlsafe_b64decode(padded_payload).decode('utf-8')
        user_data = json.loads(decoded_payload)

        user_id = user_data.get("sub") or user_data.get("user_id")
        if not user_id:
            return None

        return {
            "user_id": user_id,
            "name": user_data.get("name"),
            "email": user_data.get("email"),
            "role": user_data.get("role"),
        }
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError, AttributeError) as e:
        print(f"Failed to decode token: {e}")
        return None


def get_user_info_from_authorization(authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    """Decodes the user from an authorization value, with or without the "Bearer " prefix."""
    if not authorization or not isinstance(authorization, str):
        return None
    token = authorization[len("Bearer "):] if authorization.startswith("Bearer ") else authorization
    return get_user_info_from_token(token)
