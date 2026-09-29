import { describe, expect, it } from "vitest";
import { describeTarget } from "./privacy";

function target(html: string, selector = "button") {
  document.body.innerHTML = html;
  return document.querySelector(selector)!;
}

describe("semantic target capture", () => {
  it("uses ordinary button text without private descendants", () => {
    const button = target(
      '<button>Save <span data-private>Confidential customer</span><span hidden>Hidden record</span><span style="display:none">Invisible record</span><textarea>Freeform draft</textarea></button>',
    );
    expect(describeTarget(button, true).accessibleName).toBe("Save");
  });

  it("uses native labels and records finite radio state, not its value", () => {
    const radio = target(
      '<fieldset><legend>Shipping method</legend><label><input type="radio" name="shipping" value="private-record-id" checked> Express</label></fieldset>',
      "input",
    );
    expect(describeTarget(radio, true)).toMatchObject({
      role: "radio",
      accessibleName: "Express",
      state: { checked: true },
    });
    expect(JSON.stringify(describeTarget(radio, true))).not.toContain(
      "private-record-id",
    );
  });

  it("resolves public referenced names while excluding private and hidden references", () => {
    const button = target(
      '<span id="public">Open settings</span><span id="private" data-private>Customer details</span><span id="hidden" hidden>Secret record</span><button aria-labelledby="public private hidden"></button>',
    );
    expect(describeTarget(button, true).accessibleName).toBe("Open settings");
  });

  it("captures selected option labels, never arbitrary values or private options", () => {
    const select = target(
      '<label for="delivery">Delivery</label><select id="delivery" multiple><option selected value="sensitive-id">Express</option><option selected data-private>Confidential department</option></select>',
      "select",
    );
    expect(describeTarget(select, true)).toMatchObject({
      accessibleName: "Delivery",
      state: { selectedOptions: ["Express"] },
    });
    expect(JSON.stringify(describeTarget(select, true))).not.toMatch(
      /sensitive-id|Confidential/,
    );
    expect(describeTarget(select, false)).not.toHaveProperty(
      "state.selectedOptions",
    );
  });

  it("records observed accessibility state without deriving a previous value", () => {
    const button = target(
      '<button aria-expanded="true" aria-pressed="mixed" aria-selected="false" disabled>Details</button>',
    );
    expect(describeTarget(button, false)).toMatchObject({
      state: {
        expanded: true,
        pressed: "mixed",
        selected: false,
        disabled: true,
      },
    });
    expect(describeTarget(button, false)).not.toHaveProperty("accessibleName");
  });

  it("does not use raw text as fallback when an explicit name fails filtering", () => {
    const button = target(
      '<button aria-label="alice@example.com">Private customer record</button>',
    );
    expect(describeTarget(button, true).accessibleName).toBeUndefined();
  });

  it("rejects overlong text instead of exposing a safe-looking truncated prefix", () => {
    const button = target(
      `<button>Save ${" ".repeat(600)}alice@example.com</button>`,
    );
    expect(describeTarget(button, true).accessibleName).toBeUndefined();
  });

  it("omits names with more references than the bounded resolver can inspect", () => {
    const button = target(
      '<button aria-labelledby="one two three four five">Fallback name</button><span id="one">Save</span><span id="two">the</span><span id="three">current</span><span id="four">record</span><span id="five">alice@example.com</span>',
    );
    expect(describeTarget(button, true).accessibleName).toBeUndefined();
  });
});
