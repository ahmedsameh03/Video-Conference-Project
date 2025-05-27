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
const room = window.room;
const name = window.name;

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
 * Should be called early, but actual enabling requires user interaction.
 */
function initializeE2EE() {
  // Prevent multiple initializations
  if (e2eeManager) {
    console.log("[E2EE Integration] E2EE Manager already initialized.");
    return true;
  }

  console.log("[E2EE Integration] Initializing E2EE manager instance...");

  // --- Worker Path Configuration ---
  // IMPORTANT: This path must correctly point to the e2ee-worker.js script
  // relative to the *HTML file* (meeting.html) or as an absolute path.
  const workerPath = new URL("js/e2ee-worker.js", window.location.href).href;
  console.log(`[E2EE Integration] Using worker path: ${workerPath}`);
  // --- End Worker Path Configuration ---

  try {
    // Create the E2EEManager instance
    e2eeManager = new E2EEManager({
      roomId: room, // Assumes `room` is a global variable from meeting.js
      ratchetInterval: 60000, // Key rotation interval (1 minute)
      workerPath: workerPath,
    });

    // Check and log browser support
    const supportInfo = e2eeManager.getSupportInfo();
    console.log(`[E2EE Integration] Browser E2EE Support: ${JSON.stringify(supportInfo)}`);
    
    // Update UI based on support
    if (!supportInfo.supported) {
      updateE2EEStatusText("E2EE not supported by this browser.");
      // Disable UI elements if not supported
      const enableBtnElement = document.getElementById("e2ee-enable-btn");
      if (enableBtnElement) enableBtnElement.disabled = true;
      
      // Update status indicator in settings popup
      const statusIndicator = document.getElementById("e2ee-status-indicator");
      if (statusIndicator) {
        statusIndicator.classList.remove("e2ee-status-enabled");
        statusIndicator.classList.add("e2ee-status-disabled");
      }
      
      return false; // Indicate initialization failed due to lack of support
    } else {
      // Browser supports E2EE
      updateE2EEStatusText("E2EE Available (Disabled)");
    }

    console.log("✅ [E2EE Integration] E2EE Manager instance created successfully.");
    return true; // Indicate successful initialization

  } catch (managerError) {
    console.error("❌ [E2EE Integration] CRITICAL ERROR instantiating E2EEManager:", managerError);
    updateE2EEStatusText(`E2EE Init Failed: ${managerError.message}`);
    // Disable UI elements on critical failure
    const enableBtnElement = document.getElementById("e2ee-enable-btn");
    if (enableBtnElement) enableBtnElement.disabled = true;
    const settingsBtnElement = document.getElementById("e2ee-settings-btn");
    if (settingsBtnElement) settingsBtnElement.disabled = true;
    return false; // Indicate initialization failed
  }
}

// --- E2EE Control Functions ---

/**
 * Enables E2EE using the provided password.
 * Handles UI updates and error reporting.
 */
async function enableE2EE() {
  const passwordInput = document.getElementById("e2ee-password-input");
  const password = passwordInput?.value;

  if (!password) {
    alert("Please enter an encryption password.");
    return;
  }

  // Ensure manager is initialized
  if (!e2eeManager && !initializeE2EE()) {
      alert("Cannot enable E2EE: Initialization failed.");
      return;
  }

  console.log("[E2EE Integration] Attempting to enable E2EE...");
  updateE2EEStatusText("Enabling E2EE...");
  const enableBtn = document.getElementById("e2ee-enable-btn");
  const disableBtn = document.getElementById("e2ee-disable-btn");
  if (enableBtn) enableBtn.disabled = true;
  if (disableBtn) disableBtn.disabled = true;

  try {
    // Call the manager's enable method
    await e2eeManager.enable(password);

    // E2EE is now enabled and ready
    console.log("✅ [E2EE Integration] E2EE enabled successfully via manager.");
    updateE2EEStatusText("E2EE Enabled");
    if (enableBtn) enableBtn.disabled = true;
    if (disableBtn) disableBtn.disabled = false;
    
    // Update status indicator in settings popup
    const statusIndicator = document.getElementById("e2ee-status-indicator");
    if (statusIndicator) {
      statusIndicator.classList.remove("e2ee-status-disabled");
      statusIndicator.classList.add("e2ee-status-enabled");
    }
    
    // Show E2EE indicator in the UI
    const e2eeIndicator = document.getElementById("e2ee-indicator");
    if (e2eeIndicator) {
      e2eeIndicator.style.display = "inline";
    }

    // Apply transforms to existing peer connections
    console.log("[E2EE Integration] Applying E2EE setup to existing peer connections...");
    Object.values(peers).forEach(peer => {
        if (peer && peer.connectionState !== "closed") {
            e2eeManager.setupPeerConnection(peer);
        }
    });

    // Broadcast E2EE status to other participants
    broadcastE2EEStatus(true);

    // Close the settings popup
    toggleE2EESettings(false); // Force close

  } catch (error) {
    console.error("❌ [E2EE Integration] Failed to enable E2EE:", error);
    alert(`Failed to enable E2EE: ${error.message}`);
    updateE2EEStatusText("E2EE Disabled (Error)");
    if (enableBtn) enableBtn.disabled = false; // Re-enable button on failure
    if (disableBtn) disableBtn.disabled = true;
  }
}

