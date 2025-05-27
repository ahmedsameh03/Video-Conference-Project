// js/meeting-e2ee.js

/**
 * @fileoverview Integrates End-to-End Encryption (E2EE) functionality
 * with the core meeting logic (meeting.js).
 * Handles E2EE setup, UI interactions, and message interception for key exchange.
 */

// --- Global Variables ---

/**
 * Holds the single instance of the E2EEManager.
 * @type {E2EEManager | null}
 */
let e2eeManager = null;

/**
 * Stores the original WebSocket onmessage handler from meeting.js
 * so we can wrap it and add E2EE message handling.
 * @type {Function | null}
 */
let originalWsOnMessage = null;

// --- Initialization ---

/**
 * Initializes the E2EE manager instance.
 * Should be called after localStream is ready, but before peer connections.
 */
function initializeE2EE() {
  // Prevent multiple initializations
  if (e2eeManager) {
    console.log("[E2EE Integration] E2EE Manager already initialized.");
    return true;
  }

  // Use globals provided by meeting.js
  const roomId = (typeof room !== 'undefined') ? room : (window.room || "");
  const userName = (typeof name !== 'undefined') ? name : (window.name || "");

  console.log("[E2EE Integration] Initializing E2EE manager instance...");

  // --- Worker Path Configuration ---
  const workerPath = new URL("js/e2ee-worker.js", window.location.href).href;
  console.log(`[E2EE Integration] Using worker path: ${workerPath}`);

  try {
    // Create the E2EEManager instance
    e2eeManager = new E2EEManager({
      roomId: roomId,
      ratchetInterval: 60000, // Key rotation interval (1 minute)
      workerPath: workerPath,
    });

    // Check and log browser support
    const supportInfo = e2eeManager.getSupportInfo();
    console.log(`[E2EE Integration] Browser E2EE Support: ${JSON.stringify(supportInfo)}`);
    
    // Update UI based on support
    if (!supportInfo.supported) {
      updateE2EEStatusText("E2EE not supported by this browser.");
      const enableBtnElement = document.getElementById("e2ee-enable-btn");
      if (enableBtnElement) enableBtnElement.disabled = true;
      const statusIndicator = document.getElementById("e2ee-status-indicator");
      if (statusIndicator) {
        statusIndicator.classList.remove("e2ee-status-enabled");
        statusIndicator.classList.add("e2ee-status-disabled");
      }
      return false;
    } else {
      updateE2EEStatusText("E2EE Available (Disabled)");
    }

    console.log("✅ [E2EE Integration] E2EE Manager instance created successfully.");
    return true;

  } catch (managerError) {
    console.error("❌ [E2EE Integration] CRITICAL ERROR instantiating E2EEManager:", managerError);
    updateE2EEStatusText(`E2EE Init Failed: ${managerError.message}`);
    const enableBtnElement = document.getElementById("e2ee-enable-btn");
    if (enableBtnElement) enableBtnElement.disabled = true;
    const settingsBtnElement = document.getElementById("e2ee-settings-btn");
    if (settingsBtnElement) settingsBtnElement.disabled = true;
    return false;
  }
}

// (The rest of your E2EE control/UI/wrapping logic remains unchanged.)

// --- (No change to enableE2EE, disableE2EE, broadcastE2EEStatus, enhanceWebSocketHandler, etc) ---

// --- Initial Setup Execution ---
document.addEventListener("DOMContentLoaded", () => {
  console.log("[E2EE Integration] Setting up E2EE UI event listeners...");

  // Button handlers...
  const settingsBtn = document.getElementById("e2ee-settings-btn");
  if (settingsBtn) settingsBtn.addEventListener("click", () => toggleE2EESettings());
  const enableBtn = document.getElementById("e2ee-enable-btn");
  if (enableBtn) enableBtn.addEventListener("click", enableE2EE);
  const disableBtn = document.getElementById("e2ee-disable-btn");
  if (disableBtn) {
    disableBtn.addEventListener("click", disableE2EE);
    disableBtn.style.display = "none";
  }

  // Enhance WebSocket after DOM loaded
  setTimeout(enhanceWebSocketHandler, 300);
  updateE2EEStatusText("E2EE Available (Disabled)");
  setTimeout(initializeE2EE, 500); // Delayed to allow meeting.js to set globals
});

console.log("[E2EE Integration] meeting-e2ee.js script loaded.");
