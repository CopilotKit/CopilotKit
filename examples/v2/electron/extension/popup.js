const portEl = document.getElementById("port");
const tokenEl = document.getElementById("token");
const connectBtn = document.getElementById("connect");
const statusEl = document.getElementById("status");

function refresh() {
  chrome.storage.session.get(["port", "token", "bridgeStatus"], (result) => {
    if (result.port != null) {
      portEl.value = result.port;
    }
    if (result.token != null) {
      tokenEl.value = result.token;
    }
    statusEl.textContent = result.bridgeStatus ?? "";
  });
}

connectBtn.addEventListener("click", () => {
  chrome.storage.session.set(
    {
      port: Number(portEl.value),
      token: tokenEl.value.trim(),
    },
    () => {
      chrome.runtime.sendMessage({ type: "connect" });
      statusEl.textContent = "connecting…";
    },
  );
});

setInterval(refresh, 1000);
refresh();
