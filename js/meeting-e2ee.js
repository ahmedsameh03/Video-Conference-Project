// js/meeting-e2ee.js

/**
 * @fileoverview Integrates End-to-End Encryption (E2EE) functionality
 * with the core meeting logic (meeting.js).
 * Handles E2EE setup using Diffie-Hellman (X25519), UI interactions,
 * and message interception for key exchange.
 */

// --- Global Variables ---

/**
 * Holds the single instance of the E2EEManager.
 * @type {E2EEManager | null}
 */
let e2eeManager = null;

/**
 * Holds the single instance of the E2EEKeyManager.
 * @type {E2EEKeyManager | null}
 */
let e2eeKeyManager = null; // Key manager instance for DH

/**
 * Stores the original WebSocket onmessage handler from meeting.js
 * so we can wrap it and add E2EE message handling.
 * @type {Function | null}
 */
let originalWsOnMessage = null;

/** URLs for noble libraries (adjust versions as needed) */
const nobleCurvesCDN = "https://cdn.jsdelivr.net/npm/@noble/curves@1.4.0/index.min.js";
const nobleHashesCDN = "https://cdn.jsdelivr.net/npm/@noble/hashes@1.4.0/index.min.js";

// --- Library Loading --- 

/** Flag to track if noble libraries are loaded */
let nobleLibsLoaded = false;

/** Loads noble libraries from CDN */
async function loadNobleLibraries() {
  if (nobleLibsLoaded) return true;
  console.log("[E2EE Integration] Loading noble libraries...");
  try {
    // Sequentially import to ensure hashes is available if curves needs it
    await import(nobleHashesCDN);
    if (typeof self.nobleHashes === "undefined") throw new Error("noble-hashes failed to load");
    console.log("[E2EE Integration] noble-hashes loaded.");
    
    await import(nobleCurvesCDN);
    if (typeof self.nobleCurves === "undefined") throw new Error("noble-curves failed to load");
    console.log("[E2EE Integration] noble-curves loaded.");

    // Make available globally for key manager (if needed, though passing is cleaner)
    window.nobleHashes = self.nobleHashes;
    window.nobleCurves = self.nobleCurves;
    
    nobleLibsLoaded = true;
    console.log("✅ [E2EE Integration] Noble libraries loaded successfully.");
    return true;
  } catch (error) {
    console.error("❌ [E2EE Integration] Failed to load noble libraries:", error);
    alert("Critical E2EE component failed to load. E2EE will be unavailable.");
    return false;
  }
}

// --- Initialization ---

/**
 * Initializes the E2EE manager and key manager instances.
 * Should be called early, but actual enabling requires user interaction.
 */
async function initializeE2EE() {
  // Prevent multiple initializations
  if (e2eeManager && e2eeKeyManager) {
    console.log("[E2EE Integration] E2EE Managers already initialized.");
    return true;
  }

  console.log("[E2EE Integration] Initializing E2EE managers...");

  // 1. Load required crypto libraries
  if (!await loadNobleLibraries()) {
      updateE2EEStatusText("E2EE Lib Load Failed");
      return false;
  }

  // 2. Initialize Key Manager (for DH)
  try {
      if (!e2eeKeyManager) {
          e2eeKeyManager = new E2EEKeyManager(); // Assumes class is loaded
          console.log("[E2EE Integration] E2EE Key Manager (DH) initialized.");
      }
  } catch (keyManagerError) {
      console.error("❌ [E2EE Integration] CRITICAL ERROR instantiating E2EEKeyManager:", keyManagerError);
      updateE2EEStatusText(`E2EE KM Init Failed: ${keyManagerError.message}`);
      return false;
  }

  // 3. Initialize E2EE Manager (integrates with WebRTC)
  const workerPath = new URL("js/e2ee-worker.js", window.location.href).href;
  console.log(`[E2EE Integration] Using worker path: ${workerPath}`);

  try {
    if (!e2eeManager) {
        e2eeManager = new E2EEManager({
          roomId: room, // Assumes global
          workerPath: workerPath,
          // Pass key manager instance or necessary functions
          keyManager: e2eeKeyManager 
        });
        console.log("[E2EE Integration] E2EE Manager initialized.");
    }

    // Check and log browser support
    const supportInfo = e2eeManager.getSupportInfo();
    console.log(`[E2EE Integration] Browser E2EE Support: ${JSON.stringify(supportInfo)}`);
    
    // Update UI based on support
    if (!supportInfo.supported) {
      updateE2EEStatusText("E2EE not supported by this browser.");
      const enableBtnElement = document.getElementById("e2ee-enable-btn");
      if (enableBtnElement) enableBtnElement.disabled = true;
      const statusIndicator = document.getElementById("e2ee-status-indicator");
      if (statusIndicator) statusIndicator.className = "e2ee-status-indicator e2ee-status-disabled";
      return false; // Indicate initialization failed due to lack of support
    } else {
      updateE2EEStatusText("E2EE Available (Disabled)");
    }

    console.log("✅ [E2EE Integration] E2EE initialization complete.");
    return true; // Indicate successful initialization

  } catch (managerError) {
    console.error("❌ [E2EE Integration] CRITICAL ERROR instantiating E2EEManager:", managerError);
    updateE2EEStatusText(`E2EE Mgr Init Failed: ${managerError.message}`);
    const enableBtnElement = document.getElementById("e2ee-enable-btn");
    if (enableBtnElement) enableBtnElement.disabled = true;
    const settingsBtnElement = document.getElementById("e2ee-settings-btn");
    if (settingsBtnElement) settingsBtnElement.disabled = true;
    return false; // Indicate initialization failed
  }
}

