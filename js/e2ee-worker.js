// e2ee-worker.js
let key = null;

function encode(str) {
  return new TextEncoder().encode(str);
}

function generateKeyMaterial(passphrase) {
  return self.crypto.subtle.importKey(
    "raw",
    encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
}

function getKey(passphrase) {
  return generateKeyMaterial(passphrase).then((keyMaterial) => {
    return self.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encode("seen-project-salt"),
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  });
}

onmessage = async (event) => {
  const { type, data, keyString } = event.data;

  if (type === "init") {
    key = await getKey(keyString);
  }

  if (type === "encrypt") {
    const iv = self.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    postMessage({ type: "encrypted", data: encrypted, iv }, [encrypted]);
  }

  if (type === "decrypt") {
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: data.iv },
        key,
        data.data
      );
      postMessage({ type: "decrypted", data: decrypted }, [decrypted]);
    } catch (e) {
      console.error("❌ Decryption failed", e);
    }
  }
};
