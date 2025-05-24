// الملف: js/e2ee-worker.js

/**
 * E2EE Worker - Web Worker for offloading encryption/decryption operations
 */

let cryptoModule = null;
let isCryptoReady = false; // Flag to track crypto module readiness

console.log("Worker: Script starting execution.");

// Import required modules
try {
  console.log("Worker: Attempting to import e2ee-crypto.js...");  // Use a relative path assuming e2ee-crypto.js is in the same directory as the worker.
  // If the deployment structure places worker/crypto scripts differently, adjust this path.
  self.importScripts("e2ee-crypto.js");
  console.log("Worker: Successfully imported e2ee-crypto.js.");  // Verify that the expected class/functions are now available
  if (typeof E2EECrypto === 'undefined') {
    throw new Error("E2EECrypto class not found after importScripts.");
  }
  console.log("Worker: E2EECrypto class confirmed available.");

  // Signal readiness to the main thread AFTER successful import and verification
  self.postMessage({ type: "worker_ready" });
  console.log("Worker: Sent worker_ready message.");

} catch (e) {
  console.error("❌ Worker: Error during importScripts or verification:", e.message, e.stack);
  // Send error back to main thread
  self.postMessage({ type: "error", error: `Failed to import or verify crypto script: ${e.message}` });
  // Optional: Close the worker if the import is critical
  // self.close();
}

// Handle messages from main thread
self.onmessage = async function(event) {
  const { operation, frame, keyData } = event.data;

  console.log(`Worker: Received message - Operation: ${operation}`);

  try {
    // Initialize or update crypto module and key
    if (operation === "init") {
      console.log("Worker: Received 'init' operation.");
      if (!cryptoModule) {
        if (typeof E2EECrypto === 'undefined') {
           console.error("❌ Worker: E2EECrypto class is not defined. Cannot initialize module.");
           throw new Error("Crypto library not loaded correctly.");
        }
        console.log("Worker: Creating new E2EECrypto instance.");
        cryptoModule = new E2EECrypto();
      }
      if (keyData) {
        console.log("Worker: Setting encryption key.");
        // Assuming keyData is already a CryptoKey or suitable format
        await cryptoModule.setKey(keyData);
        isCryptoReady = true; // Mark as ready only after key is set
        console.log("Worker: Key set successfully. Crypto module is ready.");
        // Send confirmation back to manager
        self.postMessage({ type: "initialized" });
      } else {
         console.warn("Worker: 'init' operation received without keyData.");
         isCryptoReady = false; // Ensure it's marked not ready if key is missing
      }
      return; // Initialization complete for this message
    }

    // Check if crypto module is ready for encrypt/decrypt operations
    if (!isCryptoReady || !cryptoModule) {
      console.error(`❌ Worker: Crypto module not ready or key not set for operation '${operation}'.`);
      throw new Error(`Crypto module not initialized or no key set for operation: ${operation}`);
    }

    // Perform encryption/decryption
    let resultFrame;
    switch (operation) {
      case "encrypt":
        console.log("Worker: Performing encryption...");
        resultFrame = await cryptoModule.encryptFrame(frame);
        console.log("Worker: Encryption complete.");
        self.postMessage({
          type: "encrypted",
          frame: resultFrame
        }, [resultFrame.data]); // Transfer frame data
        break;
      case "decrypt":
        console.log("Worker: Performing decryption...");
        resultFrame = await cryptoModule.decryptFrame(frame);
        console.log("Worker: Decryption complete.");
        self.postMessage({
          type: "decrypted",
          frame: resultFrame
        }, [resultFrame.data]); // Transfer frame data
        break;
      default:
        console.warn(`Worker: Unknown operation received: ${operation}`);
        throw new Error(`Unknown operation: ${operation}`);
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
    // Optionally re-throw or handle differently
  }
};

// Log when the worker script finishes initial execution (excluding async operations)
console.log("Worker: Script initial execution finished.");