// --- E2EE Control Functions ---

/**
 * Enables E2EE using Diffie-Hellman key exchange.
 * Handles UI updates and error reporting.
 */
async function enableE2EE() {
  // Ensure managers are initialized
  if (!e2eeManager || !e2eeKeyManager) {
      if (!await initializeE2EE()) {
          alert("Cannot enable E2EE: Initialization failed.");
          return;
      }
  }

  console.log("[E2EE Integration] Attempting to enable E2EE (DH)...");
  updateE2EEStatusText("Enabling E2EE...");
  const enableBtn = document.getElementById("e2ee-enable-btn");
  const disableBtn = document.getElementById("e2ee-disable-btn");
  if (enableBtn) enableBtn.disabled = true;
  if (disableBtn) disableBtn.disabled = true;

  try {
    // 1. Generate local DH key pair if not already done
    if (!e2eeKeyManager.getPublicKey()) {
        await e2eeKeyManager.generateKeyPair();
    }
    const localPublicKey = e2eeKeyManager.getPublicKey();
    if (!localPublicKey) {
        throw new Error("Failed to generate local key pair.");
    }

    // 2. Enable the E2EE Manager (sets up worker, etc., but doesn't send keys yet)
    // Pass a placeholder or indicate DH mode if needed by manager
    await e2eeManager.enable("dh-mode"); // Use a flag instead of password

    // 3. Broadcast own public key and request others
    broadcastPublicKey(localPublicKey);
    requestPeerPublicKeys();

    // E2EE is now in the process of key exchange
    console.log("✅ [E2EE Integration] E2EE enabled, key exchange initiated.");
    updateE2EEStatusText("E2EE Enabled (Exchanging Keys)"); // Update status
    if (enableBtn) enableBtn.disabled = true;
    if (disableBtn) disableBtn.disabled = false;
    
    const statusIndicator = document.getElementById("e2ee-status-indicator");
    if (statusIndicator) statusIndicator.className = "e2ee-status-indicator e2ee-status-enabled";
    const e2eeIndicator = document.getElementById("e2ee-indicator");
    if (e2eeIndicator) e2eeIndicator.style.display = "inline";

    // Transforms will be applied by e2eeManager as keys become available for peers

    // Close the settings popup
    toggleE2EESettings(false); // Force close

  } catch (error) {
    console.error("❌ [E2EE Integration] Failed to enable E2EE (DH):", error);
    alert(`Failed to enable E2EE: ${error.message}`);
    updateE2EEStatusText("E2EE Disabled (Error)");
    if (enableBtn) enableBtn.disabled = false; // Re-enable button on failure
    if (disableBtn) disableBtn.disabled = true;
    // Attempt to disable cleanly if partially enabled
    if (e2eeManager?.isE2EEEnabled) {
        await disableE2EE();
    }
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

  console.log("[E2EE Integration] Disabling E2EE (DH)...");
  updateE2EEStatusText("Disabling E2EE...");
  const enableBtn = document.getElementById("e2ee-enable-btn");
  const disableBtn = document.getElementById("e2ee-disable-btn");
  if (enableBtn) enableBtn.disabled = true;
  if (disableBtn) disableBtn.disabled = true;

  try {
    // Call the manager's disable method
    await e2eeManager.disable();
    // Clean up local keys
    if (e2eeKeyManager) {
        e2eeKeyManager.disable();
    }

    console.log("✅ [E2EE Integration] E2EE disabled successfully via manager.");
    updateE2EEStatusText("E2EE Available (Disabled)");
    if (enableBtn) enableBtn.disabled = false;
    if (disableBtn) disableBtn.disabled = true;
    
    const statusIndicator = document.getElementById("e2ee-status-indicator");
    if (statusIndicator) statusIndicator.className = "e2ee-status-indicator e2ee-status-disabled";
    const e2eeIndicator = document.getElementById("e2ee-indicator");
    if (e2eeIndicator) e2eeIndicator.style.display = "none";

    // Broadcast E2EE status change
    broadcastE2EEStatus(false);

    // Close the settings popup
    toggleE2EESettings(false); // Force close

  } catch (error) {
    console.error("❌ [E2EE Integration] Error during E2EE disable:", error);
    alert(`An error occurred while disabling E2EE: ${error.message}`);
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
    if (!e2eeManager || !e2eeKeyManager) {
        initializeE2EE(); // Attempt initialization
    }
    // Update button states based on current E2EE status
    const enableBtn = document.getElementById("e2ee-enable-btn");
    const disableBtn = document.getElementById("e2ee-disable-btn");
    if (enableBtn) enableBtn.disabled = e2eeManager?.isE2EEEnabled ?? false;
    if (disableBtn) {
      disableBtn.disabled = !e2eeManager?.isE2EEEnabled ?? true;
      disableBtn.style.display = e2eeManager?.isE2EEEnabled ? "block" : "none";
    }
    // Hide password input for DH mode
    const passwordInput = document.getElementById("e2ee-password-input");
    if (passwordInput) passwordInput.style.display = "none"; 
    const passwordLabel = document.querySelector("label[for=\"e2ee-password-input\"]");
    if (passwordLabel) passwordLabel.style.display = "none";

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
  
  const mainStatusIndicator = document.getElementById("e2ee-indicator");
  if (mainStatusIndicator) {
    if (statusText.startsWith("E2EE Enabled")) {
      mainStatusIndicator.style.display = "inline";
      mainStatusIndicator.title = statusText; // Show detailed status like "Exchanging Keys"
    } else {
      mainStatusIndicator.style.display = "none";
      mainStatusIndicator.title = "End-to-End Encryption Disabled";
    }
  }
}

// --- WebSocket Message Handling Enhancement ---

/** Helper to convert Base64 string to Uint8Array */
function base64ToBytes(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/** Helper to convert Uint8Array to Base64 string */
function bytesToBase64(bytes) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Sends a message via WebSocket if the connection is open */
function sendWsMessage(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return true;
    } else {
        console.warn("[E2EE Integration] Cannot send WebSocket message: Connection not open.", payload);
        return false;
    }
}

/** Broadcasts the current E2EE status to other users */
function broadcastE2EEStatus(isEnabled) {
  console.log(`[E2EE Integration] Broadcasting E2EE status: ${isEnabled ? "Enabled" : "Disabled"}`);
  sendWsMessage({
    type: "e2ee-status",
    enabled: isEnabled,
    room: room, // Assumes global
    user: name, // Assumes global
  });
}

/** Broadcasts the local public key */
function broadcastPublicKey(publicKey) {
    if (!publicKey) return;
    console.log("[E2EE Integration] Broadcasting local public key.");
    sendWsMessage({
        type: "dh-pubkey",
        publicKey: bytesToBase64(publicKey), // Send as Base64 string
        room: room,
        user: name
    });
}

/** Requests public keys from other peers */
function requestPeerPublicKeys() {
    console.log("[E2EE Integration] Requesting peer public keys.");
    sendWsMessage({
        type: "dh-request-pubkey",
        room: room,
        user: name
    });
}

/** Sends the local public key directly to a specific peer */
function sendPublicKeyToPeer(targetUser, publicKey) {
    if (!publicKey || !targetUser) return;
    console.log(`[E2EE Integration] Sending local public key to ${targetUser}.`);
    sendWsMessage({
        type: "dh-pubkey",
        publicKey: bytesToBase64(publicKey),
        room: room,
        user: name,
        targetUser: targetUser // Indicate recipient
    });
}

/** Handles incoming Diffie-Hellman public key */
async function handleIncomingPublicKey(senderUser, publicKeyBase64) {
    if (!e2eeManager || !e2eeKeyManager || !e2eeManager.isE2EEEnabled) {
        console.log(`[E2EE Integration] Ignoring public key from ${senderUser}: E2EE not enabled locally.`);
        return;
    }
    console.log(`[E2EE Integration] Received public key from ${senderUser}.`);
    try {
        const publicKeyBytes = base64ToBytes(publicKeyBase64);
        e2eeKeyManager.addPeerPublicKey(senderUser, publicKeyBytes);
        
        // Derive the shared key for this peer
        const derivedKey = await e2eeKeyManager.deriveKeyForPeer(senderUser);
        if (derivedKey) {
            console.log(`[E2EE Integration] Derived shared key for ${senderUser}.`);
            // Inform the E2EE manager about the new key
            await e2eeManager.setPeerKey(senderUser, derivedKey);
            // Update UI status if all keys are exchanged (optional)
            // updateE2EEStatusText("E2EE Enabled (Keys Exchanged)");
        } else {
            console.error(`[E2EE Integration] Failed to derive key for ${senderUser}.`);
        }
    } catch (error) {
        console.error(`[E2EE Integration] Error processing public key from ${senderUser}:`, error);
    }
}

/** Handles incoming request for public key */
function handlePublicKeyRequest(requestingUser) {
    if (!e2eeManager || !e2eeKeyManager || !e2eeManager.isE2EEEnabled) {
        console.log(`[E2EE Integration] Ignoring public key request from ${requestingUser}: E2EE not enabled locally.`);
        return;
    }
    const localPublicKey = e2eeKeyManager.getPublicKey();
    if (localPublicKey) {
        console.log(`[E2EE Integration] Received public key request from ${requestingUser}, sending response.`);
        sendPublicKeyToPeer(requestingUser, localPublicKey);
    } else {
        console.warn(`[E2EE Integration] Received public key request from ${requestingUser}, but local key not generated yet.`);
    }
}

/**
 * Enhances the original WebSocket `onmessage` handler from meeting.js
 * to intercept and handle E2EE-specific messages (status and DH key exchange).
 */
function enhanceWebSocketHandler() {
  if (typeof ws !== "undefined" && ws) {
    if (!originalWsOnMessage) {
      originalWsOnMessage = ws.onmessage;
      console.log("[E2EE Integration] Stored original WebSocket onmessage handler.");
    }

    ws.onmessage = async (message) => {
      let data;
      let rawData = message.data;
      try {
        data = JSON.parse(rawData);

        // --- E2EE Message Interception ---
        switch (data?.type) {
            case "e2ee-status":
                console.log(`[E2EE Integration] Received E2EE status from ${data.user}: ${data.enabled ? "Enabled" : "Disabled"}`);
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
                return; // Handled

            case "dh-pubkey":
                if (data.user !== name) { // Ignore own broadcast
                    handleIncomingPublicKey(data.user, data.publicKey);
                }
                return; // Handled

            case "dh-request-pubkey":
                 if (data.user !== name) { // Ignore own broadcast
                    handlePublicKeyRequest(data.user);
                 }
                 return; // Handled
        }
        // --- End E2EE Interception ---

        // Pass Non-E2EE Messages to Original Handler
        if (originalWsOnMessage) {
          await originalWsOnMessage(message); 
        }

      } catch (error) {
        console.error("❌ [E2EE Integration] Error in enhanced WebSocket handler:", error, "Raw data:", rawData);
        if (originalWsOnMessage && !data) {
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
    console.warn("[E2EE Integration] WebSocket (ws) not defined when trying to enhance handler. Retrying in 500ms...");
    setTimeout(enhanceWebSocketHandler, 500);
  }
}

// --- Initial Setup Execution ---

document.addEventListener("DOMContentLoaded", () => {
  console.log("[E2EE Integration] Setting up E2EE UI event listeners...");
  
  const settingsBtn = document.getElementById("e2ee-settings-btn");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => toggleE2EESettings());
  }
  
  const enableBtn = document.getElementById("e2ee-enable-btn");
  if (enableBtn) {
    enableBtn.addEventListener("click", enableE2EE);
  }
  
  const disableBtn = document.getElementById("e2ee-disable-btn");
  if (disableBtn) {
    disableBtn.addEventListener("click", disableE2EE);
    disableBtn.style.display = "none";
  }

  console.log("[E2EE Integration] Scheduling WebSocket handler enhancement...");
  setTimeout(enhanceWebSocketHandler, 300); 

  updateE2EEStatusText("E2EE Available (Disabled)");
  
  // Load libraries and initialize E2EE managers after a short delay
  setTimeout(initializeE2EE, 500);
});

console.log("[E2EE Integration] meeting-e2ee.js script loaded.");

