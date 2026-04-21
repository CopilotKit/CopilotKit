"""
Authentication utilities for agent patterns.

Provides secure user identity extraction from JWT tokens in the AgentCore Runtime
RequestContext (prevents impersonation via prompt injection).
"""

import logging
import os

import jwt
from bedrock_agentcore.identity.auth import requires_access_token
from bedrock_agentcore.runtime import RequestContext

logger = logging.getLogger(__name__)


def extract_user_id_from_context(context: RequestContext) -> str:
    """
    Securely extract the user ID from the JWT token in the request context.

    AgentCore Runtime validates the JWT token before passing it to the agent,
    so we can safely skip signature verification here. The user ID is taken
    from the token's 'sub' claim rather than from the request payload, which
    prevents impersonation via prompt injection.

    Args:
        context (RequestContext): The request context provided by AgentCore
            Runtime, containing validated request headers including the
            Authorization JWT.

    Returns:
        str: The user ID (sub claim) extracted from the validated JWT token.

    Raises:
        ValueError: If the Authorization header is missing or the JWT does
            not contain a 'sub' claim.
    """
    request_headers = context.request_headers
    if not request_headers:
        raise ValueError(
            "No request headers found in context. "
            "Ensure the AgentCore Runtime is configured with a request header allowlist "
            "that includes the Authorization header."
        )

    auth_header = request_headers.get("Authorization")
    if not auth_header:
        raise ValueError(
            "No Authorization header found in request context. "
            "Ensure the AgentCore Runtime is configured with JWT inbound auth "
            "and the Authorization header is in the request header allowlist."
        )

    # Remove "Bearer " prefix to get the raw JWT token
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else auth_header

    # Decode without signature verification — AgentCore Runtime already validated the token.
    # We use options to skip all verification since this is a trusted, pre-validated token.
    claims = jwt.decode(
        jwt=token,
        options={"verify_signature": False},
        algorithms=["RS256"],
    )

    user_id = claims.get("sub")
    if not user_id:
        raise ValueError("JWT token does not contain a 'sub' claim. Cannot determine user identity.")

    logger.info("Extracted user_id from JWT: %s", user_id)
    return user_id


@requires_access_token(provider_name=os.environ.get("GATEWAY_CREDENTIAL_PROVIDER_NAME", ""), auth_flow="M2M", scopes=[])
def get_gateway_access_token(access_token: str) -> str:
    """
    Fetch OAuth2 access token for AgentCore Gateway authentication.

    The @requires_access_token decorator handles token retrieval and refresh:
    1. Token Retrieval: Calls GetResourceOauth2Token API to fetch token from Token Vault
    2. Automatic Refresh: Uses refresh tokens to renew expired access tokens
    3. Error Orchestration: Handles missing tokens and OAuth flow management

    For M2M (Machine-to-Machine) flows, the decorator uses Client Credentials grant type.
    The provider_name must match the Name field in the CDK OAuth2CredentialProvider resource.

    This is synchronous because it's called during agent setup before the async
    message processing loop.
    """
    return access_token
