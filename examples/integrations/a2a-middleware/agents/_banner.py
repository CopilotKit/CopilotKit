"""Startup banner shared by this starter's three agents.

All three deliberately bind ``0.0.0.0`` so the rest of ``npm run dev`` (and
containers, and other devices) can reach them. A banner that prints only
``localhost`` therefore tells a developer the service is on loopback while it
is on every interface, and the developer who checks has been told the opposite
of what is true.

So print both, the way ``next dev`` already does for this starter's own UI on
the same machine: a ``Local`` line and a separate ``Network`` line.
"""

from __future__ import annotations

import socket

_LOOPBACK = ("127.0.0.1", "localhost", "::1")
_WILDCARD = ("0.0.0.0", "::", "")


def _lan_address() -> str | None:
    """Best-effort address of this machine on its default route.

    ``connect`` on a UDP socket sends no packets — it only fixes the peer in
    the kernel's routing table — so this is a local routing lookup that
    contacts nothing. The peer is TEST-NET-1 (RFC 5737), which is never routed.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("192.0.2.1", 1))
        return str(sock.getsockname()[0])
    except OSError:
        return None
    finally:
        sock.close()


def print_banner(title: str, host: str, port: int, *details: str) -> None:
    """Print ``title``, then the address(es) ``host`` actually exposes."""
    print(title)

    if host in _WILDCARD:
        print(f"   - Local:    http://localhost:{port}")
        lan = _lan_address()
        print(
            f"   - Network:  http://{lan}:{port}"
            if lan
            else f"   - Network:  port {port} on every interface"
        )
        print(f"     (bound to {host} — reachable from your local network)")
    elif host in _LOOPBACK:
        print(f"   - Local:    http://{host}:{port}")
    else:
        print(f"   - Address:  http://{host}:{port}")

    for detail in details:
        print(f"   {detail}")
