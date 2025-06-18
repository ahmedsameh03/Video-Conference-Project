// Load noble ciphers for AES-GCM-SIV support
importScripts("https://cdn.jsdelivr.net/npm/@noble/ciphers/web.js");

const { aes } = nobleCiphers;
let cipherKey = null;

// Utility functions for encoding/decoding
function encode(str) {
  return new TextEncoder().encode(str);
}
function decode(buf) {
  return new TextDecoder().decode(buf);
}

// Derive a 256-bit key from passphrase (simplified XOR-based hash for worker use)
function getCipherKeyFromString(passphrase) {
  const hash = new Uint8Array(32);
  const encoded = encode(passphrase);
  for (let i = 0; i < encoded.length; i++) {
    hash[i % 32] ^= encoded[i];
  }
  return hash;
}

onmessage = async (event) => {
  const { type, data, keyString } = event.data;

  if (type === "init") {
    cipherKey = getCipherKeyFromString(keyString);
  }

  if (type === "encrypt") {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const gcmSiv = aes.gcmSiv(cipherKey, iv);
    const cipher = gcmSiv.encrypt(new Uint8Array(data));
    postMessage({ type: "encrypted", data: cipher, iv });
  }

  if (type === "decrypt") {
    try {
      const gcmSiv = aes.gcmSiv(cipherKey, new Uint8Array(data.iv));
      const plain = gcmSiv.decrypt(new Uint8Array(data.data));
      postMessage({ type: "decrypted", data: plain });
    } catch (e) {
      console.error("❌ Decryption failed:", e.message);
    }
  }
};
