/**
 * E2EE Integration for WebRTC Video Conference
 * 
 * This file integrates the E2EE modules with the main meeting.js functionality
 * to provide end-to-end encryption for WebRTC media streams.
 */

// Global E2EE manager instance
let e2eeManager = null;

// Initialize E2EE manager
function initializeE2EE() {
    console.log("🔒 Initializing E2EE manager");
    
    // --- Explicit Worker Path --- 
    // Assuming the final structure on Vercel places JS files directly under /js/
    // Adjust this path if your deployment structure is different.
    const workerPath = "/js/e2ee-worker.js"; 
    console.log(`Using explicit worker path: ${workerPath}`);
    // --- End Explicit Worker Path ---

    try {
        // Create E2EE manager with current room ID and explicit worker path
        e2eeManager = new E2EEManager({
            roomId: room, // Assumes global
            ratchetInterval: 60000, // 1 minute key rotation
            workerPath: workerPath
        });
    } catch (managerError) {
        console.error("❌ Failed to instantiate E2EEManager:", managerError);
        updateE2EEStatusText(`فشل تهيئة E2EE: ${managerError.message}`);
        const enableBtnElement = document.getElementById("e2ee-enable-btn");
        if (enableBtnElement) enableBtnElement.disabled = true;
        return false;
    }

    // Check browser support
    const supportInfo = e2eeManager.getSupportInfo();
    console.log(`🌐 E2EE Browser support: ${JSON.stringify(supportInfo)}`);
    
    const statusTextElement = document.getElementById("e2ee-status-text");
    const enableBtnElement = document.getElementById("e2ee-enable-btn");

    if (!supportInfo.supported) {
        console.warn(`⚠️ E2EE not supported in this browser (${supportInfo.browser})`);
        if (statusTextElement) statusTextElement.textContent = "E2EE غير مدعوم في هذا المتصفح";
        if (enableBtnElement) enableBtnElement.disabled = true;
        return false;
    }
    
    if (statusTextElement) statusTextElement.textContent = "E2EE جاهز للتفعيل";
    if (enableBtnElement) enableBtnElement.disabled = false;
    return true;
}

// Enable E2EE with the provided password
async function enableE2EE() {
    const passwordInput = document.getElementById("e2ee-password");
    const password = passwordInput.value.trim();
    const enableBtn = document.getElementById("e2ee-enable-btn");
    const disableBtn = document.getElementById("e2ee-disable-btn");
    
    if (!password) {
        alert("الرجاء إدخال كلمة مرور للتشفير");
        return;
    }
    
    // Disable buttons during activation
    if (enableBtn) enableBtn.disabled = true;
    if (disableBtn) disableBtn.disabled = true;
    updateE2EEStatusText("جاري تفعيل التشفير...");

    try {
        console.log("🔒 Enabling E2EE...");
        
        // Initialize if not already done
        if (!e2eeManager) {
            console.log("E2EE Manager not initialized, initializing now...");
            if (!initializeE2EE()) {
                 throw new Error("فشل تهيئة مدير E2EE.");
            }
            console.log("E2EE Manager initialized.");
        }
        
        // Enable E2EE with password
        console.log("Calling e2eeManager.enable()...");
        await e2eeManager.enable(password);
        console.log("e2eeManager.enable() completed.");
        
        // Apply E2EE to all existing peer connections
        console.log("Applying E2EE to existing peers...");
        if (typeof peers !== "undefined" && peers) { 
            Object.values(peers).forEach(peer => {
                if (peer instanceof RTCPeerConnection) { 
                    console.log(`Applying E2EE to peer for user: ${Object.keys(peers).find(key => peers[key] === peer)}`);
                    e2eeManager.setupPeerConnection(peer);
                }
            });
        }
        console.log("Finished applying E2EE to peers.");
        
        // Update UI
        updateE2EEStatus(true);
        updateE2EEStatusText("التشفير مفعل");
        
        // Notify other participants
        console.log("Notifying other participants...");
        if (typeof ws !== "undefined" && ws && ws.readyState === WebSocket.OPEN) { 
             ws.send(JSON.stringify({ 
                type: "e2ee-status", 
                enabled: true, 
                room, 
                user: name 
            }));
        }
        
        console.log("✅ E2EE enabled successfully");

    } catch (error) {
        console.error("❌ Error enabling E2EE:", error.message, error.stack);
        // Display the specific error message
        const errorMessage = `فشل تفعيل E2EE: ${error.message}`;
        alert(errorMessage); 
        updateE2EEStatusText(errorMessage); // Show specific error in status too
        updateE2EEStatus(false); // Ensure UI reflects disabled state
    } finally {
        console.log("Running finally block for enableE2EE UI update.");
        // Re-enable appropriate button after attempt
        const isCurrentlyEnabled = e2eeManager && e2eeManager.isEnabled();
        console.log(`E2EE is currently ${isCurrentlyEnabled ? 'enabled' : 'disabled'}`);
        if (isCurrentlyEnabled) {
             if (enableBtn) enableBtn.style.display = "none";
             if (disableBtn) {
                 disableBtn.style.display = "block";
                 disableBtn.disabled = false;
             }
        } else {
             if (enableBtn) {
                 enableBtn.style.display = "block";
                 // Only re-enable if supported
                 const isSupported = e2eeManager && e2eeManager.getSupportInfo().supported;
                 console.log(`E2EE support status: ${isSupported}`);
                 enableBtn.disabled = !isSupported;
             }
             if (disableBtn) disableBtn.style.display = "none";
        }
        console.log("Enable/Disable buttons updated.");
    }
}

