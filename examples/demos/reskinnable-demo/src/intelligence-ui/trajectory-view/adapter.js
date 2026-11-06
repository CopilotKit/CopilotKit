/*
 * Data layer for Atai's trajectory view (index.html, from CopilotKitCommonAgentWorkspace
 * 9c9dc16b). Reads one trajectory from /api/learning/v1 (falling back to the bundled
 * sample data when the API cannot be reached), converts it into the view's own EVENTS
 * model, fills the header, details and key moments, then hands control to the
 * prototype's script through window.__whenTrajectory.
 *
 * The story it adapts to: the agent's attempts (in the app, in ChatGPT) fail; the
 * person then completes the task by hand, which is the reference path; and the view
 * says what the agent was missing that the person could see.
 */
(function () {
  "use strict";
  const ID = window.__TRAJECTORY_ID__;
  const API = "/api/learning/v1";
  const SAMPLE = "/intelligence-ui/sample-data.json";
  const pad = (n) => String(n).padStart(2, "0");
  const hms = (ms) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const plain = (s) =>
    String(s ?? "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
  const dur = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  };
  const surfaceName = (s) =>
    s === "chatgpt" ? "ChatGPT via MCP" : "In-app agent";
  const short = (v, n) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };
  const humanize = (name) => {
    const s = name.replace(/^[a-z]+\./, "").replace(/[._]/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  let source = "live";
  async function load() {
    try {
      // The /agui read adds each Thread's AG-UI event stream (threads[].aguiEvents).
      const r = await fetch(
        `${API}/trajectories/${encodeURIComponent(ID)}/agui`,
        {
          cache: "no-store",
        },
      );
      const body = await r.json();
      if (r.ok) return body;
      if (body && body.message)
        throw Object.assign(new Error(body.message), { fromApi: true });
      throw new Error(String(r.status));
    } catch (error) {
      if (error && error.fromApi) throw error;
      source = "sample";
      const sample = await (await fetch(SAMPLE)).json();
      const d = sample[`/trajectories/${ID}`];
      if (!d)
        throw new Error(`Trajectory ${ID} is not in the sample data.`, {
          cause: error,
        });
      return d;
    }
  }

  /** Converts one contract trajectory into the prototype's EVENTS list. */
  function toEvents(d) {
    const missing = new Map(d.missingContext.map((m) => [m.eventId, m]));
    const items = [];
    for (const th of d.threads) {
      const surface = th.surface;
      for (const m of th.messages) {
        items.push({
          at: m.at,
          e:
            m.role === "user"
              ? {
                  id: m.id,
                  kind: "chat",
                  role: "user",
                  t: hms(m.at),
                  text: plain(m.text),
                  surface: surfaceName(surface),
                }
              : {
                  id: m.id,
                  kind: "chat",
                  role: "agent",
                  t: hms(m.at),
                  text: plain(m.text).split(/\n+/),
                  who:
                    surface === "chatgpt"
                      ? "Ledgerline agent · ChatGPT via MCP"
                      : "Ledgerline agent · in app",
                  icon: surface === "chatgpt" ? "forum" : "smart_toy",
                },
        });
      }
      // Raw AG-UI events per step; run-level events go on the first and last step.
      const env = th.aguiEvents || [];
      const rawFor = (stepId, i, n) => {
        const own = env.filter((x) => x.stepId === stepId).map((x) => x.event);
        const runLevel = env
          .filter((x) => x.stepId === "run")
          .map((x) => x.event);
        const text = env
          .filter((x) => th.messages.some((m) => m.id === x.stepId))
          .map((x) => x.event);
        if (i === 0)
          own.unshift(
            ...runLevel.filter(
              (e) => e.type === "RUN_STARTED" || e.type === "STATE_SNAPSHOT",
            ),
          );
        if (i === n - 1)
          own.push(
            ...text,
            ...runLevel.filter(
              (e) =>
                e.type === "MESSAGES_SNAPSHOT" ||
                e.type === "RUN_FINISHED" ||
                e.type === "RUN_ERROR",
            ),
          );
        return own.length ? own : null;
      };
      for (const [stepIndex, x] of th.agentTrace.entries()) {
        const g = `t-${th.threadId}`;
        const raw = rawFor(x.id, stepIndex, th.agentTrace.length);
        const traceLabel =
          surface === "chatgpt"
            ? "Agent trace · ChatGPT via MCP, tool calls mapped to AG-UI"
            : "Agent trace · in-app agent, AG-UI";
        if (x.kind === "thinking") {
          items.push({
            at: x.at,
            e: {
              id: `${th.threadId}:${x.id}`,
              kind: "trace",
              sub: "thinking",
              g,
              traceLabel,
              t: hms(x.at),
              ms: x.durationMs ?? 0,
              title: "Thinking",
              text: x.text,
              raw,
            },
          });
          continue;
        }
        const r = x.result || {};
        const err =
          x.status === "error"
            ? [r.error, r.code].filter(Boolean).join(" ") || "error"
            : "";
        const rendered =
          x.status !== "error" && typeof r.component === "string"
            ? r.component
            : x.status !== "error" && r.kind === "review-card"
              ? "ReviewMatchesCard"
              : null;
        items.push({
          at: x.at,
          e: {
            id: `${th.threadId}:${x.id}`,
            kind: "trace",
            sub: rendered ? "ui" : "tool",
            g,
            traceLabel,
            t: hms(x.at),
            ms: x.durationMs ?? 0,
            name: x.name,
            summary: err
              ? r.message
                ? short(r.message, 90)
                : err
              : Object.entries(x.args || {})
                  .map(([k, v]) => `${k}: ${short(v, 30)}`)
                  .join(" · "),
            error: err,
            args: x.args || {},
            result: x.result ?? null,
            rendered,
            renderedProps:
              r.props ?? (r.kind === "review-card" ? r : (x.args ?? {})),
            raw,
          },
        });
      }
    }
    for (const ev of d.events) {
      const v = ev.event.value || {};
      const name = ev.event.name;
      const t = hms(ev.event.timestamp);
      const base = { id: ev.eventId, kind: "product", t };
      let e = null;
      if (name === "thread.linked") continue;
      if (name === "screen.context") {
        const miss = missing.get(ev.eventId);
        const norm = (x) =>
          String(x)
            .toLowerCase()
            .replace(/[^a-z0-9$,]+/g, " ")
            .trim();
        const fields = Object.entries(v.fields || {}).map(([k, val]) => {
          const text = typeof val === "string" ? val : JSON.stringify(val);
          return [
            k,
            text,
            Boolean(miss) &&
              text.length > 11 &&
              (/^(rule|text)$/i.test(k) ||
                norm(miss.label).includes(norm(text).slice(0, 40))),
          ];
        });
        // A long label ("Policy panel: <the rule>") keeps its head as the title; the rule is in the fields.
        const label = String(v.label || "Screen context");
        e = {
          ...base,
          sub: "screen",
          title:
            label.length > 40 && label.includes(":")
              ? label.split(":")[0]
              : label,
          route: String(v.route || ""),
          how: miss ? "On screen · never given to the agent" : "Page view",
          fields,
        };
      } else if (name === "page" || name === "navigation") {
        e = {
          ...base,
          sub: "screen",
          title:
            name === "page"
              ? `Opened ${v.title || v.route}`
              : `Navigated to ${v.to}`,
          route: String(v.route || v.to || ""),
          how: name === "page" ? "Page view" : "Navigation",
          fields:
            name === "navigation"
              ? [
                  ["From", String(v.from || "")],
                  ["To", String(v.to || "")],
                ]
              : [],
        };
      } else if (name === "click") {
        e = {
          ...base,
          sub: "interaction",
          verb: "Clicked",
          target: String(v.action),
          tag: String(v.tag || v.role || ""),
          detail: {
            page: String(v.route || ""),
            target: JSON.stringify({ role: v.role, accessibleName: v.action }),
          },
        };
      } else if (name === "network") {
        e = {
          ...base,
          sub: "network",
          method: String(v.method),
          path: String(v.route),
          status: Number(v.status),
          ms: Number(v.durationMs || 0),
          error: Number(v.status) >= 400 ? String(v.summary || "") : "",
          summary: String(v.summary || ""),
          detail: {
            request: `${v.method} ${v.route}${v.body !== undefined || v.request !== undefined ? "\n\n" + JSON.stringify(v.body ?? v.request, null, 2) : ""}`,
            response: `${v.status}${v.summary ? " · " + v.summary : ""}${v.response !== undefined ? "\n\n" + JSON.stringify(v.response, null, 2) : ""}`,
          },
        };
      } else {
        // Semantic product events (expense.cost_center_allocated, expense.report_approved, ...).
        e = {
          ...base,
          sub: "interaction",
          verb: "Recorded",
          target: humanize(name),
          tag: name,
          detail: { page: "domain event", target: JSON.stringify(v) },
        };
      }
      // The product event is already an AG-UI CUSTOM event; show it as one.
      e.raw = [
        {
          type: "CUSTOM",
          name: ev.event.name,
          value: ev.event.value,
          timestamp: ev.event.timestamp,
        },
      ];
      items.push({ at: ev.event.timestamp, e });
    }
    items.sort((a, b) => a.at - b.at);
    // Product events between two chat messages form one group, as in the prototype.
    let n = 0;
    let prev = null;
    const events = [];
    for (const { e } of items) {
      if (e.kind === "product") {
        if (prev !== "product") n += 1;
        e.g = `p${n}`;
      }
      prev = e.kind;
      events.push(e);
    }
    // Generative UI rendered by a tool call attaches to the agent's next message,
    // unless another component comes first (a run that draws a status card,
    // then a review card) or no message follows (ChatGPT's replies never reach
    // the MCP server). Then the component gets its own agent row right after
    // the tool call that drew it, and the rest of that trace becomes its own group.
    let split = 0;
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      if (e.kind !== "trace" || !e.rendered) continue;
      const r = events.findIndex(
        (x, k) => k > i && x.kind === "chat" && x.role === "agent",
      );
      const between =
        r > i &&
        events.slice(i + 1, r).some((x) => x.kind === "trace" && x.rendered);
      if (r > i && !events[r].gen && !between) {
        events[r].gen = e.rendered;
        events[r].genProps = e.renderedProps;
        continue;
      }
      const viaChatGpt = /ChatGPT/.test(e.traceLabel || "");
      events.splice(i + 1, 0, {
        id: `${e.id}:ui`,
        kind: "chat",
        role: "agent",
        t: e.t,
        text: [],
        who: viaChatGpt
          ? "Ledgerline agent · ChatGPT via MCP"
          : "Ledgerline agent · in app",
        icon: viaChatGpt ? "forum" : "smart_toy",
        gen: e.rendered,
        genProps: e.renderedProps,
      });
      split += 1;
      for (
        let k = i + 2;
        k < events.length && events[k].kind === "trace" && events[k].g === e.g;
        k += 1
      )
        events[k].g = `${e.g}~${split}`;
      i += 1;
    }
    return events;
  }

  function fill(d, events) {
    const t = d.trajectory;
    const first = t.user.name.split(" ")[0] || t.user.name;
    document.title = `${t.title} · Intelligence Trajectories`;
    document.getElementById("tj-id").textContent = t.trajectoryId;
    document.getElementById("tj-source").textContent =
      `Prototype · ${source === "live" ? "live data" : "sample data"}`;
    document.getElementById("tj-title").textContent = t.title;
    const date = new Date(t.firstEventAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    document.getElementById("tj-sub").innerHTML = [
      esc(t.user.name),
      `<span class="mono">${esc(t.user.id)}</span>`,
      `${date}, ${hms(t.firstEventAt).slice(0, 5)}–${hms(t.lastEventAt).slice(0, 5)}`,
      dur(t.lastEventAt - t.firstEventAt),
    ]
      .map((x) => `<span>${x}</span>`)
      .join('<span class="dot">·</span>');
    document.getElementById("tj-details").innerHTML = `
      <dt>First activity</dt><dd>${hms(t.firstEventAt)}</dd>
      <dt>Last activity</dt><dd>${hms(t.lastEventAt)}</dd>
      <dt>Duration</dt><dd>${dur(t.lastEventAt - t.firstEventAt)}</dd>
      <dt>User</dt><dd>${esc(t.user.name)}</dd>
      <dt>Agent</dt><dd>Ledgerline agent</dd>
      <dt>Thread${t.threadIds.length === 1 ? "" : "s"}</dt><dd>${t.threadIds.map((id) => `<span class="mono" style="display:block">${esc(short(id, 22))}</span>`).join("")}</dd>`;

    // Key moments: the failed attempts first, what was missing, then the reference path.
    const moments = [];
    for (const th of d.threads) {
      if (th.outcome !== "failed") continue;
      const calls = th.agentTrace.filter((x) => x.kind === "tool.call");
      const errs = calls.filter((x) => x.status === "error");
      const code =
        errs[0] && errs[0].result
          ? [errs[0].result.error, errs[0].result.code]
              .filter(Boolean)
              .join(" ")
          : "";
      const firstMsg = th.messages.find((m) => m.role === "user");
      moments.push(
        `<li><span class="ms bad">error</span><div><b>${surfaceName(th.surface)} failed</b><p>${calls.length} ${calls.length === 1 ? "tool call" : "tool calls"}, ${errs.length} ${errs.length === 1 ? "error" : "errors"}${code ? `: ${esc(code)}` : ""}. It never got the workflow right and stopped.</p>${firstMsg ? `<button class="linkbtn" type="button" data-jump="${esc(firstMsg.id)}">Show message</button>` : ""}</div></li>`,
      );
    }
    const seen = new Set();
    for (const m of d.missingContext) {
      if (seen.has(m.label)) continue;
      seen.add(m.label);
      moments.push(
        `<li><span class="ms bad">visibility</span><div><b>What the agent was missing</b><p>${esc(m.label)}. ${esc(m.why)}.</p><button class="linkbtn" type="button" data-jump="${esc(m.eventId)}">Show event</button></div></li>`,
      );
    }
    const lastFailure = Math.max(
      0,
      ...d.threads
        .filter((th) => th.outcome === "failed")
        .flatMap((th) => [
          ...th.messages.map((m) => m.at),
          ...th.agentTrace.map((x) => x.at),
        ]),
    );
    const reference = d.events.filter(
      (ev) =>
        ev.event.name !== "thread.linked" && ev.event.timestamp > lastFailure,
    );
    // The recipe: the API calls the person's path made, in order, repeats folded (×n).
    const calls = reference.filter(
      (ev) =>
        ev.event.name === "network" && Number(ev.event.value.status) < 400,
    );
    const recipe = [];
    for (const ev of calls) {
      const label = `${ev.event.value.method} ${String(ev.event.value.route).replace(/^\/api\/[^/]+\/v\d+/, "")}`;
      const last = recipe[recipe.length - 1];
      if (last && last.label === label) last.n += 1;
      else recipe.push({ label, n: 1 });
    }
    if (t.outcome === "agent_failed_user_completed" && recipe.length) {
      moments.push(
        `<li><span class="ms fine">sync_alt</span><div><b>The recipe, from the network requests</b><p class="mono" style="font-size:11.5px">${esc(recipe.map((r) => (r.n > 1 ? `${r.label} ×${r.n}` : r.label)).join(" → "))}</p><button class="linkbtn" type="button" data-jump="${esc(calls[0].eventId)}">Show requests</button></div></li>`,
      );
    }
    // The person's own steps; repeated "Match ..." clicks fold into one count.
    const clicks = reference
      .filter((ev) => ev.event.name === "click")
      .map((ev) => String(ev.event.value.action));
    const matched = clicks.filter(
      (a) => a.startsWith("Match ") && !a.startsWith("Match menu"),
    ).length;
    const steps = [
      ...(matched ? [`Matched ${matched} receipts`] : []),
      ...clicks.filter(
        (a) =>
          !a.startsWith("Match ") &&
          !/^Preview |^Close preview|^Unmatch /.test(a),
      ),
    ];
    const firstClick = reference.find((ev) => ev.event.name === "click");
    if (t.outcome === "agent_failed_user_completed" && firstClick) {
      const span = reference.length
        ? reference[reference.length - 1].event.timestamp -
          reference[0].event.timestamp
        : 0;
      moments.push(
        `<li><span class="ms fine">check_circle</span><div><b>${esc(first)} completed it by hand</b><p>The reference path, ${dur(span)} in Ledgerline: ${esc([...new Set(steps)].join(" → "))}.</p><button class="linkbtn" type="button" data-jump="${esc(firstClick.eventId)}">Show event</button></div></li>`,
      );
    }
    document.getElementById("tj-moments").innerHTML = moments.join("");
    return { first };
  }

  /*
   * Ledgerline's generative UI, drawn from the props the tool call recorded:
   * the close status card (showCloseStatus) and the review card (reviewMatches,
   * in the app and as ChatGPT's MCP app widget). Same data and layout as the
   * app's components, in Ledgerline's own look.
   */
  const DEPT = {
    dept_eng: "Engineering",
    dept_design: "Design",
    dept_product: "Product",
    dept_sales: "Sales",
    dept_cs: "Customer Success",
    dept_marketing: "Marketing",
    dept_finance: "Finance",
  };
  const GL = {
    6100: "Meals & entertainment",
    6200: "Travel",
    6250: "Lodging",
    6300: "Rideshare & parking",
    6420: "Software subscriptions",
    6500: "Office supplies",
    6610: "Events & offsites",
    6700: "Coworking",
  };
  const KIND = {
    split: ["call_split", "Split across departments"],
    reclass: ["sell", "Coded to the wrong account"],
    personal: ["person", "Personal charge"],
    missing_receipt: ["receipt_long", "No receipt on file"],
  };
  const usd = (n) =>
    `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const icon = (n) => `<span class="ms" aria-hidden="true">${n}</span>`;
  if (!document.getElementById("ll-gen-style")) {
    const st = document.createElement("style");
    st.id = "ll-gen-style";
    st.textContent = `
.ll-gen { --k-brand: #3157e6; --k-sel: #edf1fe; --k-sel-line: #c6d2fb; --k-ink: #0d1324; --k-muted: #5f6880; --k-line: #e4e7ee; --k-soft: #f7f8fb; font-size: 13px; }
.ll-gen .ll-cap { display: flex; align-items: center; gap: 6px; padding: 7px 14px; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.04em; color: var(--k-brand); background: var(--k-sel); border-bottom: 1px solid var(--k-sel-line); }
.ll-gen .ll-cap .ms { font-size: 14px; }
.ll-gen .ll-head { display: flex; justify-content: space-between; gap: 10px; padding: 12px 14px 8px; }
.ll-gen .ll-title { font-weight: 700; display: flex; align-items: center; gap: 6px; }
.ll-gen .ll-title .ms { font-size: 17px; color: var(--k-brand); }
.ll-gen .ll-sub { font-size: 12px; color: var(--k-muted); margin-top: 2px; }
.ll-gen .ll-amt { font-weight: 700; font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ll-gen .ll-prog { padding: 0 14px 10px; font-size: 11.5px; color: var(--k-muted); }
.ll-gen .ll-prog .row { display: flex; justify-content: space-between; }
.ll-gen .ll-bar { height: 6px; border-radius: 99px; background: #eceef3; margin-top: 5px; overflow: hidden; }
.ll-gen .ll-bar i { display: block; height: 100%; border-radius: 99px; background: var(--k-brand); }
.ll-gen .ll-bar i.full { background: #16a06a; }
.ll-gen .ll-row { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: center; padding: 8px 14px; border-top: 1px solid var(--k-line); }
.ll-gen .ll-ic { width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; }
.ll-gen .ll-ic .ms { font-size: 16px; }
.ll-gen .ll-ic.auto { background: var(--k-sel); color: var(--k-brand); }
.ll-gen .ll-ic.need { background: #fdf3e2; color: #b26a00; }
.ll-gen .ll-ic.done { background: #e5f6ee; color: #16a06a; }
.ll-gen .ll-line { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.ll-gen .ll-desc { font-family: var(--mono); font-size: 11.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ll-gen .ll-num { font-size: 12.5px; font-weight: 500; font-variant-numeric: tabular-nums; }
.ll-gen .ll-what { font-size: 12px; color: var(--k-muted); }
.ll-gen .ll-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.ll-gen .ll-chip { font-size: 10.5px; font-weight: 600; border-radius: 4px; padding: 1px 5px; background: var(--k-sel); color: var(--k-brand); }
.ll-gen .ll-chip.ok { background: #e5f6ee; color: #16a06a; }
.ll-gen .ll-chip.need { background: #fdf3e2; color: #b26a00; }
.ll-gen .ll-foot { padding: 9px 14px; border-top: 1px solid var(--k-line); background: var(--k-soft); font-size: 12px; color: var(--k-muted); display: flex; gap: 6px; align-items: center; }
.ll-gen .ll-foot.ok { background: #e5f6ee; color: #16a06a; }
.ll-gen .ll-foot .ms { font-size: 16px; }
.ll-gen .ll-btn { margin-left: auto; font-weight: 600; font-size: 12px; padding: 5px 10px; border-radius: 7px; background: var(--k-brand); color: #fff; display: inline-flex; gap: 4px; align-items: center; }
`;
    document.head.append(st);
  }
  const cap = (name, via) =>
    `<div class="ll-cap">${icon("widgets")}Generative UI · &lt;${esc(name)}&gt; · drawn by ${esc(via)}</div>`;
  const resolutionText = (r) => {
    if (!r) return ["Not cleared", []];
    if (r.kind === "split")
      return [
        `Split ${r.lines.length} ways by attendees`,
        r.lines.map(
          (l) => `${DEPT[l.departmentId] || l.departmentId} ${usd(l.amount)}`,
        ),
      ];
    if (r.kind === "reclass")
      return [
        "Reclass entry",
        [`${r.fromAccount} to ${r.toAccount} ${GL[r.toAccount] || ""}`.trim()],
      ];
    if (r.kind === "personal")
      return [
        "Personal, repaid",
        [
          r.method === "payroll_deduction"
            ? "Payroll deduction"
            : "Card payment",
        ],
      ];
    if (r.kind === "missing_receipt")
      return ["Missing-receipt affidavit", [`Signed by ${r.attestedBy}`]];
    return ["Cleared", []];
  };
  const LEDGERLINE_GEN = {
    CloseStatusCard: (p) => {
      const ex = p.exceptions || [];
      const cleared = ex.filter((x) => x.status === "cleared").length;
      const pct = p.closed
        ? 100
        : Math.round(((p.ready || 0) / Math.max(1, p.total || 0)) * 100);
      return `<div class="k-card ll-gen">${cap("CloseStatusCard", "showCloseStatus")}
        <div class="ll-head"><div><div class="ll-title">${icon(p.closed ? "lock" : "pending")}${esc(p.card.periodLabel)} close</div>
        <div class="ll-sub">${esc(p.card.holder)} · Visa •• ${esc(p.card.last4)} · ${p.total} charges</div></div>
        <div class="ll-amt">${usd(p.totalAmount)}</div></div>
        <div class="ll-prog"><div class="row"><span>${p.closed ? "Closed" : `${p.ready} of ${p.total} ready to close`}</span><span>${cleared} of ${ex.length} exceptions cleared</span></div>
        <div class="ll-bar"><i class="${pct === 100 ? "full" : ""}" style="width:${pct}%"></i></div></div>
        <div class="ll-row"><span class="ll-ic auto">${icon("auto_awesome")}</span><div>
          <div class="ll-line"><span class="ll-what" style="color:var(--k-ink);font-weight:500">${p.autoMatched.count} receipts auto-matched</span><span class="ll-num">${usd(p.autoMatched.amount)}</span></div>
          <div class="ll-chips">${(p.autoMatched.notes || []).map((n) => `<span class="ll-chip">${esc(n)}</span>`).join("")}</div></div></div>
        ${ex
          .map((x) => {
            const [ic, label] = KIND[x.kind] || ["info", x.kind];
            const done = x.status === "cleared";
            return `<div class="ll-row"><span class="ll-ic ${done ? "done" : "need"}">${icon(ic)}</span><div>
              <div class="ll-line"><span class="ll-desc">${esc(x.descriptor)}</span><span class="ll-num">${usd(x.amount)}</span></div>
              <div class="ll-line"><span class="ll-what">${esc(label)}</span><span class="ll-chip ${done ? "ok" : "need"}">${done ? "Cleared" : "Needs you"}</span></div></div></div>`;
          })
          .join("")}
      </div>`;
    },
    ReviewMatchesCard: (p) => {
      const pairs = p.pairs || [];
      const ex = pairs.filter((x) => x.exception);
      const auto = pairs.filter((x) => !x.exception);
      const total = pairs.reduce((n, x) => n + x.transaction.amount, 0);
      const autoTotal = auto.reduce((n, x) => n + x.transaction.amount, 0);
      const notes = [];
      for (const x of auto) {
        const a = x.adjustment;
        if (x.receipts && x.receipts.length > 1)
          notes.push(`Split · ${x.receipts.length} receipts`);
        if (a && a.kind === "gratuity") notes.push(`Tip ${usd(a.amount)}`);
        if (a && a.kind === "fx_conversion")
          notes.push(
            `€${Number(a.receiptAmount).toFixed(2)} at ${Number(a.rate).toFixed(4)}`,
          );
      }
      const o = p.outcome;
      return `<div class="k-card ll-gen">${cap("ReviewMatchesCard", "reviewMatches")}
        <div class="ll-head"><div><div class="ll-title">${icon("checklist")}Review the ${esc(p.card.periodLabel)} close</div>
        <div class="ll-sub">${esc(p.card.holder)} · Visa •• ${esc(p.card.last4)} · ${pairs.length} charges</div></div>
        <div class="ll-amt">${usd(total)}</div></div>
        ${ex
          .map((x) => {
            const [ic] = KIND[x.exception] || ["info"];
            const [title, chips] = resolutionText(x.resolution);
            return `<div class="ll-row"><span class="ll-ic ${x.resolution ? "done" : "need"}">${icon(ic)}</span><div>
              <div class="ll-line"><span class="ll-desc">${esc(x.transaction.descriptor)}</span><span class="ll-num">${usd(x.transaction.amount)}</span></div>
              <div class="ll-chips"><span class="ll-what">${esc(title)}</span>${chips.map((c) => `<span class="ll-chip ok">${esc(c)}</span>`).join("")}</div></div></div>`;
          })
          .join("")}
        <div class="ll-row"><span class="ll-ic auto">${icon("auto_awesome")}</span><div>
          <div class="ll-line"><span class="ll-what" style="color:var(--k-ink);font-weight:500">${auto.length} receipts auto-matched</span><span class="ll-num">${usd(autoTotal)}</span></div>
          <div class="ll-chips">${[...new Set(notes)]
            .slice(0, 3)
            .map((n) => `<span class="ll-chip">${esc(n)}</span>`)
            .join("")}</div></div></div>
        ${
          o && o.ok
            ? `<div class="ll-foot ok">${icon("check_circle")}${esc(o.summary)}</div>`
            : `<div class="ll-foot">${icon("lock")}Nothing closes until the cardholder confirms.<span class="ll-btn">${icon("lock")}Confirm and close ${esc(p.card.periodLabel)}</span></div>`
        }
      </div>`;
    },
  };

  const genericGen = (name, props) =>
    LEDGERLINE_GEN[name] && props && props.card
      ? { props, html: () => LEDGERLINE_GEN[name](props) }
      : {
          props,
          html: () =>
            `<div class="k-card"><div class="k-head"><b>&lt;${esc(name)}&gt;</b></div><div style="padding:10px 16px 14px"><dl class="kv">${Object.entries(
              props || {},
            )
              .slice(0, 6)
              .map(
                ([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(short(v, 60))}</dd>`,
              )
              .join("")}</dl></div></div>`,
        };
  const genericSrc = (name) =>
    `export function ${name}(props) {\n  return <pre>{JSON.stringify(props, null, 2)}</pre>;\n}\n`;

  window.__whenTrajectory = async (start) => {
    let d;
    try {
      d = await load();
    } catch (error) {
      document.getElementById("tj-source").textContent =
        `Prototype · ${source === "live" ? "live data" : "sample data"}`;
      document.getElementById("tj-title").textContent =
        "This trajectory could not be loaded";
      document.getElementById("tj-sub").textContent = String(
        error && error.message ? error.message : error,
      );
      return;
    }
    const events = toEvents(d);
    const { first } = fill(d, events);
    start({
      events,
      firstName: first,
      userName: d.trajectory.user.name,
      initials: d.trajectory.user.name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      agentName: "Ledgerline agent",
      genericGen,
      genericSrc,
      exportTrajectory: async () => {
        const r = await fetch(
          `${API}/trajectories/${encodeURIComponent(ID)}/agui`,
          { cache: "no-store" },
        ).catch(() => null);
        const data = r && r.ok ? await r.json() : d;
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `${ID}.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    });
    let focus = new URLSearchParams(location.search).get("event");
    if (focus && !events.some((e) => e.id === focus)) {
      // A linked-Thread signal: open that Thread's first message instead.
      const link = d.events.find(
        (ev) => ev.eventId === focus && ev.event.name === "thread.linked",
      );
      const th =
        link && d.threads.find((x) => x.threadId === link.event.value.threadId);
      focus = th
        ? (th.messages.find((m) => m.role === "user") || {}).id || null
        : null;
    }
    if (focus) {
      // Open the event's group and flash it, the way a Key moment's "Show event" does.
      const btn = document.createElement("button");
      btn.dataset.jump = focus;
      btn.hidden = true;
      document.querySelector(".details").append(btn);
      setTimeout(() => btn.click(), 50);
    }
  };
})();
