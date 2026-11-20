import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { categories, aggregate, requireText } from "../contract.mjs";

/** Exact occurrence comparison. Adapters may unwrap transport envelopes, never drop fields or sort arrays. */
export function comparePersistence(emitted, saved) {
  for (const key of ["threadId", "agentId", "userId"]) {
    requireText(emitted[key], `Emitted ${key}`);
    assert.equal(saved[key], emitted[key], `${key} changed`);
  }
  assert.ok(
    Array.isArray(emitted.runIds) && emitted.runIds.length,
    "No observed runs",
  );
  assert.deepEqual(
    saved.runIds,
    emitted.runIds,
    "Run identities/order changed",
  );
  assert.ok(
    Array.isArray(emitted.events) && emitted.events.length,
    "No emitted events",
  );
  assert.ok(
    Array.isArray(emitted.messages) && emitted.messages.length,
    "No reconstructed messages",
  );
  for (const key of ["events", "messages", "state", "pending"]) {
    assert.ok(Object.hasOwn(emitted, key), `Missing emitted ${key}`);
    assert.deepEqual(
      saved[key],
      emitted[key],
      `Persisted ${key} lost, altered, reordered or misassociated`,
    );
  }
  return {
    events: emitted.events.length,
    messages: emitted.messages.length,
    sha256: createHash("sha256").update(JSON.stringify(emitted)).digest("hex"),
  };
}

/** A witness is a JSON pointer into the captured source, not a category's claimed pass flag. */
export function witnessAt(capture, pointer) {
  assert.ok(
    typeof pointer === "string" &&
      /^\/(events|messages|state|pending)\//.test(pointer),
    "Witness must address captured source content",
  );
  let value = capture;
  for (const part of pointer.slice(1).split("/")) {
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    assert.ok(
      value !== null && typeof value === "object" && Object.hasOwn(value, key),
      `Missing witness ${pointer}`,
    );
    value = value[key];
  }
  assert.ok(
    value !== null && value !== undefined && value !== "",
    `Empty witness ${pointer}`,
  );
  return value;
}

/** Attachment source bytes are independently supplied by the upload fixture. */
export function verifyMedia(capture, media) {
  const part = witnessAt(capture, media.pointer);
  assert.equal(part.type, media.type, "Attachment discriminator changed");
  assert.equal(
    part.source?.type,
    media.sourceType,
    "Attachment source variant changed",
  );
  assert.equal(
    part.source?.mimeType,
    media.mimeType,
    "Attachment MIME changed",
  );
  assert.equal(
    part.metadata?.filename,
    media.filename,
    "Attachment filename changed",
  );
  assert.match(
    media.sha256 ?? "",
    /^[0-9a-f]{64}$/,
    "Original attachment digest required",
  );
  // URL/file bytes must be read through the saved resolvable reference by the adapter;
  // comparing only URL text would falsely prove resource durability.
  const bytes =
    media.sourceType === "data" ? part.source.value : media.resolvedBase64;
  requireText(bytes, "Saved attachment bytes");
  assert.equal(
    createHash("sha256").update(Buffer.from(bytes, "base64")).digest("hex"),
    media.sha256,
    "Attachment bytes changed",
  );
}

async function browserProof(browser, outputDir) {
  assert.ok(
    browser?.fresh === true,
    "Scenario did not start through a fresh browser conversation",
  );
  requireText(browser.url, "Browser URL");
  assert.ok(
    Array.isArray(browser.screenshots) && browser.screenshots.length,
    "Visible UI screenshot required",
  );
  for (const name of browser.screenshots) {
    const path = relative(resolve(outputDir), resolve(outputDir, name));
    assert.ok(
      path && !path.startsWith("..") && !isAbsolute(path),
      "Screenshot outside owned output",
    );
    await access(resolve(outputDir, path));
  }
}

export const row = {
  id: 1,
  title: "Fresh conversation → Intelligence",
  async run({ fixture, services, writeArtifact, outputDir }) {
    const checks = [];
    const covered = new Set();
    const rowFixture = fixture.row1;
    assert.ok(
      rowFixture?.scenarios?.length,
      "Row 1 requires fresh browser scenarios",
    );
    assert.equal(
      typeof services.row1?.runFresh,
      "function",
      "Missing fresh browser driver",
    );
    assert.equal(
      typeof services.row1?.readSaved,
      "function",
      "Missing independent Intelligence reader",
    );
    for (const scenario of rowFixture.scenarios) {
      requireText(scenario.id, "Scenario ID");
      assert.match(scenario.id, /^[a-z0-9-]+$/, "Unsafe scenario ID");
      const evidence = [];
      try {
        const live = await services.row1.runFresh(scenario);
        evidence.push(await writeArtifact(`${scenario.id}/emitted.json`, live));
        const saved = await services.row1.readSaved(live.emitted);
        evidence.push(await writeArtifact(`${scenario.id}/saved.json`, saved));
        const proof = comparePersistence(live.emitted, saved);
        await browserProof(live.browser, outputDir);
        const witnessed = new Set();
        for (const witness of live.witnesses ?? []) {
          assert.ok(
            categories.includes(witness.category),
            `Unknown category ${witness.category}`,
          );
          witnessAt(live.emitted, witness.pointer);
          witnessed.add(witness.category);
        }
        for (const media of live.media ?? []) {
          verifyMedia(saved, media);
          witnessed.add(`${media.type}:${media.sourceType}`);
        }
        for (const category of [
          "calculator-iframe",
          "frontend-completed",
          "native-completed",
        ]) {
          if (witnessed.has(category)) {
            const interaction = live.browser.interactions?.find(
              (item) => item.category === category,
            );
            requireText(
              interaction?.controlId,
              `${category} visible interaction identity`,
            );
            requireText(
              interaction?.action,
              `${category} visible interaction action`,
            );
            assert.equal(
              witnessAt(live.emitted, interaction.identityPointer),
              interaction.controlId,
              "Interaction targeted a different control",
            );
          }
        }
        for (const category of scenario.categories) {
          assert.ok(
            witnessed.has(category),
            `Requested ${category} never emitted: generation/coverage gap`,
          );
          covered.add(category);
        }
        evidence.push(await writeArtifact(`${scenario.id}/proof.json`, proof));
        checks.push({
          name: scenario.id,
          status: "passed",
          evidence,
          detail: `${proof.events} events and ${proof.messages} messages compared exactly`,
        });
      } catch (error) {
        checks.push({
          name: scenario.id,
          status: "failed",
          evidence,
          detail: String(error),
        });
      }
    }
    for (const category of categories) {
      if (covered.has(category)) continue;
      const applicability = rowFixture.applicability?.[category];
      if (applicability?.status === "not-applicable") {
        requireText(applicability.reason, `${category} N/A reason`);
        assert.ok(
          applicability.evidence?.length,
          `${category} N/A requires evidence`,
        );
        checks.push({
          name: category,
          status: "not-applicable",
          evidence: applicability.evidence,
          detail: applicability.reason,
        });
      } else
        checks.push({
          name: category,
          status: "unvalidated",
          evidence: [],
          detail:
            "Applicable category has no successful emitted-to-saved browser proof",
        });
    }
    return {
      status: aggregate(checks),
      checks,
      limitations: rowFixture.limitations ?? [],
    };
  },
};
