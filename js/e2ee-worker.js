// js/e2ee-worker.js

/**
 * E2EE Worker - Web Worker for offloading encryption/decryption operations
 */

let cryptoModule = null;
let isCryptoReady = false; // Flag to track crypto module readiness

console.log("Worker: Script starting execution.");

// Import required modules
try {
  console.log("Worker: Attempting to import e2ee-crypto.js...");
  // Use a dynamic path relative to the worker's location
  const workerScriptPath = self.location.href.substring(0, self.location.href.lastIndexOf('/') + 1);
  const cryptoScriptPath = workerScriptPath + "e2ee-crypto.js";
  console.log(`Worker: Resolving crypto script path: ${cryptoScriptPath}`);
  
  self.importScripts(cryptoScriptPath);
  console.log("Worker: Successfully imported e2ee-crypto.js.");

  // Verify that the expected class/functions are now available
  if (typeof E2EECrypto === 'undefined') {
    throw new Error("E2EECrypto class not found after importScripts.");
  }
  console.log("Worker: E2EECrypto class confirmed available.");
  
  // Create the crypto module instance immediately
  cryptoModule = new E2EECrypto();
  console.log("Worker: E2EECrypto instance created (waiting for key).");

  // Signal readiness to the main thread AFTER successful import and verification
  self.postMessage({ type: "worker_ready" });
  console.log("Worker: Sent worker_ready message.");

} catch (e) {
  console.error("❌ Worker: Error during importScripts or verification:", e.message, e.stack);
  // Send error back to main thread
  self.postMessage({ 
    type: "error", 
    error: `Failed to import or verify crypto script: ${e.message}`,
    details: e.stack
  });
}

// Handle messages from main thread
self.onmessage = async function(event) {
  const { operation, frame, keyData } = event.data;

  try {
    // Initialize or update crypto module and key
    if (operation === "init") {
      console.log("Worker: Received 'init' operation with key data.");
      
      if (!cryptoModule) {
        console.log("Worker: Creating new E2EECrypto instance.");
        cryptoModule = new E2EECrypto();
      }
      
      if (keyData) {
        console.log("Worker: Setting encryption key.");
        await cryptoModule.setKey(keyData);
        isCryptoReady = true; // Mark as ready only after key is set
        console.log("Worker: Key set successfully. Crypto module is ready.");
        // Send confirmation back to manager
        self.postMessage({ type: "initialized" });
      } else {
        console.warn("Worker: 'init' operation received without keyData.");
        isCryptoReady = false;
        self.postMessage({ 
          type: "error", 
          error: "No key data provided for initialization" 
        });
      }
      return; // Initialization complete for this message
    }

    // Check if crypto module is ready for encrypt/decrypt operations
    if (!isCryptoReady || !cryptoModule) {
      self.postMessage({
        type: "error",
        error: `Crypto module not initialized or no key set for operation: ${operation}`,
        operation: operation
      });
      return;
    }

    // Perform encryption/decryption
    let resultFrame;
    switch (operation) {
      case "encrypt":
        resultFrame = await cryptoModule.encryptFrame(frame);
        self.postMessage({
          type: "encrypted",
          frame: resultFrame
        }, [resultFrame.data]); // Transfer frame data
        break;
        
      case "decrypt":
        resultFrame = await cryptoModule.decryptFrame(frame);
        self.postMessage({
          type: "decrypted",
          frame: resultFrame
        }, [resultFrame.data]); // Transfer frame data
        break;
        
      default:
        console.warn(`Worker: Unknown operation received: ${operation}`);
        self.postMessage({
          type: "error",
          error: `Unknown operation: ${operation}`,
          operation: operation
        });
    }
  } catch (error) {
    console.error(`❌ Worker: Error during operation ${operation}:`, error.message, error.stack);
    // Send detailed error back to main thread
    self.postMessage({
      type: "error",
      error: `Worker error during ${operation}: ${error.message}`,
      operation: operation,
      frameInfo: frame ? { type: frame.type, timestamp: frame.timestamp } : null
    });
  }
};

// Log when the worker script finishes initial execution
console.log("Worker: Script initial execution finished.");
