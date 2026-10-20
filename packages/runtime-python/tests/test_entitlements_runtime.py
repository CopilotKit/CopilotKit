import httpx
import pytest

from copilotkit_intelligence import Intelligence
from copilotkit_runtime import IntelligenceRuntime


async def test_runtime_info_uses_the_shared_sdk_cache_and_legacy_normalization():
    payload = {
        "organizationId": "org",
        "active": True,
        "source": "managedOrgSubscription",
        "features": {},
        "limits": {},
    }
    requests = []

    def platform(request):
        requests.append(request)
        return httpx.Response(200, json=payload)

    async with httpx.AsyncClient(transport=httpx.MockTransport(platform)) as http:
        sdk = Intelligence(api_key="server-key", http_client=http)
        direct = await sdk.get_runtime_entitlements()
        runtime = IntelligenceRuntime(intelligence=sdk, agents={}, identify_user=lambda _: None)
        async with (
            runtime.app.router.lifespan_context(runtime.app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser,
        ):
            response = await browser.get("/copilotkit/info")

    assert response.status_code == 200
    assert response.json()["runtimeEntitlements"] == direct
    assert response.json()["licenseStatus"] == "valid"
    assert len(requests) == 1


@pytest.mark.parametrize(
    "status, payload, expected_status, retryable, license_status",
    [
        (401, {}, "misconfigured", False, "none"),
        (200, {}, "misconfigured", False, "none"),
        (503, {}, "unavailable", True, "unknown"),
        (
            200,
            {
                "status": "degraded",
                "error": {"code": "WAIT", "message": "Try later", "retryable": True},
            },
            "degraded",
            True,
            "unknown",
        ),
    ],
)
async def test_runtime_info_retains_entitlement_failure_semantics(
    status, payload, expected_status, retryable, license_status
):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(status, json=payload))
    ) as http:
        sdk = Intelligence(api_key="server-key", http_client=http)
        runtime = IntelligenceRuntime(intelligence=sdk, agents={}, identify_user=lambda _: None)
        async with (
            runtime.app.router.lifespan_context(runtime.app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=runtime), base_url="http://runtime"
            ) as browser,
        ):
            response = await browser.get("/copilotkit/info")

    assert response.status_code == 200
    entitlement = response.json()["runtimeEntitlements"]
    assert entitlement["status"] == expected_status
    assert entitlement["error"]["retryable"] is retryable
    assert response.json()["licenseStatus"] == license_status
