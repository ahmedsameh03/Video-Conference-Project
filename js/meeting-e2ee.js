let e2eeManager = null;
let originalWsOnMessage = null;

function initializeE2EE() {
  if (e2eeManager) return true;

  const workerPath = new URL("js/e2ee-worker.js", window.location.href).href;

  try {
    e2eeManager = new E2EEManager({
      roomId: room,
      ratchetInterval: 60000,
      workerPath: workerPath,
    });

    const support = e2eeManager.getSupportInfo();
    if (!support.supported) {
      updateE2EEStatusText("E2EE not supported by this browser.");
      document.getElementById("e2ee-enable-btn")?.setAttribute("disabled", "true");
      return false;
    }

    updateE2EEStatusText("E2EE Available (Disabled)");
    return true;

  } catch (err) {
    console.error("❌ E2EE init failed:", err);
    updateE2EEStatusText("E2EE Init Failed");
    return false;
  }
}

async function enableE2EE() {
  const password = document.getElementById("e2ee-password-input")?.value;
  if (!password) return alert("Please enter an encryption password.");

  if (!e2eeManager && !initializeE2EE()) return;

  updateE2EEStatusText("Enabling E2EE...");
  document.getElementById("e2ee-enable-btn")?.setAttribute("disabled", "true");
  document.getElementById("e2ee-disable-btn")?.setAttribute("disabled", "true");

  try {
    await e2eeManager.enable(password);

    updateE2EEStatusText("E2EE Enabled");
    document.getElementById("e2ee-disable-btn")?.removeAttribute("disabled");
    document.getElementById("e2ee-indicator").style.display = "inline";

    // ✅ تأخير بسيط للسماح بالتهيئة الكاملة قبل تطبيق التشفير على peers
    setTimeout(() => {
      Object.values(peers).forEach(peer => {
        if (peer && peer.connectionState !== "closed") {
          e2eeManager.setupPeerConnection(peer);
        }
      });
    }, 300);

    broadcastE2EEStatus(true);
    toggleE2EESettings(false);

  } catch (err) {
    console.error("❌ Failed to enable E2EE:", err);
    updateE2EEStatusText("E2EE Disabled (Error)");
    document.getElementById("e2ee-enable-btn")?.removeAttribute("disabled");
  }
}

async function disableE2EE() {
  if (!e2eeManager || !e2eeManager.isE2EEEnabled) return;

  updateE2EEStatusText("Disabling E2EE...");
  document.getElementById("e2ee-enable-btn")?.setAttribute("disabled", "true");
  document.getElementById("e2ee-disable-btn")?.setAttribute("disabled", "true");

  await e2eeManager.disable();

  updateE2EEStatusText("E2EE Available (Disabled)");
  document.getElementById("e2ee-disable-btn")?.setAttribute("disabled", "true");
  document.getElementById("e2ee-enable-btn")?.removeAttribute("disabled");
  document.getElementById("e2ee-indicator").style.display = "none";

  broadcastE2EEStatus(false);
  toggleE2EESettings(false);
}

function updateE2EEStatusText(text) {
  const statusText = document.getElementById("e2ee-status-text");
  if (statusText) statusText.textContent = text;
  const indicator = document.getElementById("e2ee-indicator");
  if (indicator) {
    indicator.style.display = (text === "E2EE Enabled") ? "inline" : "none";
  }
}

function toggleE2EESettings(force) {
  const popup = document.getElementById("e2ee-container");
  if (!popup) return;

  const open = typeof force === "boolean" ? force : popup.style.display === "none";
  popup.style.display = open ? "flex" : "none";

  const enableBtn = document.getElementById("e2ee-enable-btn");
  const disableBtn = document.getElementById("e2ee-disable-btn");

  if (enableBtn) enableBtn.disabled = e2eeManager?.isE2EEEnabled ?? false;
  if (disableBtn) {
    disableBtn.disabled = !e2eeManager?.isE2EEEnabled ?? true;
    disableBtn.style.display = e2eeManager?.isE2EEEnabled ? "block" : "none";
  }
}

function broadcastE2EEStatus(enabled) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "e2ee-status",
      enabled,
      room,
      user: name
    }));
  }
}

function enhanceWebSocketHandler() {
  if (!ws) return setTimeout(enhanceWebSocketHandler, 500);
  if (!originalWsOnMessage) originalWsOnMessage = ws.onmessage;

  ws.onmessage = async (message) => {
    let data;
    try {
      data = JSON.parse(message.data);
      if (data.type === "e2ee-status") {
        const el = document.getElementById(`participant-${data.user}`);
        if (el) {
          const badge = el.querySelector(".e2ee-indicator") || document.createElement("span");
          badge.className = "e2ee-indicator";
          badge.textContent = data.enabled ? " 🔒" : "";
          badge.title = data.enabled ? "E2EE Enabled" : "E2EE Disabled";
          if (!el.querySelector(".e2ee-indicator")) el.appendChild(badge);
        }
        return;
      }
      if (originalWsOnMessage) await originalWsOnMessage(message);
    } catch (e) {
      console.error("❌ E2EE WS Error:", e);
      if (originalWsOnMessage) await originalWsOnMessage(message);
    }
  };
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("e2ee-settings-btn")?.addEventListener("click", () => toggleE2EESettings());
  document.getElementById("e2ee-enable-btn")?.addEventListener("click", enableE2EE);
  document.getElementById("e2ee-disable-btn")?.addEventListener("click", disableE2EE);
  enhanceWebSocketHandler();
  setTimeout(() => initializeE2EE(), 500);
});
