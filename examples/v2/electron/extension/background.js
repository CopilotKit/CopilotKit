// extension/background.js
let ws = null;
let keepAlive = null;

async function getPairing() {
  const { port, token } = await chrome.storage.session.get(["port", "token"]);
  return { port, token };
}

async function connect() {
  const { port, token } = await getPairing();
  if (!port || !token) return setStatus("disconnected");
  try {
    ws = new WebSocket(
      `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`,
    );
  } catch {
    return setStatus("disconnected");
  }
  ws.onopen = () => {
    setStatus("connected");
    // Chrome 116+: a WS message every <30s keeps the MV3 service worker alive.
    keepAlive = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "ping" }));
    }, 20000);
  };
  ws.onclose = () => {
    setStatus("disconnected");
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    ws = null;
  };
  ws.onmessage = (ev) => handleFrame(ev.data);
}

function setStatus(state) {
  void chrome.storage.session.set({ bridgeStatus: state });
}

async function handleFrame(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type === "pong") return; // keep-alive ack
  if (msg.type !== "request") return;
  try {
    const data = await runMethod(msg.method, msg.params || {});
    send({ type: "result", id: msg.id, data });
  } catch (err) {
    send({
      type: "error",
      id: msg.id,
      message: String(err && err.message ? err.message : err),
    });
  }
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) throw new Error("no active tab");
  return tab;
}

async function runMethod(method, params) {
  const tab = await activeTab();
  if (method === "readActiveTab") {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        selection: window.getSelection ? String(window.getSelection()) : "",
        text: (document.body && document.body.innerText
          ? document.body.innerText
          : ""
        ).slice(0, 8000),
      }),
    });
    return {
      url: tab.url,
      title: tab.title,
      selection: result.selection,
      text: result.text,
    };
  }
  if (method === "navigate") {
    await chrome.tabs.update(tab.id, { url: String(params.url) });
    return { navigatedTo: params.url };
  }
  if (method === "click" || method === "fill") {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (m, selector, value) => {
        const el = document.querySelector(selector);
        if (!el) return { ok: false, error: "selector not found: " + selector };
        if (m === "click") {
          el.click();
          return { ok: true };
        }
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      },
      args: [method, String(params.selector || ""), String(params.value || "")],
    });
    return result;
  }
  throw new Error("unknown method: " + method);
}

// Reconnect on SW wake if we have a pairing.
chrome.runtime.onStartup.addListener(() => void connect());
chrome.runtime.onInstalled.addListener(() => void connect());
// The popup pokes us to (re)connect after the user enters port+token.
chrome.runtime.onMessage.addListener((m) => {
  if (m && m.type === "connect") void connect();
});
