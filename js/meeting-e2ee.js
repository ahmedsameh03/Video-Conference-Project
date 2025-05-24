// js/meeting-e2ee.js - E2EE Integration for WebRTC Video Conferencing
/**
 * @fileoverview Integrates End-to-End Encryption (E2EE) functionality
 * with the core meeting logic (meeting.js).
 * Handles E2EE setup, UI interactions, and message interception for key exchange.
 */

// ===== Global Variables =====
let e2eeManager = null; // Holds the single instance of E2EEManager
let originalWsOnMessage = null; // Stores original WebSocket onmessage handler

// ===== Initialization =====
/**
 * Initializes the E2EE manager instance.
 * Should be called early, but actual enabling requires user interaction.
 * @returns {boolean} True if initialization succeeds, false otherwise
 */
function initializeE2EE() {
  // Prevent multiple initializations
  if (e2eeManager) {
    console.log("[E2EE Integration] E2EE Manager already initialized.");
    return true;
  }

  console.log("[E2EE Integration] Initializing E2EE manager instance...");

  // Set worker path relative to the HTML file or as absolute
  const workerPath = new URL("js/e2ee-worker.js", window.location.href).href;
  console.log(`[E2EE Integration] Using worker path: ${workerPath}`);

  try {
    // Create the E2EEManager instance with configuration
    e2eeManager = new E2EEManager({
      roomId: room, // Assumes 'room' is a global variable from meeting.js
      ratchetInterval: 60000, // Key rotation interval (1 minute)
      workerPath: workerPath,
    });

    // Check browser support for E2EE features
    const supportInfo = e2eeManager.getSupportInfo();
    console.log(`[E2EE Integration] Browser E2EE Support: ${JSON.stringify(supportInfo)}`);
    
    // Update UI based on browser support
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

// ===== E2EE Control Functions =====
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
  updateE2EEStatusText("Enabling E
