/**
 * E2EE Integration for WebRTC Video Conference
 * 
 * This file integrates the E2EE modules with the main meeting.js functionality
 * to provide end-to-end encryption for WebRTC media streams.
 */

// Global E2EE manager instance
let e2eeManager = null;

// Initialize E2EE manager with room ID

function initializeE2EE() {
    console.log('🔒 Initializing E2EE manager');
    
    // Get base URL for scripts
    const baseUrl = new URL('.', document.currentScript?.src || window.location.href).href;
    
    // Create E2EE manager with current room ID
    e2eeManager = new E2EEManager({
        roomId: room, // From meeting.js
        ratchetInterval: 60000, // 1 minute key rotation
        workerPath: baseUrl + 'js/e2ee-worker.js'
    });


    // Check browser support
    const supportInfo = e2eeManager.getSupportInfo();
    console.log(`🌐 E2EE Browser support: ${JSON.stringify(supportInfo)}`);
    
    if (!supportInfo.supported) {
        console.warn(`⚠️ E2EE not supported in this browser (${supportInfo.browser})`);
        document.getElementById('e2ee-status-text').textContent = 'E2EE not supported in this browser';
        document.getElementById('e2ee-enable-btn').disabled = true;
        return false;
    }
    
    return true;
}

// Enable E2EE with the provided password
async function enableE2EE() {
    const passwordInput = document.getElementById('e2ee-password');
    const password = passwordInput.value.trim();
    
    if (!password) {
        alert('Please enter an encryption password');
        return;
    }
    
    try {
        console.log('🔒 Enabling E2EE...');
        
        // Initialize if not already done
        if (!e2eeManager) {
            if (!initializeE2EE()) {
                return;
            }
        }
        
        // Enable E2EE with password
        await e2eeManager.enable(password);
        
        // Apply E2EE to all peer connections
        Object.values(peers).forEach(peer => {
            e2eeManager.setupPeerConnection(peer);
        });
        
        // Update UI
        updateE2EEStatus(true);
        
        // Notify other participants that E2EE is enabled (without sharing the password)
        ws.send(JSON.stringify({ 
            type: "e2ee-status", 
            enabled: true, 
            room, 
            user: name 
        }));
        
        console.log('✅ E2EE enabled successfully');
    } catch (error) {
        console.error('❌ Error enabling E2EE:', error);
        alert(`Failed to enable E2EE: ${error.message}`);
    }
}

// Disable E2EE
function disableE2EE() {
    try {
        console.log('🔓 Disabling E2EE...');
        
        if (e2eeManager) {
            e2eeManager.disable();
        }
        
        // Update UI
        updateE2EEStatus(false);
        
        // Notify other participants
        ws.send(JSON.stringify({ 
            type: "e2ee-status", 
            enabled: false, 
            room, 
            user: name 
        }));
        
        console.log('✅ E2EE disabled');
    } catch (error) {
        console.error('❌ Error disabling E2EE:', error);
        alert(`Failed to disable E2EE: ${error.message}`);
    }
}

// Update E2EE status in UI
function updateE2EEStatus(enabled) {
    const statusIndicator = document.getElementById('e2ee-status-indicator');
    const statusText = document.getElementById('e2ee-status-text');
    const enableBtn = document.getElementById('e2ee-enable-btn');
    const disableBtn = document.getElementById('e2ee-disable-btn');
    const e2eeIndicator = document.getElementById('e2ee-indicator');
    
    if (enabled) {
        statusIndicator.classList.remove('e2ee-status-disabled');
        statusIndicator.classList.add('e2ee-status-enabled');
        statusText.textContent = 'E2EE is enabled';
        enableBtn.style.display = 'none';
        disableBtn.style.display = 'block';
        e2eeIndicator.style.display = 'inline';
    } else {
        statusIndicator.classList.remove('e2ee-status-enabled');
        statusIndicator.classList.add('e2ee-status-disabled');
        statusText.textContent = 'E2EE is disabled';
        enableBtn.style.display = 'block';
        disableBtn.style.display = 'none';
        e2eeIndicator.style.display = 'none';
    }
}

// Toggle E2EE settings panel
function toggleE2EESettings() {
    const e2eeContainer = document.getElementById('e2ee-container');
    e2eeContainer.classList.toggle('visible');
}

// Handle E2EE status messages from other participants
function handleE2EEStatusMessage(data) {
    console.log(`🔒 E2EE status update from ${data.user}: ${data.enabled ? 'enabled' : 'disabled'}`);
    
    // Update UI to show which participants have E2EE enabled
    const participantElement = document.getElementById(`participant-${data.user}`);
    if (participantElement) {
        if (data.enabled) {
            if (!participantElement.querySelector('.e2ee-participant-indicator')) {
                const indicator = document.createElement('span');
                indicator.className = 'e2ee-participant-indicator';
                indicator.innerHTML = ' 🔒';
                indicator.title = 'End-to-End Encrypted';
                participantElement.appendChild(indicator);
            }
        } else {
            const indicator = participantElement.querySelector('.e2ee-participant-indicator');
            if (indicator) {
                indicator.remove();
            }
        }
    }
}

// Enhanced createPeer function to integrate E2EE
async function createPeerWithE2EE(user) {
    // Create the peer connection as usual
    const peer = await createPeer(user);
    
    // Apply E2EE if enabled
    if (e2eeManager && e2eeManager.isEnabled()) {
        console.log(`🔒 Applying E2EE to peer connection with ${user}`);
        e2eeManager.setupPeerConnection(peer);
    }
    
    return peer;
}

// Initialize E2EE when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Initialize E2EE manager
    initializeE2EE();
    
    // Set initial UI state
    updateE2EEStatus(false);
});

// Extend WebSocket message handler to handle E2EE status messages
const originalWsOnMessage = ws.onmessage;
ws.onmessage = async (message) => {
    try {
        const data = JSON.parse(message.data);
        
        // Handle E2EE status messages
        if (data.type === 'e2ee-status') {
            handleE2EEStatusMessage(data);
            return;
        }
        
        // Call the original handler for other message types
        if (originalWsOnMessage) {
            originalWsOnMessage(message);
        }
    } catch (error) {
        console.error('❌ Error handling WebSocket message:', error);
        
        // Call the original handler in case of error
        if (originalWsOnMessage) {
            originalWsOnMessage(message);
        }
    }
};

// Override the createPeer function to integrate E2EE
const originalCreatePeer = window.createPeer;
window.createPeer = async function(user) {
    const peer = await originalCreatePeer(user);
    
    // Apply E2EE if enabled
    if (e2eeManager && e2eeManager.isEnabled()) {
        console.log(`🔒 Applying E2EE to peer connection with ${user}`);
        e2eeManager.setupPeerConnection(peer);
    }
    
    return peer;
};
