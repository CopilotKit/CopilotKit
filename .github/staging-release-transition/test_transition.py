import importlib.util
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class TransitionTest(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name("transition.py")
        self.assertTrue(path.exists(), "Controlled transition validator is missing")
        spec = importlib.util.spec_from_file_location("transition", path)
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.row = {
            "image": "ghcr.io/copilotkit/showcase-shell",
            "digest": "sha256:" + "a" * 64,
            "revision": "b" * 40,
        }
        self.packet = {"version": 1, "accepted": False, "images": [self.row]}
        self.allowed = {self.row["image"]}

    def test_exact_inspection_packet(self):
        self.assertEqual(self.m.validate_packet(self.packet, self.allowed, "inspect"), [self.row])

    def test_missing_or_duplicate_images_rejected(self):
        for rows in [[], [self.row, self.row]]:
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                self.m.validate_packet({**self.packet, "images": rows}, self.allowed, "inspect")

    def test_only_the_explicit_user_held_dotnet_image_can_be_omitted(self):
        dotnet = "ghcr.io/copilotkit/starter-ms-agent-framework-dotnet"
        packet = {**self.packet, "held": [dotnet]}
        try:
            result = self.m.validate_packet(packet, self.allowed | {dotnet}, "inspect")
        except ValueError:
            self.fail("Explicit user-held .NET image is not supported")
        self.assertEqual(result, [self.row])
        with self.assertRaises(ValueError):
            self.m.validate_packet({**self.packet, "held": [self.row["image"]], "images": []}, self.allowed, "inspect")

    def test_known_busy_harness_can_be_preserved_without_retagging(self):
        harness = "ghcr.io/copilotkit/showcase-harness"
        packet = {**self.packet, "held": [harness]}
        self.assertEqual(self.m.validate_packet(packet, self.allowed | {harness}, "inspect"), [self.row])
        with self.assertRaises(ValueError):
            self.m.validate_packet({**packet, "images": [self.row, {**self.row, "image": harness}]}, self.allowed | {harness}, "inspect")

    def test_promotion_requires_exact_held_latest_pointer_guards(self):
        harness = "ghcr.io/copilotkit/showcase-harness"
        packet = {**self.packet, "accepted": True, "held": [harness], "images": [{**self.row, "previousLatest": "sha256:" + "c" * 64}]}
        with self.assertRaises(ValueError):
            self.m.validate_packet(packet, self.allowed | {harness}, "promote")
        packet["heldLatest"] = {harness: "sha256:" + "d" * 64}
        self.assertEqual(self.m.validate_packet(packet, self.allowed | {harness}, "promote"), packet["images"])
        for guards in [{}, {harness: "latest"}, {harness: "sha256:" + "d" * 64, self.row["image"]: "sha256:" + "c" * 64}]:
            with self.subTest(guards=guards), self.assertRaises(ValueError):
                self.m.validate_packet({**packet, "heldLatest": guards}, self.allowed | {harness}, "promote")

    def test_arbitrary_repository_or_tag_is_rejected(self):
        for field, value in [("image", "ghcr.io/other/project"), ("digest", "latest"), ("revision", "main")]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.m.validate_packet({**self.packet, "images": [{**self.row, field: value}]}, self.allowed, "inspect")

    def test_promotion_requires_acceptance_and_previous_digest(self):
        with self.assertRaises(ValueError):
            self.m.validate_packet(self.packet, self.allowed, "promote")
        with self.assertRaises(ValueError):
            self.m.validate_packet({**self.packet, "accepted": True}, self.allowed, "promote")
        row = {**self.row, "previousLatest": "sha256:" + "c" * 64}
        self.assertEqual(self.m.validate_packet({**self.packet, "accepted": True, "images": [row]}, self.allowed, "promote"), [row])

    def test_revision_must_be_unambiguous(self):
        config = {"config": {"Labels": {"org.opencontainers.image.revision": self.row["revision"]}}, "architecture": "amd64", "os": "linux"}
        self.m.validate_config(config, self.row["revision"])
        for value in [{}, {"a": config, "b": {"org.opencontainers.image.revision": "c" * 40}}, {**config, "architecture": "arm64"}, {**config, "os": "windows"}]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.m.validate_config(value, self.row["revision"])

    def test_workflow_has_no_railway_or_deploy_authority(self):
        workflow = Path(__file__).parents[1] / "workflows" / "staging_node_security.yml"
        text = workflow.read_text()
        self.assertNotIn("RAILWAY_TOKEN", text)
        self.assertNotIn("workflow_run:", text)
        self.assertNotIn("push:", text)
        self.assertIn("vars.SHOWCASE_AUTO_REDEPLOY == 'false'", text)
        self.assertIn("packages: read", text)
        self.assertIn("packages: write", text)
        self.assertIn("inputs.confirm_accepted", text)
        self.assertEqual(text.count("github.ref == 'refs/heads/codex/staging-latest-policy-transition'"), 2)

    def orchestration(self, failure):
        second = {**self.row, "image": "ghcr.io/copilotkit/showcase-other"}
        rows = [{**r, "previousLatest": "sha256:" + "c" * 64} for r in [self.row, second]]
        calls, reads = [], {}
        held = ["ghcr.io/copilotkit/showcase-harness"] if failure in ["held-preflight", "held-read", "held-postread"] else []
        config = json.dumps({"architecture": "amd64", "os": "linux", "config": {"Labels": {"org.opencontainers.image.revision": self.row["revision"]}}})

        def inspect(ref):
            reads[ref] = reads.get(ref, 0) + 1
            if ref == "ghcr.io/copilotkit/showcase-harness:latest":
                if failure == "held-read":
                    raise RuntimeError("held pointer read unavailable")
                return "sha256:" + ("d" if failure == "held-preflight" or (failure == "held-postread" and reads[ref] > 1) else "c") * 64
            if failure == "preflight" and "showcase-other@" in ref:
                raise RuntimeError("unresolvable second candidate")
            if ref.endswith(":latest"):
                if failure == "concurrent" and reads[ref] == 2:
                    return "sha256:" + "d" * 64
                if reads[ref] > 2:
                    return "sha256:" + ("d" if failure == "postread" else "a") * 64
                return "sha256:" + "c" * 64
            return self.row["digest"]

        def command(*args):
            if "create" in args:
                receipt = json.loads(Path("transition-receipt.json").read_text())
                image = args[args.index("--tag") + 1].removesuffix(":latest")
                self.assertTrue(next(r for r in receipt["rows"] if r["image"] == image)["tagWriteReserved"])
                calls.append(args)
                if failure == "uncertain":
                    raise RuntimeError("create outcome uncertain")
                return ""
            return config

        old = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            os.chdir(directory)
            try:
                Path("showcase/scripts").mkdir(parents=True)
                Path("showcase/scripts/railway-envs.generated.json").write_text(json.dumps({"services": [{"name": name, "gateIgnore": False, "stagingInstanceId": "id", "repoNameOverride": {"staging": "showcase-" + name}} for name in ["shell", "other"] + (["harness"] if held else [])]}))
                raw = json.dumps({"version": 1, "accepted": True, "images": rows, "held": held, "heldLatest": {image: "sha256:" + "c" * 64 for image in held}}).encode()
                Path("packet.json").write_bytes(raw)
                args = ["transition.py", "promote", "--packet", "packet.json", "--sha256", hashlib.sha256(raw).hexdigest()]
                env = {"AUTO_DEPLOY": "false", "CONFIRM_ACCEPTED": "true", "GITHUB_REF": "refs/heads/codex/staging-latest-policy-transition"}
                with patch("sys.argv", args), patch.dict(os.environ, env), patch.object(self.m, "digest", side_effect=inspect), patch.object(self.m, "run", side_effect=command):
                    if failure:
                        with self.assertRaises((RuntimeError, ValueError)):
                            self.m.main()
                    else:
                        self.m.main()
                receipt = json.loads(Path("transition-receipt.json").read_text())
                self.assertEqual(receipt.get("complete", False), not bool(failure))
                if failure in ["held-preflight", "held-read", "held-postread"]:
                    self.assertFalse(receipt.get("heldLatestUnchanged", False))
                return calls
            finally:
                os.chdir(old)

    def test_held_pointer_mismatch_precedes_all_retags(self):
        self.assertEqual(self.orchestration("held-preflight"), [])

    def test_held_pointer_read_failure_precedes_all_retags(self):
        self.assertEqual(self.orchestration("held-read"), [])

    def test_held_pointer_postread_change_cannot_complete(self):
        self.assertEqual(len(self.orchestration("held-postread")), 2)

    def test_entire_fleet_preflight_precedes_any_write(self):
        self.assertEqual(self.orchestration("preflight"), [])

    def test_concurrent_movement_blocks_write(self):
        self.assertEqual(self.orchestration("concurrent"), [])

    def test_uncertain_create_stops_later_writes(self):
        self.assertEqual(len(self.orchestration("uncertain")), 1)

    def test_postread_mismatch_cannot_complete(self):
        self.assertEqual(len(self.orchestration("postread")), 1)

    def test_promotion_reserves_and_verifies_each_write(self):
        self.assertEqual(len(self.orchestration(None)), 2)


if __name__ == "__main__":
    unittest.main()
