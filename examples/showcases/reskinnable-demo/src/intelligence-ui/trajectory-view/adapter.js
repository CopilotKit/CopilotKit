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
      const r = await fetch(`${API}/trajectories/${encodeURIComponent(ID)}`, {
        cache: "no-store",
      });
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
      for (const x of th.agentTrace) {
        const g = `t-${th.threadId}`;
        const traceLabel =
          surface === "chatgpt"
            ? "Agent trace · ChatGPT via MCP"
            : "Agent trace · in-app agent";
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
            renderedProps: r.props ?? x.args ?? {},
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
          detail: {
            request: `${v.method} ${v.route}`,
            response: `${v.status} · ${v.summary || ""}`,
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
    // Generative UI rendered by a tool call attaches to the agent's next message.
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i];
      if (e.kind === "trace" && e.rendered) {
        const reply = events
          .slice(i + 1)
          .find((x) => x.kind === "chat" && x.role === "agent");
        if (reply && !reply.gen) {
          reply.gen = e.rendered;
          reply.genProps = e.renderedProps;
        }
      }
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
        `<li><span class="ms bad">error</span><div><b>${surfaceName(th.surface)} failed</b><p>${calls.length} tool calls, ${errs.length} errors${code ? `: ${esc(code)}` : ""}. It retried instead of resolving the hold.</p>${firstMsg ? `<button class="linkbtn" type="button" data-jump="${esc(firstMsg.id)}">Show message</button>` : ""}</div></li>`,
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
    const steps = reference
      .filter((ev) => ev.event.name === "click")
      .map((ev) => String(ev.event.value.action).replace(/^Cost center: /, ""));
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

  const genericGen = (name, props) => ({
    html: () =>
      `<div class="k-card"><div class="k-head"><b>&lt;${esc(name)}&gt;</b></div><div style="padding:10px 16px 14px"><dl class="kv">${Object.entries(
        props || {},
      )
        .slice(0, 6)
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(short(v, 60))}</dd>`)
        .join("")}</dl></div></div>`,
  });
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
          `${API}/trajectories/${encodeURIComponent(ID)}/export`,
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
