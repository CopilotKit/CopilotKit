import { describe, expect, it } from "vitest";
import { describeContext } from "./context";
import { describeTarget } from "./privacy";

function capture(html: string) {
  document.body.innerHTML = html;
  return describeContext(document.querySelector("button")!);
}

describe("semantic screen context", () => {
  it.each([
    "Service fee: $84.50",
    "Equipment: $1,234.56",
    "Refund: -£123.45",
    "Budget: €123,456.78",
    "Limit: USD 1,234",
  ])("retains bounded currency amounts in screen context: %s", (text) => {
    const context = capture(
      `<main><p data-learning-context>${text}</p><button>Review</button></main>`,
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({ kind: "content", accessibleName: text }),
    );
  });

  it.each([
    "Account: $123456789012",
    "Card: $4242 4242 4242 4242",
    "Card: $4242-4242-4242-4242",
    "Account: $123,456,789,012",
    "Account: $1234567890.12",
    "Account: $12.34-5678",
    "Reference: USD 123456ABC",
    "Reference: $123456_A",
    "Reference: $123456Ä",
    "Reference: $123456\u0301",
    "Reference: ID$123456",
    "Reference: 参照$123456",
    "Reference: _USD 123456",
    "Contact: $84.50 alice@example.com",
    "Token: $84.50 abcdef",
    "Contact: $84.50 +1 (555) 123-4567",
  ])(
    "does not disguise sensitive numbers or metadata with currency: %s",
    (text) => {
      const context = capture(
        `<main><p data-learning-context>${text}</p><button>Review</button></main>`,
      );
      expect(
        context?.items.some((item) => item.kind === "content") ?? false,
      ).toBe(false);
    },
  );

  it("keeps general control-label filtering unchanged and honors private currency descendants", () => {
    const context = capture(
      '<main><p data-learning-context>Service fee: $84.50 <span data-private>$4242424242424242</span></p><button aria-label="Pay $84.50">Pay</button></main>',
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({
        kind: "content",
        accessibleName: "Service fee: $84.50",
      }),
    );
    expect(
      describeTarget(document.querySelector("button")!, true).accessibleName,
    ).toBeUndefined();
    expect(JSON.stringify(context)).not.toContain("4242424242424242");
  });

  it("captures headings, group labels, selected finite state and current status", () => {
    const context = capture(
      '<main aria-label="Order review"><h1>Office supplies</h1><fieldset><legend>Shipping</legend><label><input type="radio" name="delivery" checked> Express</label><button>Save</button></fieldset><p role="status">Pending</p></main>',
    );
    expect(context?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "region",
          accessibleName: "Order review",
        }),
        expect.objectContaining({
          kind: "heading",
          accessibleName: "Office supplies",
        }),
        expect.objectContaining({ kind: "group", accessibleName: "Shipping" }),
        expect.objectContaining({
          kind: "control",
          accessibleName: "Express",
          state: { checked: true },
        }),
        expect.objectContaining({ kind: "status", accessibleName: "Pending" }),
      ]),
    );
  });

  it("captures short visible prose and task values while excluding private descendants", () => {
    const context = capture(
      '<main><h1>Order review</h1><p>Approval requires a receipt.</p><p data-learning-context>Budget: $48 <span data-private>Private customer</span><textarea>Freeform note</textarea></p><div data-private><h2>Secret heading</h2></div><span role="status" style="display:none">Hidden status</span><button>Save</button></main>',
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({
        kind: "content",
        accessibleName: "Budget: $48",
      }),
    );
    expect(JSON.stringify(context)).not.toMatch(
      /Private customer|Secret heading|Hidden status/,
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({
        kind: "content",
        accessibleName: "Approval requires a receipt.",
      }),
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({
        kind: "control",
        text: { value: "Freeform note" },
      }),
    );
  });

  it("observes updated status text without depending on element replacement", () => {
    capture('<main><p role="status">Pending</p><button>Save</button></main>');
    document.querySelector('[role="status"]')!.firstChild!.textContent =
      "Saved";
    expect(
      describeContext(document.querySelector("button")!)?.items,
    ).toContainEqual(
      expect.objectContaining({ kind: "status", accessibleName: "Saved" }),
    );
  });

  it("bounds items and actual UTF-8 bytes and discloses incomplete observations", () => {
    const context = capture(
      `<main>${Array.from({ length: 40 }, () => "<h2>" + "界".repeat(70) + "</h2>").join("")}<button>Save</button></main>`,
    );
    expect(context?.truncated).toBe(true);
    expect(context!.items.length).toBeLessThanOrEqual(8);
    expect(
      new TextEncoder().encode(JSON.stringify(context)).byteLength,
    ).toBeLessThanOrEqual(2048);
  });

  it("does not walk unlimited irrelevant markup to reach distant content", () => {
    const context = capture(
      `<main>${"<span>Decoration</span>".repeat(400)}<h2>Distant heading</h2><button>Save</button></main>`,
    );
    expect(context?.truncated).toBe(true);
    expect(JSON.stringify(context)).not.toContain("Distant heading");
  });

  it("prioritizes status and headings over duplicate regions and unselected radio choices", () => {
    const context = capture(
      `<main aria-label="Order review"><h1>Order review</h1><fieldset><legend>Shipping</legend>${Array.from({ length: 10 }, (_, index) => `<label><input type="radio" name="shipping" ${index === 0 ? "checked" : ""}>Choice ${index}</label>`).join("")}</fieldset><p role="status">Needs approval</p><button>Save</button></main>`,
    );
    expect(context?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "status",
          accessibleName: "Needs approval",
        }),
        expect.objectContaining({
          kind: "heading",
          accessibleName: "Order review",
        }),
        expect.objectContaining({ kind: "control", state: { checked: true } }),
      ]),
    );
    expect(
      context?.items.filter((item) => item.accessibleName === "Order review"),
    ).toHaveLength(1);
    expect(
      context?.items.some(
        (item) => item.role === "radio" && item.state?.checked === false,
      ),
    ).toBe(false);
  });
  it("captures public initial fields and their updated values without requiring changes", () => {
    const context = capture(
      '<main><h1>Dispatch</h1><label>Quantity <input type="number" value="4"></label><label>Review note <textarea>Move the supplier dinner to Friday.</textarea></label><label>Delivery <select><option>Standard</option><option selected>Express</option></select></label><button>Save</button></main>',
    );
    expect(context?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "control",
          accessibleName: "Quantity",
          text: { value: "4" },
        }),
        expect.objectContaining({
          kind: "control",
          accessibleName: "Review note",
          text: { value: "Move the supplier dinner to Friday." },
        }),
        expect.objectContaining({
          kind: "control",
          accessibleName: "Delivery",
          state: { selectedOptions: ["Express"] },
        }),
      ]),
    );
    document.querySelector("textarea")!.value =
      "Move the supplier dinner to Monday.";
    expect(
      describeContext(document.querySelector("button")!)?.items,
    ).toContainEqual(
      expect.objectContaining({
        text: { value: "Move the supplier dinner to Monday." },
      }),
    );
  });

  it("omits input/editor values when text capture is disabled but keeps finite choices", () => {
    capture(
      '<main><textarea aria-label="Review note">TASK_CANARY</textarea><div contenteditable="true" role="textbox" aria-label="Rich note">EDITOR_CANARY</div><select aria-label="Delivery"><option selected>Express</option></select><button>Save</button></main>',
    );
    const context = describeContext(
      document.querySelector("button")!,
      undefined,
      { captureTextValues: false },
    );
    expect(JSON.stringify(context)).not.toMatch(
      /TASK_CANARY|EDITOR_CANARY|"text":/,
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({ state: { selectedOptions: ["Express"] } }),
    );
  });

  it("filters private fields, sensitive hints, private prose and SDK composers at baseline", () => {
    const context = capture(
      '<main><textarea data-private>PRIVATE_CANARY</textarea><textarea aria-label="Home address">ADDRESS_CANARY</textarea><input type="password" value="PASSWORD_CANARY"><p>Contact reviewer@example.test</p><p data-private>PROSE_CANARY</p><div data-copilotkit><textarea aria-label="Message">COMPOSER_CANARY</textarea></div><button>Save</button></main>',
    );
    expect(JSON.stringify(context)).not.toMatch(
      /PRIVATE_CANARY|ADDRESS_CANARY|PASSWORD_CANARY|PROSE_CANARY|COMPOSER_CANARY|reviewer@example/,
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({ text: { omitted: "sensitive-field" } }),
    );
  });

  it("includes short list/table context without exceeding the fixed observation budget", () => {
    const context = capture(
      "<main><h1>Dispatch</h1><ul><li>Use the loading dock.</li></ul><table><tbody><tr><th>Collection</th><td>Afternoon</td></tr></tbody></table><button>Save</button></main>",
    );
    expect(context?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "content",
          accessibleName: "Use the loading dock.",
        }),
        expect.objectContaining({
          kind: "content",
          accessibleName: "Collection",
        }),
        expect.objectContaining({
          kind: "content",
          accessibleName: "Afternoon",
        }),
      ]),
    );
  });

  it("keeps the acted-on field visible when many earlier controls compete for the budget", () => {
    document.body.innerHTML = `<main><h1>Dispatch</h1>${Array.from({ length: 10 }, (_, index) => `<input aria-label="Setting ${index}" value="Default">`).join("")}<textarea aria-label="Review note">Move the supplier dinner to Friday.</textarea><p role="status">Pending</p></main>`;
    const context = describeContext(document.querySelector("textarea")!);
    expect(context?.truncated).toBe(true);
    expect(context?.items).toContainEqual(
      expect.objectContaining({
        accessibleName: "Review note",
        text: { value: "Move the supplier dinner to Friday." },
      }),
    );
    expect(context!.items.length).toBeLessThanOrEqual(8);
    expect(
      new TextEncoder().encode(JSON.stringify(context)).byteLength,
    ).toBeLessThanOrEqual(2048);
  });

  it("captures unmarked public prices without allowing private currency-like identifiers", () => {
    const context = capture(
      "<main><p>Workshop catering: $84.50</p><p>Card: $4242 4242 4242 4242</p><p>Invoice: $84.50 reviewer@example.test</p><p data-private>Private budget: $50</p><button>Pay $84.50</button></main>",
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({
        kind: "content",
        accessibleName: "Workshop catering: $84.50",
      }),
    );
    expect(JSON.stringify(context)).not.toMatch(
      /4242|reviewer@example|Private budget/,
    );
    expect(
      describeTarget(document.querySelector("button")!, true).accessibleName,
    ).toBeUndefined();
  });

  it("keeps useful bounded prose after inspecting the whole paragraph for sensitive suffixes", () => {
    const paragraph =
      "The delivery remains on hold until a reviewer confirms the loading dock can accept the shipment. The driver should wait for confirmation before unloading the supplies beside the reception desk.";
    const context = capture(
      `<main><p>${paragraph}</p><p>${paragraph} reviewer@example.test</p><p>${"Long prose ".repeat(80)}</p><p role="status">Awaiting review</p><button>Review</button></main>`,
    );
    expect(context?.items).toContainEqual(
      expect.objectContaining({
        kind: "content",
        accessibleName: `${paragraph.slice(0, 157).trimEnd()}…`,
      }),
    );
    expect(
      context?.items.filter((item) => item.kind === "content"),
    ).toHaveLength(1);
    expect(context?.items).toContainEqual(
      expect.objectContaining({
        kind: "status",
        accessibleName: "Awaiting review",
      }),
    );
    expect(context?.truncated).toBe(true);
    expect(JSON.stringify(context)).not.toContain("reviewer@example");
  });
});
