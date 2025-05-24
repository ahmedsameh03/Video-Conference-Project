/**
 * @fileoverview Integrates End-to-End Encryption (E2EE) functionality
 * with the core meeting logic (meeting.js).
 * Handles E2EE setup, UI interactions, and message interception for key exchange.
 */

let e2eeManager = null;
let originalWsOnMessage = null;

function initializeE2EE() {
  if (e2eeManager) return true;

  const workerPath = new URL("js/e2ee-worker.js", window.location.href).href;
  console.log(`[E2EE] Worker path set to: ${workerPath}`);

  try {
    e2eeManager = new E2EEManager({
      roomId: room,
      ratchetInterval: 60000,
      workerPath,
    });

    const support = e2eeManager.getSupportInfo();
    console.log(`[E2EE] Browser support: ${JSON.stringify(support)}`);

    if (!support.supported) {
      updateE2EEStatusText("E2EE not supported by this browser.");
      document.getElementById("e2ee-enable-btn")?.setAttribute("disabled", true);
      document.getElementById("e2ee-status-indicator")?.classList.replace("e2ee-status-enabled", "e2ee-status-disabled");
      return false;
    }

    updateE2EEStatusText("E2EE Available (Disabled)");
    return true;

  } catch (error) {
    console.error("❌ [E2EE] Initialization failed:", error);
    updateE2EEStatusText(`E2EE Init Failed: ${error.message}`);
    document.getElementById("e2ee-enable-btn")?.setAttribute("disabled", true);
    document.getElementById("e2ee-settings-btn")?.setAttribute("disabled", true);
    return false;
  }
}

async function enableE2EE() {
  const password = document.getElementById("e2ee-password-input")?.value;
  if (!password) return alert("Please enter an encryption password.");

  if (!e2eeManager && !initializeE2EE()) {
    alert("E2EE Initialization failed.");
    return;
  }

  updateE2EEStatusText("Enabling E2EE...");
  document.getElementById("e2ee-enable-btn")?.setAttribute("disabled", true);
  document.getElementById("e2ee-disable-btn")?.setAttribute("disabled", true);

  try {
    await e2eeManager.enable(password);

    updateE2EEStatusText("E2EE Enabled");
    document.getElementById("e2ee-disable-btn")?.removeAttribute("disabled");
    document.getElementById("e2ee-status-indicator")?.classList.replace("e2ee-status-disabled", "e2ee-status-enabled");
    document.getElementById("e2ee-indicator").style.display = "inline";

    Object.values(peers).forEach(peer => {
      if (peer?.connectionState !== "closed") e2eeManager.setupPeerConnection(peer);
    });

    broadcastE2EEStatus(true);
    toggleE2EESettings(false);

  } catch (error) {
    console.error("❌ [E2EE] Enable failed:", error);
    alert(`Enable E2EE failed: ${error.message}`);
    updateE2EEStatusText("E2EE Disabled (Error)");
    document.getElementById("e2ee-enable-btn")?.removeAttribute("disabled");
  }
}

async function disableE2EE() {
  if (!e2eeManager?.isE2EEEnabled) return;

  updateE2EEStatusText("Disabling E2EE...");
  document.getElementById("e2ee-enable-btn")?.setAttribute("disabled", true);
  document.getElementById("e2ee-disable-btn")?.setAttribute("disabled", true);

  try {
    await e2eeManager.disable();

    updateE2EEStatusText("E2EE Available (Disabled)");
    document.getElementById("e2ee-status-indicator")?.classList.replace("e2ee-status-enabled", "e2ee-status-disabled");
    document.getElementById("e2ee-indicator").style.display = "none";

    broadcastE2EEStatus(false);
    toggleE2EESettings(false);

  } catch (error) {
    console.error("❌ [E2EE] Disable failed:", error);
    alert(`Disable E2EE failed: ${error.message}`);
    updateE2EEStatusText("E2EE Disabled (Error)");
    document.getElementById("e2ee-enable-btn")?.removeAttribute("disabled");
  }
}

function toggleE2EESettings(force) {
  const popup = document.getElementById("e2ee-container");
  if (!popup) return;

  const shouldOpen = typeof force === "boolean" ? force : popup.style.display === "none";
  const enableBtn = document.getElementById("e2ee-enable-btn");
  const disableBtn = document.getElementById("e2ee-disable-btn");

  if (shouldOpen) {
    if (!e2eeManager) initializeE2EE();

    if (enableBtn) enableBtn.disabled = e2eeManager?.isE2EEEnabled;
    if (disableBtn) {
      disableBtn.disabled = !e2eeManager?.isE2EEEnabled;
      disableBtn.style.display = e2eeManager?.isE2EEEnabled ? "block" : "none";
    }

    popup.style.display = "flex";
  } else {
    popup.style.display = "none";
  }
}

function updateE2EEStatusText(text) {
  const status = document.getElementById("e2ee-status-text");
  if (status) status.textContent = text;

  const indicator = document.getElementById("e2ee-indicator");
  if (indicator) {
    indicator.style.display = (text === "E2EE Enabled") ? "inline" : "none";
    indicator.title = (text === "E2EE Enabled") ? "End-to-End Encryption Enabled" : "End-to-End Encryption Disabled";
  }
}

function broadcastE2EEStatus(isEnabled) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "e2ee-status",
      enabled: isEnabled,
      room,
      user: name
    }));
  }
}

function enhanceWebSocketHandler() {
  if (typeof ws !== "undefined" && ws) {
    if (!originalWsOnMessage) {
      originalWsOnMessage = ws.onmessage;
    }

    ws.onmessage = async (message) => {
      let data;
      try {
        data = JSON.parse(message.data);
        if (data?.type === "e2ee-status") {
          const el = document.getElementById(`participant-${data.user}`);
          if (el) {
            let statusEl = el.querySelector(".e2ee-indicator");
            if (!statusEl) {
              statusEl = document.createElement("span");
              statusEl.className = "e2ee-indicator";
              el.appendChild(statusEl);
            }
            statusEl.textContent = data.enabled ? " 🔒" : "";
            statusEl.title = data.enabled ? "E2EE Enabled" : "E2EE Disabled";
          }
          return;
        }

        if (originalWsOnMessage) await originalWsOnMessage(message);

      } catch (err) {
        console.error("E2EE WebSocket error:", err);
        if (originalWsOnMessage) originalWsOnMessage(message);
      }
    };
  } else {
    setTimeout(enhanceWebSocketHandler, 500);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("e2ee-settings-btn")?.addEventListener("click", () => toggleE2EESettings());
  document.getElementById("e2ee-enable-btn")?.addEventListener("click", enableE2EE);
  document.getElementById("e2ee-disable-btn")?.addEventListener("click", disableE2EE);
  document.getElementById("e2ee-disable-btn")?.style.setProperty("display", "none");

  setTimeout(() => {
    enhanceWebSocketHandler();
    initializeE2EE();
    updateE2EEStatusText("E2EE Available (Disabled)");
  }, 300);
});

console.log("[E2EE] meeting-e2ee.js loaded.");