// Disable E2EE
function disableE2EE() {
    const enableBtn = document.getElementById("e2ee-enable-btn");
    const disableBtn = document.getElementById("e2ee-disable-btn");

    // Disable buttons during deactivation
    if (enableBtn) enableBtn.disabled = true;
    if (disableBtn) disableBtn.disabled = true;
    updateE2EEStatusText("جاري إلغاء تفعيل التشفير...");

    try {
        console.log("🔓 Disabling E2EE...");
        
        if (e2eeManager) {
            e2eeManager.disable();
        }
        
        // Update UI
        updateE2EEStatus(false);
        updateE2EEStatusText("التشفير معطل");
        
        // Notify other participants
        if (typeof ws !== "undefined" && ws && ws.readyState === WebSocket.OPEN) { 
            ws.send(JSON.stringify({ 
                type: "e2ee-status", 
                enabled: false, 
                room, 
                user: name 
            }));
        }
        
        console.log("✅ E2EE disabled");
    } catch (error) {
        console.error("❌ Error disabling E2EE:", error);
        const errorMessage = `فشل إلغاء تفعيل E2EE: ${error.message}`;
        alert(errorMessage);
        updateE2EEStatusText(errorMessage);
        // Restore UI to previous state on error
        updateE2EEStatus(e2eeManager ? e2eeManager.isEnabled() : false);
    } finally {
         // Re-enable appropriate button after attempt
        const isCurrentlyEnabled = e2eeManager && e2eeManager.isEnabled();
        if (isCurrentlyEnabled) {
             if (enableBtn) enableBtn.style.display = "none";
             if (disableBtn) {
                 disableBtn.style.display = "block";
                 disableBtn.disabled = false;
             }
        } else {
             if (enableBtn) {
                 enableBtn.style.display = "block";
                 const isSupported = e2eeManager && e2eeManager.getSupportInfo().supported;
                 enableBtn.disabled = !isSupported;
             }
             if (disableBtn) disableBtn.style.display = "none";
        }
    }
}

// Update E2EE status text helper
function updateE2EEStatusText(text) {
    const statusTextElement = document.getElementById("e2ee-status-text");
    if (statusTextElement) {
        statusTextElement.textContent = text;
        console.log(`UI Status Text Updated: ${text}`);
    }
}

// Update E2EE status in UI (visual indicators)
function updateE2EEStatus(enabled) {
    const statusIndicator = document.getElementById("e2ee-status-indicator");
    const enableBtn = document.getElementById("e2ee-enable-btn");
    const disableBtn = document.getElementById("e2ee-disable-btn");
    const e2eeIndicator = document.getElementById("e2ee-indicator"); // Main meeting indicator
    
    console.log(`Updating main E2EE status indicators to: ${enabled ? 'enabled' : 'disabled'}`);
    if (enabled) {
        if (statusIndicator) {
            statusIndicator.classList.remove("e2ee-status-disabled");
            statusIndicator.classList.add("e2ee-status-enabled");
        }
        if (enableBtn) enableBtn.style.display = "none";
        if (disableBtn) disableBtn.style.display = "block";
        if (e2eeIndicator) e2eeIndicator.style.display = "inline";
    } else {
        if (statusIndicator) {
            statusIndicator.classList.remove("e2ee-status-enabled");
            statusIndicator.classList.add("e2ee-status-disabled");
        }
        if (enableBtn) enableBtn.style.display = "block";
        if (disableBtn) disableBtn.style.display = "none";
        if (e2eeIndicator) e2eeIndicator.style.display = "none";
    }
    // Ensure buttons are enabled/disabled correctly based on support
    if (enableBtn) {
        const isSupported = e2eeManager && e2eeManager.getSupportInfo().supported;
        enableBtn.disabled = !isSupported;
    }
     if (disableBtn) {
        disableBtn.disabled = false; // Disable button is always enabled if shown
    }
}

