// js/e2ee-worker.js

/**
 * E2EE Worker - Web Worker for offloading encryption/decryption operations
 */

let cryptoModule = null;
let isCryptoReady = false; // Flag to track crypto module readiness

console.log("🛠️ Worker: Starting execution...");

try {
  console.log("🔄 Worker: Attempting to import e2ee-crypto.js...");

  // Resolve relative path
  const basePath = self.location.href.substring(0, self.location.href.lastIndexOf("/") + 1);
  const cryptoPath = basePath + "e2ee-crypto.js";

  console.log(`📦 Worker: Loading script from: ${cryptoPath}`);
  self.importScripts(cryptoPath);

  if (typeof E2EECrypto === 'undefined') {
    throw new Error("E2EECrypto class not defined after import.");
  }

  cryptoModule = new E2EECrypto();
  console.log("✅ Worker: E2EECrypto module initialized.");

  self.postMessage({ type: "worker_ready" });
  console.log("📤 Worker: Sent worker_ready message to main thread.");

} catch (error) {
  console.error("❌ Worker: Failed to import crypto module:", error.message, error.stack);
  self.postMessage({
    type: "error",
    error: "Import error: " + error.message,
    details: error.stack
  });
}

// Handle messages from E2EEManager
self.onmessage = async function (event) {
  const { operation, frame, keyData } = event.data;

  try {
    if (operation === "init") {
      if (!cryptoModule) cryptoModule = new E2EECrypto();

      if (!keyData) {
        self.postMessage({
          type: "error",
          error: "Missing keyData in init operation"
        });
        return;
      }

      await cryptoModule.setKey(keyData);
      isCryptoReady = true;
      console.log("🔑 Worker: Key imported and ready.");
      self.postMessage({ type: "initialized" });
      return;
    }

    // Guard against uninitialized crypto
    if (!isCryptoReady || !cryptoModule) {
      console.warn("⚠️ Worker: Operation skipped, crypto not initialized.");
      self.postMessage({
        type: "error",
        error: "Crypto not ready for operation: " + operation
      });
      return;
    }

    // Encryption
    if (operation === "encrypt") {
      const encrypted = await cryptoModule.encryptFrame(frame);
      self.postMessage({ type: "encrypted", frame: encrypted }, [encrypted.data]);
      return;
    }

    // Decryption
    if (operation === "decrypt") {
      const decrypted = await cryptoModule.decryptFrame(frame);
      self.postMessage({ type: "decrypted", frame: decrypted }, [decrypted.data]);
      return;
    }

    // Unknown
    self.postMessage({
      type: "error",
      error: "Unknown operation: " + operation
    });

  } catch (err) {
    console.error(`❌ Worker: Error during ${operation}:`, err.message, err.stack);
    self.postMessage({
      type: "error",
      error: `Worker error during ${operation}: ${err.message}`,
      operation,
      frameInfo: frame ? {
        type: frame.type,
        timestamp: frame.timestamp
      } : null
    });
  }
};

console.log("📦 Worker: Ready to receive messages.");
