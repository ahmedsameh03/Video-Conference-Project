let cryptoModule = null;
let isCryptoReady = false;
let warnedOnce = false; // 🔐 لمنع تكرار التحذير

try {
  const basePath = self.location.href.substring(0, self.location.href.lastIndexOf("/") + 1);
  const cryptoPath = basePath + "e2ee-crypto.js";

  importScripts(cryptoPath);
  if (typeof E2EECrypto === 'undefined') {
    throw new Error("E2EECrypto not loaded");
  }

  cryptoModule = new E2EECrypto();
  postMessage({ type: "worker_ready" });

} catch (err) {
  postMessage({
    type: "error",
    error: "Failed to load e2ee-crypto.js: " + err.message
  });
}

self.onmessage = async function (event) {
  const { operation, frame, keyData } = event.data;

  try {
    if (operation === "init") {
      await cryptoModule.setKey(keyData);
      isCryptoReady = true;
      postMessage({ type: "initialized" });
      return;
    }

    if (!isCryptoReady || !cryptoModule) {
      if (!warnedOnce) {
        console.warn("⚠️ Worker: Operation skipped, crypto not initialized.");
        warnedOnce = true;
      }
      return;
    }

    if (operation === "encrypt") {
      const result = await cryptoModule.encryptFrame(frame);
      postMessage({ type: "encrypted", frame: result }, [result.data]);
    } else if (operation === "decrypt") {
      const result = await cryptoModule.decryptFrame(frame);
      postMessage({ type: "decrypted", frame: result }, [result.data]);
    } else {
      postMessage({ type: "error", error: `Unknown operation: ${operation}` });
    }

  } catch (error) {
    postMessage({
      type: "error",
      error: `Worker error during ${operation}: ${error.message}`
    });
  }
};