/**
 * Disables E2EE.
 * Handles UI updates.
 */
async function disableE2EE() {
  if (!e2eeManager || !e2eeManager.isE2EEEnabled) {
    console.log("[E2EE Integration] E2EE is not currently enabled.");
    return;
  }

  console.log("[E2EE Integration] Disabling E2EE...");
  updateE2EEStatusText("Disabling E2EE...");
  const enableBtn = document.getElementById("e2ee-enable-btn");
  const disableBtn = document.getElementById("e2ee-disable-btn");
  if (enableBtn) enableBtn.disabled = true;
  if (disableBtn) disableBtn.disabled = true;

  try {
    // Call the manager's disable method
    await e2eeManager.disable();

    console.log("✅ [E2EE Integration] E2EE disabled successfully via manager.");
    updateE2EEStatusText("E2EE Available (Disabled)");
    if (enableBtn) enableBtn.disabled = false;
    if (disableBtn) disableBtn.disabled = true;
    
    // Update status indicator in settings popup
    const statusIndicator = document.getElementById("e2ee-status-indicator");
    if (statusIndicator) {
      statusIndicator.classList.remove("e2ee-status-enabled");
      statusIndicator.classList.add("e2ee-status-disabled");
    }
    
    // Hide E2EE indicator in the UI
    const e2eeIndicator = document.getElementById("e2ee-indicator");
    if (e2eeIndicator) {
      e2eeIndicator.style.display = "none";
    }

    // Broadcast E2EE status change
    broadcastE2EEStatus(false);

    // Close the settings popup
    toggleE2EESettings(false); // Force close

  } catch (error) {
    // Disabling should generally not throw errors, but handle defensively
    console.error("❌ [E2EE Integration] Error during E2EE disable:", error);
    alert(`An error occurred while disabling E2EE: ${error.message}`);
    // Update UI to reflect intended state even if cleanup had issues
    updateE2EEStatusText("E2EE Disabled (Error)");
    if (enableBtn) enableBtn.disabled = false;
    if (disableBtn) disableBtn.disabled = true;
  }
}

// --- UI Interaction ---

/**
 * Toggles the visibility of the E2EE settings popup.
 * @param {boolean} [forceState] - Optional: true to force open, false to force close.
 */
function toggleE2EESettings(forceState) {
  const popup = document.getElementById("e2ee-container");
  if (!popup) return;

  const shouldBeOpen = typeof forceState === "boolean" ? forceState : popup.style.display === "none";

  if (shouldBeOpen) {
    // Initialize manager if not already done when opening the popup
    if (!e2eeManager) {
        initializeE2EE();
    }
    // Update button states based on current E2EE status
    const enableBtn = document.getElementById("e2ee-enable-btn");
    const disableBtn = document.getElementById("e2ee-disable-btn");
    if (enableBtn) enableBtn.disabled = e2eeManager?.isE2EEEnabled ?? false;
    if (disableBtn) {
      disableBtn.disabled = !e2eeManager?.isE2EEEnabled ?? true;
      disableBtn.style.display = e2eeManager?.isE2EEEnabled ? "block" : "none";
    }

    popup.style.display = "flex";
    console.log("[UI] E2EE Settings Popup Opened.");
  } else {
    popup.style.display = "none";
    console.log("[UI] E2EE Settings Popup Closed.");
  }
}

/**
 * Updates the text indicating the current E2EE status in the UI.
 * @param {string} statusText - The text to display.
 */
function updateE2EEStatusText(statusText) {
  const statusElement = document.getElementById("e2ee-status-text");
  if (statusElement) {
    statusElement.textContent = statusText;
  }
  
  // Update the main status indicator if available
  const mainStatusIndicator = document.getElementById("e2ee-indicator");
  if (mainStatusIndicator) {
    if (statusText === "E2EE Enabled") {
      mainStatusIndicator.style.display = "inline";
      mainStatusIndicator.title = "End-to-End Encryption Enabled";
    } else {
      mainStatusIndicator.style.display = "none";
      mainStatusIndicator.title = "End-to-End Encryption Disabled";
    }
  }
}

// --- WebSocket Message Handling Enhancement ---

/**
 * Broadcasts the current E2EE status to other users via WebSocket.
 * @param {boolean} isEnabled - Whether E2EE is currently enabled.
 */
