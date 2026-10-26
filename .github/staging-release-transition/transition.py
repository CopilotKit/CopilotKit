"""One-time, manually authorized registry operation. Never calls Railway."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
BLOCKER_SCOPE = "pni-blocker-completion-20261026"
BLOCKER_IMAGES = {
    "ghcr.io/copilotkit/starter-ms-agent-framework-dotnet": {
        "digest": "sha256:c21c7daa96f691737764d16255f93c3240cf2e67900c1c318bc34784c4b312f8",
        "revision": "a446e1178d8803ea18921c8b5addca40d9bf4407",
        "previousLatest": "sha256:b3da669aedb07342ea342810b7058e646c51a61447da53c5f10afd1afd180cc5",
    },
    "ghcr.io/copilotkit/showcase-harness": {
        "digest": "sha256:797a40e2f7d7ae1ef5a55210a2e5de407aa831eae9e9fc708a9964c2f4fe970a",
        "revision": "362cd1319c7a610137c0d84e4f74155021e561c0",
        "previousLatest": "sha256:6cb970079b8888c843f6e93c50a732f81d959328aa536c04c50189990ccf46e1",
    },
}


def validate_branch(packet, ref):
    scope = packet.get("scope")
    if scope not in (None, BLOCKER_SCOPE):
        raise ValueError("Unsupported transition scope")
    branch = "codex/staging-wire-accepted-images" if scope == BLOCKER_SCOPE else "codex/staging-latest-policy-transition"
    if ref != "refs/heads/" + branch:
        raise ValueError("Packet scope is restricted to its reviewed branch")


def validate_packet(packet, allowed, mode):
    if packet.get("version") != 1 or mode not in ("inspect", "promote"):
        raise ValueError("Unsupported packet or operation")
    rows = packet.get("images", [])
    held = packet.get("held", [])
    scope = packet.get("scope")
    # Legacy full-fleet mode preserves its explicit .NET/harness holds.
    # Completion mode selects only those fixed blockers and preserves all others.
    if scope == BLOCKER_SCOPE:
        if not set(BLOCKER_IMAGES) <= allowed or not isinstance(held, list) or len(held) != len(set(held)) or set(held) != allowed - set(BLOCKER_IMAGES):
            raise ValueError("Blocker completion must preserve every other eligible image")
    elif scope is None:
        if not isinstance(held, list) or set(held) - {"ghcr.io/copilotkit/starter-ms-agent-framework-dotnet", "ghcr.io/copilotkit/showcase-harness"} or not set(held) <= allowed:
            raise ValueError("Only the explicitly held .NET and busy harness images may be omitted")
    else:
        raise ValueError("Unsupported transition scope")
    if mode == "promote":
        held_latest = packet.get("heldLatest", {})
        if set(held_latest) != set(held) or any(not isinstance(value, str) or not DIGEST.fullmatch(value) for value in held_latest.values()):
            raise ValueError("Promotion requires exact unchanged latest guards for every held image")
    names = [r.get("image") for r in rows]
    if len(names) != len(set(names)) or set(names) != allowed - set(held):
        raise ValueError("Image set must exactly match the eligible staging Node fleet")
    for row in rows:
        if scope == BLOCKER_SCOPE and any(row.get(key) != value for key, value in BLOCKER_IMAGES[row["image"]].items()):
            raise ValueError("Blocker candidate or preserved latest differs from the exact authorization")
        if not DIGEST.fullmatch(row.get("digest", "")) or not REVISION.fullmatch(row.get("revision", "")):
            raise ValueError("Each candidate must have an exact published digest and revision")
        if mode == "promote" and (
            packet.get("accepted") is not True
            or not DIGEST.fullmatch(row.get("previousLatest", ""))
        ):
            raise ValueError("Promotion requires an accepted packet and previous latest digests")
    return rows


def validate_config(config, revision):
    revisions, architectures, systems = set(), set(), set()
    stack = [config]
    while stack:
        item = stack.pop()
        if isinstance(item, list):
            stack.extend(item)
        elif isinstance(item, dict):
            for key, value in item.items():
                if key == "org.opencontainers.image.revision":
                    revisions.add(value)
                elif key == "architecture":
                    architectures.add(value)
                elif key == "os":
                    systems.add(value)
                if isinstance(value, (dict, list)):
                    stack.append(value)
    if revisions != {revision} or architectures != {"amd64"} or systems != {"linux"}:
        raise ValueError("Candidate must have matching revision and only linux/amd64 image configurations")


def run(*args):
    result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=90)
    return result.stdout.strip()


def digest(ref):
    value = run("docker", "buildx", "imagetools", "inspect", ref, "--format", "{{.Manifest.Digest}}")
    if not DIGEST.fullmatch(value):
        raise ValueError("Unresolvable manifest digest")
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["inspect", "promote"])
    parser.add_argument("--packet", required=True)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    raw = Path(args.packet).read_bytes()
    if hashlib.sha256(raw).hexdigest() != args.sha256:
        raise ValueError("Packet hash differs from the explicit dispatch authorization")
    if os.environ.get("AUTO_DEPLOY") != "false":
        raise ValueError("Controlled operation requires automatic deployment OFF")
    if args.mode == "promote" and os.environ.get("CONFIRM_ACCEPTED") != "true":
        raise ValueError("Manual acceptance confirmation required")
    services = json.loads(Path("showcase/scripts/railway-envs.generated.json").read_text())["services"]
    allowed = {
        "ghcr.io/copilotkit/" + s.get("repoNameOverride", {}).get("staging", s["name"])
        for s in services
        if not s["gateIgnore"] and s["name"] != "pocketbase" and s.get("stagingInstanceId")
    }
    packet = json.loads(raw)
    validate_branch(packet, os.environ.get("GITHUB_REF"))
    rows = validate_packet(packet, allowed, args.mode)
    output = Path("transition-receipt.json")
    receipt = {"operation": args.mode, "packetSha256": args.sha256, "rows": []}

    def save():
        temp = output.with_suffix(".tmp")
        temp.write_text(json.dumps(receipt, indent=2) + "\n")
        temp.replace(output)

    receipt["heldLatest"] = {}
    save()
    for image in packet.get("held", []):
        current = digest(image + ":latest")
        if args.mode == "promote" and current != packet["heldLatest"][image]:
            raise ValueError("Held latest moved since inspection: " + image)
        receipt["heldLatest"][image] = current
    save()
    # Read and validate the ENTIRE fleet before the first tag mutation.
    for row in rows:
        image = row["image"]
        candidate = image + "@" + row["digest"]
        if digest(candidate) != row["digest"] or digest(image + ":" + row["revision"]) != row["digest"]:
            raise ValueError("Published candidate identity mismatch: " + image)
        config = json.loads(run("docker", "buildx", "imagetools", "inspect", candidate, "--format", "{{json .Image}}"))
        validate_config(config, row["revision"])
        previous = digest(image + ":latest")
        if (args.mode == "promote" or packet.get("scope") == BLOCKER_SCOPE) and previous != row["previousLatest"]:
            raise ValueError("Latest moved since the reviewed inspection: " + image)
        receipt["rows"].append({**row, "previousLatest": previous, "inspected": True, "tagWriteReserved": False})
        save()
        print(json.dumps({"image": image, "inspected": True}), flush=True)
    if args.mode == "promote":
        for row in receipt["rows"]:
            image = row["image"]
            if digest(image + ":latest") != row["previousLatest"]:
                raise ValueError("Concurrent latest movement before write: " + image)
            row["tagWriteReserved"] = True
            save()
            run("docker", "buildx", "imagetools", "create", "--prefer-index=false", "--tag", image + ":latest", image + "@" + row["digest"])
            row["resultingLatest"] = digest(image + ":latest")
            save()
            if row["resultingLatest"] != row["digest"]:
                raise ValueError("Retag did not preserve accepted digest: " + image)
            print(json.dumps({"image": image, "acceptedDigestPromoted": True}), flush=True)
    for image, expected in receipt["heldLatest"].items():
        if digest(image + ":latest") != expected:
            raise ValueError("Held latest changed during the operation: " + image)
    receipt["heldLatestUnchanged"] = True
    receipt["complete"] = True
    save()


if __name__ == "__main__":
    main()
