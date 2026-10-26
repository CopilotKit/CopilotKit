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


def validate_packet(packet, allowed, mode):
    if packet.get("version") != 1 or mode not in ("inspect", "promote"):
        raise ValueError("Unsupported packet or operation")
    rows = packet.get("images", [])
    held = packet.get("held", [])
    # Preserve the user-held PNI-700 image and the busy harness fleet, whose
    # known active-drain defect prevents safe acceptance in this transition.
    # Their running images and shared latest pointers must remain unchanged.
    if not isinstance(held, list) or set(held) - {"ghcr.io/copilotkit/starter-ms-agent-framework-dotnet", "ghcr.io/copilotkit/showcase-harness"} or not set(held) <= allowed:
        raise ValueError("Only the explicitly held .NET and busy harness images may be omitted")
    names = [r.get("image") for r in rows]
    if len(names) != len(set(names)) or set(names) != allowed - set(held):
        raise ValueError("Image set must exactly match the eligible staging Node fleet")
    for row in rows:
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
    if os.environ.get("GITHUB_REF") != "refs/heads/codex/staging-latest-policy-transition":
        raise ValueError("This one-time operation is restricted to its reviewed branch")
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
    rows = validate_packet(packet, allowed, args.mode)
    output = Path("transition-receipt.json")
    receipt = {"operation": args.mode, "packetSha256": args.sha256, "rows": []}

    def save():
        temp = output.with_suffix(".tmp")
        temp.write_text(json.dumps(receipt, indent=2) + "\n")
        temp.replace(output)

    # Read and validate the ENTIRE fleet before the first tag mutation.
    for row in rows:
        image = row["image"]
        candidate = image + "@" + row["digest"]
        if digest(candidate) != row["digest"] or digest(image + ":" + row["revision"]) != row["digest"]:
            raise ValueError("Published candidate identity mismatch: " + image)
        config = json.loads(run("docker", "buildx", "imagetools", "inspect", candidate, "--format", "{{json .Image}}"))
        validate_config(config, row["revision"])
        previous = digest(image + ":latest")
        if args.mode == "promote" and previous != row["previousLatest"]:
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
    receipt["complete"] = True
    save()


if __name__ == "__main__":
    main()
