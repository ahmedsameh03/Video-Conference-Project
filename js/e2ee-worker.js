// js/e2ee-worker.js - Worker using AES-GCM-SIV via noble-ciphers (Peerwise Keys)

/**
 * E2EE Worker - Web Worker for offloading AES-GCM-SIV encryption/decryption.
 * Manages separate keys for each peer connection.
 */

// Map to store E2EECrypto instances or keys per peerId
const peerCryptoModules = new Map(); // Map<peerId, E2EECrypto>
let nobleCiphers = null; // To hold the imported library

console.log("Worker (AES-GCM-SIV - Peerwise): Script starting execution.");

// Define paths
const workerScriptPath = self.location.href.substring(0, self.location.href.lastIndexOf("/") + 1);
const cryptoScriptPath = workerScriptPath + "e2ee-crypto.js";
// Use a specific version from CDN for stability
const nobleCiphersCDN = "https://cdn.jsdelivr.net/npm/@noble/ciphers@1.3.0/index.js"; 

// Import required modules
try {
  console.log(`Worker: Attempting to import noble-ciphers from ${nobleCiphersCDN}...`);
  self.importScripts(nobleCiphersCDN);
  if (typeof self.nobleCiphers === "undefined") {
    throw new Error("noble-ciphers library did not load correctly from CDN.");
  }
  nobleCiphers = self.nobleCiphers; // Make it available globally for e2ee-crypto.js
  console.log("Worker: Successfully imported noble-ciphers.");

  console.log(`Worker: Attempting to import e2ee-crypto.js from ${cryptoScriptPath}...`);
  self.importScripts(cryptoScriptPath);
  console.log("Worker: Successfully imported e2ee-crypto.js.");

  if (typeof E2EECrypto === "undefined") {
    throw new Error("E2EECrypto class not found after importScripts.");
  }
  console.log("Worker: E2EECrypto class confirmed available.");
  
  // Signal readiness to the main thread AFTER successful import
  self.postMessage({ type: "worker_ready" });
  console.log("Worker: Sent worker_ready message.");

} catch (e) {
  console.error("❌ Worker: Error during importScripts or verification:", e.message, e.stack);
  self.postMessage({ 
    type: "error", 
    error: `Failed to import scripts: ${e.message}`,
    details: e.stack
  });
}

// Handle messages from main thread
self.onmessage = async function(event) {
  // For standard RTCRtpScriptTransform, options are passed on creation
  // For Insertable Streams, data comes via postMessage
  const operation = event.data?.operation || event.data?.operationType; // Handle both naming conventions
  const frame = event.data?.frame || event.data?.rtpFrame; // Handle both naming conventions
  const peerId = event.data?.peerId;
  const keyData = event.data?.keyData;

  try {
    // Handle key management operations first
    if (operation === "setKey") {
      if (!peerId) {
        console.error("Worker: Received 'setKey' operation without peerId.");
        self.postMessage({ type: "error", error: "Missing peerId for setKey", operation: operation });
        return;
      }
      if (!keyData || !(keyData instanceof Uint8Array) || keyData.byteLength !== 32) {
        console.error(`Worker: Received 'setKey' for peer ${peerId} without valid keyData (expected 32-byte Uint8Array).`);
        self.postMessage({ type: "error", error: "Invalid keyData for setKey", operation: operation, peerId: peerId });
        return;
      }
      
      console.log(`Worker: Received 'setKey' operation for peer: ${peerId}.`);
      // Create a new crypto instance for this peer
      const cryptoInstance = new E2EECrypto(); // Assumes E2EECrypto uses global nobleCiphers
      await cryptoInstance.setKey(keyData);
      peerCryptoModules.set(peerId, cryptoInstance);
      console.log(`Worker: Key set and crypto module stored for peer: ${peerId}.`);
      // Send confirmation back to manager
      self.postMessage({ type: "key_initialized", peerId: peerId });
      return; // Key setting complete
    }

    if (operation === "removeKey") {
        if (!peerId) {
            console.error("Worker: Received 'removeKey' operation without peerId.");
            self.postMessage({ type: "error", error: "Missing peerId for removeKey", operation: operation });
            return;
        }
        if (peerCryptoModules.has(peerId)) {
            // Optionally zero out key within the instance before deleting if possible
            peerCryptoModules.delete(peerId);
            console.log(`Worker: Removed key and crypto module for peer: ${peerId}.`);
        } else {
            console.warn(`Worker: Received 'removeKey' for unknown peer: ${peerId}.`);
        }
        return; // Key removal complete
    }

    // --- Handle Encrypt/Decrypt Operations --- 
    if (!frame || !frame.data) {
        console.error(`Worker: Received operation '${operation}' without valid frame data.`);
        self.postMessage({ type: "error", error: "Missing frame data", operation: operation, peerId: peerId });
        return;
    }
    if (!peerId) {
        console.error(`Worker: Received operation '${operation}' without peerId.`);
        // Forward original frame if possible
        self.postMessage({ type: operation === "encrypt" ? "encrypted" : "decrypted", frame: frame }, [frame.data]);
        return;
    }

    // Get the crypto module for the specific peer
    const cryptoModule = peerCryptoModules.get(peerId);
    if (!cryptoModule) {
      console.error(`Worker: Crypto module not found for peer ${peerId} during operation: ${operation}. Forwarding original frame.`);
      // Forward the original frame if key is missing
      self.postMessage({ type: operation === "encrypt" ? "encrypted" : "decrypted", frame: frame }, [frame.data]);
      return;
    }

    // Perform encryption/decryption using the peer-specific cryptoModule
    let resultFrame;
    switch (operation) {
      case "encrypt":
        resultFrame = await cryptoModule.encryptFrame(frame);
        self.postMessage({ type: "encrypted", frame: resultFrame }, [resultFrame.data]); // Transfer frame data
        break;
        
      case "decrypt":
        resultFrame = await cryptoModule.decryptFrame(frame);
        self.postMessage({ type: "decrypted", frame: resultFrame }, [resultFrame.data]); // Transfer frame data
        break;
        
      default:
        console.warn(`Worker: Unknown operation received: ${operation}`);
        self.postMessage({ type: "error", error: `Unknown operation: ${operation}`, operation: operation, peerId: peerId });
        // Forward original frame if operation is unknown but frame exists
        self.postMessage({ type: "unknown_op_passthrough", frame: frame }, [frame.data]);
    }

  } catch (error) {
    console.error(`❌ Worker: Error during operation ${operation} for peer ${peerId}:`, error.message, error.stack);
    self.postMessage({
      type: "error",
      error: `Worker error during ${operation} for peer ${peerId}: ${error.message}`,
      operation: operation,
      peerId: peerId,
      frameInfo: frame ? { type: frame.type, timestamp: frame.timestamp } : null
    });
    // Forward the original frame if possible during error
    if (frame && frame.data) {
        self.postMessage({ type: operation === "encrypt" ? "encrypted" : "decrypted", frame: frame }, [frame.data]);
    }
  }
};

// Log when the worker script finishes initial execution
console.log("Worker (AES-GCM-SIV - Peerwise): Script initial execution finished.");