// Toggle E2EE settings panel
function toggleE2EESettings() {
    const e2eeContainer = document.getElementById("e2ee-container");
    if (e2eeContainer) {
        e2eeContainer.classList.toggle("visible");
        console.log(`E2EE settings panel visibility toggled to: ${e2eeContainer.classList.contains("visible")}`);
    }
}

// Handle E2EE status messages from other participants
function handleE2EEStatusMessage(data) {
    if (!data || !data.user || data.user === name) return; // Ignore self
    console.log(`🔒 E2EE status update from ${data.user}: ${data.enabled ? "enabled" : "disabled"}`);
    
    // Update UI to show which participants have E2EE enabled
    const participantElement = document.getElementById(`participant-${data.user}`);
    if (participantElement) {
        let indicator = participantElement.querySelector(".e2ee-participant-indicator");
        if (data.enabled) {
            if (!indicator) {
                indicator = document.createElement("span");
                indicator.className = "e2ee-participant-indicator";
                indicator.innerHTML = " 🔒"; // Lock icon
                indicator.title = "End-to-End Encrypted";
                participantElement.appendChild(indicator);
            }
        } else {
            if (indicator) {
                indicator.remove();
            }
        }
    }
}

// --- Integration with meeting.js --- 

// Function to be called by meeting.js when a new peer connection is created
function setupE2EEForPeer(peerConnection) {
     if (e2eeManager && e2eeManager.isEnabled() && peerConnection) {
        console.log(`🔒 Applying E2EE to peer connection (State: ${peerConnection.connectionState})`);
        e2eeManager.setupPeerConnection(peerConnection);
    } else {
        // console.log("Skipping E2EE setup for peer (E2EE not enabled or peer invalid)");
    }
}

// Initialize E2EE when the page loads
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM Content Loaded - Initializing E2EE UI");
    // Initialize E2EE manager and update UI based on support
    const supported = initializeE2EE();
    updateE2EEStatus(false); // Start as disabled
    if (!supported) {
         updateE2EEStatusText("E2EE غير مدعوم");
    }
});

// Extend WebSocket message handler (ensure this runs AFTER ws is defined in meeting.js)
function enhanceWebSocketHandler() {
    if (typeof ws !== "undefined" && ws) {
        const originalWsOnMessage = ws.onmessage;
        console.log("Enhancing WebSocket onmessage handler...");
        ws.onmessage = async (message) => {
            let data;
            try {
                data = JSON.parse(message.data);
                
                // Handle E2EE status messages first
                if (data.type === "e2ee-status") {
                    handleE2EEStatusMessage(data);
                    return; // Don't pass to original handler
                }
            } catch (error) {
                console.error("❌ Error parsing WebSocket message or handling E2EE status:", error);
                // Still call original handler if parsing failed but original exists
                if (originalWsOnMessage) {
                    try {
                         // console.log("Passing message to original handler after parse error...");
                         await originalWsOnMessage(message);
                    } catch (originalHandlerError) {
                         console.error("❌ Error in original WebSocket handler after parse error:", originalHandlerError);
                    }
                }
                return; // Exit after handling error
            }

            // Call the original handler for other message types
            if (originalWsOnMessage) {
                 try {
                    // console.log("Passing message to original handler...");
                    await originalWsOnMessage(message);
                 } catch (originalHandlerError) {
                    console.error("❌ Error in original WebSocket handler:", originalHandlerError);
                 }
            }
        };
        console.log("✅ WebSocket handler enhanced for E2EE messages.");
    } else {
        console.warn("WebSocket (ws) not defined when trying to enhance handler. Retrying soon...");
        // Retry after a short delay
        setTimeout(enhanceWebSocketHandler, 500);
    }
}

// Ensure the enhancement runs after meeting.js likely initializes ws
document.addEventListener("DOMContentLoaded", () => {
    // Delay slightly to ensure meeting.js setup runs
    console.log("Scheduling WebSocket handler enhancement...");
    setTimeout(enhanceWebSocketHandler, 200); // Increased delay slightly
});

console.log("meeting-e2ee.js loaded");

