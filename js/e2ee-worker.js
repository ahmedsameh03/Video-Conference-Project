importScripts("https://seenmeet.vercel.app/js/noble-ciphers.min.js");

let cipher = null;

onmessage = async (event) => {
  const { type, data, keyString, iv } = event.data;

  if (type === "init") {
    const keyBytes = new TextEncoder().encode(
      keyString.padEnd(32, "0").slice(0, 32)
    );
    cipher = nobleCiphers.siv.aes256gcm(keyBytes);
  }

  if (type === "encrypt") {
    const ivBytes = self.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = cipher.seal(ivBytes, new Uint8Array(data));
    postMessage({ type: "encrypted", data: encrypted, iv: ivBytes });
  }

  if (type === "decrypt") {
    try {
      const decrypted = cipher.open(iv, new Uint8Array(data));
      postMessage({ type: "decrypted", data: decrypted });
    } catch (e) {
      console.error("❌ Decryption failed", e);
    }
  }
};
console.log("🛡️ E2EE worker loaded");