function broadcastE2EEStatus(isEnabled) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log(`[E2EE Integration] Broadcasting E2EE status: ${isEnabled ? "Enabled" : "Disabled"}`);
    ws.send(JSON.stringify({
      type: "e2ee-status",
      enabled: isEnabled,
      room: room, // Assumes global
      user: name, // Assumes global
    }));
  } else {
    console.warn("[E2EE Integration] Cannot broadcast E2EE status: WebSocket not open.");
  }
}

/**
 * Enhances the original WebSocket `onmessage` handler from meeting.js
 * to intercept and handle E2EE-specific messages.
 */
function enhanceWebSocketHandler() {
  // Ensure WebSocket object (ws) exists (might be initialized slightly after this script runs)
  if (typeof ws !== "undefined" && ws) {
    // Store the original handler if not already stored
    if (!originalWsOnMessage) {
      originalWsOnMessage = ws.onmessage;
      console.log("[E2EE Integration] Stored original WebSocket onmessage handler.");
    }

    // Replace the WebSocket onmessage handler with our wrapper
    ws.onmessage = async (message) => {
      let data;
      try {
        data = JSON.parse(message.data);

        // --- E2EE Message Interception ---
        if (data && data.type === "e2ee-status") {
          console.log(`[E2EE Integration] Received E2EE status from ${data.user}: ${data.enabled ? "Enabled" : "Disabled"}`);
          // Update UI or take action based on remote user's E2EE status if needed.
          // For example, display an indicator next to the participant's name.
          const participantElement = document.getElementById(`participant-${data.user}`);
          if (participantElement) {
              const statusIndicator = participantElement.querySelector(".e2ee-indicator") || document.createElement("span");
              statusIndicator.className = "e2ee-indicator";
              statusIndicator.textContent = data.enabled ? " 🔒" : "";
              statusIndicator.title = data.enabled ? "E2EE Enabled" : "E2EE Disabled";
              if (!participantElement.querySelector(".e2ee-indicator")) {
                  participantElement.appendChild(statusIndicator);
              }
          }
          return; // Stop processing here, don't pass to original handler
        }

        // --- Pass Non-E2EE Messages to Original Handler ---
        if (originalWsOnMessage) {
          await originalWsOnMessage(message); // Call the original handler from meeting.js
        }

      } catch (error) {
        console.error("❌ [E2EE Integration] Error in enhanced WebSocket handler:", error, "Raw data:", message.data);
        // If parsing failed, still try to pass to original handler if it exists
        if (originalWsOnMessage && !data) { // Only if parsing failed
            try {
                await originalWsOnMessage(message);
            } catch (originalHandlerError) {
                 console.error("❌ [E2EE Integration] Error in original WebSocket handler after parse error:", originalHandlerError);
            }
        }
      }
    };
    console.log("✅ [E2EE Integration] WebSocket onmessage handler enhanced successfully.");

  } else {
    // If ws is not ready yet, retry shortly
    console.warn("[E2EE Integration] WebSocket (ws) not defined when trying to enhance handler. Retrying in 500ms...");
   const tryEnhance = () => {
  if (typeof ws !== "undefined" && ws.readyState === WebSocket.OPEN) {
    enhanceWebSocketHandler();
  } else {
    console.warn("[E2EE Integration] Waiting for ws to be ready...");
    setTimeout(tryEnhance, 500);
  }
};
tryEnhance();

  }
}

// --- Initial Setup Execution ---

// Add event listeners for E2EE UI elements when the DOM is ready.
document.addEventListener("DOMContentLoaded", () => {
  console.log("[E2EE Integration] Setting up E2EE UI event listeners...");
  
  // Find the E2EE settings button and add click handler
  const settingsBtn = document.getElementById("e2ee-settings-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => toggleE2EESettings());
  }
  
  // Find the enable/disable buttons and add click handlers
  const enableBtn = document.getElementById("e2ee-enable-btn");
  if (enableBtn) {
    enableBtn.addEventListener("click", enableE2EE);
  }
  
  const disableBtn = document.getElementById("e2ee-disable-btn");
  if (disableBtn) {
    disableBtn.addEventListener("click", disableE2EE);
    // Initially hide the disable button
    disableBtn.style.display = "none";
  }

  // Attempt to enhance the WebSocket handler shortly after DOM load,
  // giving meeting.js time to potentially initialize the `ws` variable.
  console.log("[E2EE Integration] Scheduling WebSocket handler enhancement...");
  setTimeout(enhanceWebSocketHandler, 300); // Delay slightly

  // Initialize the E2EE status display
  updateE2EEStatusText("E2EE Available (Disabled)");
  
  // Initialize E2EE manager
  setTimeout(initializeE2EE, 500);
});

console.log("[E2EE Integration] meeting-e2ee.js script loaded.");
