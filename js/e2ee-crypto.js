// js/e2ee-crypto.js - Cryptographic Operations using AES-GCM-SIV (via noble-ciphers)

/**
 * WARNING: This implementation relies on the noble-ciphers library,
 * which needs to be available in the execution context (e.g., imported in the worker).
 * It also uses a simplified approach without Associated Data (AD) for this demo.
 * Proper AD (like RTP header) should be used in production for enhanced security.
 */

// Assume noble-ciphers functions are available in the scope (e.g., imported in worker)
declare var nobleCiphers: any; // Placeholder for type checking if using TypeScript

class E2EECrypto {
  constructor() {
    this.key = null; // Stores the raw Uint8Array key
    this.nonceLength = 12; // Standard nonce length for AES-GCM-SIV
    this.associatedData = new Uint8Array(); // Empty AD for this demo
    console.log("[E2EECrypto] Module initialized for AES-GCM-SIV.");
  }

  /**
   * Set the raw encryption key.
   * @param {Uint8Array} keyMaterial - The raw 256-bit (32 bytes) key.
   */
  async setKey(keyMaterial) {
    if (!keyMaterial || keyMaterial.byteLength !== 32) {
      throw new Error("Invalid key material provided. Key must be 32 bytes (256 bits).");
    }
    this.key = keyMaterial;
    console.log("[E2EECrypto] AES-GCM-SIV key set successfully.");
  }

  /**
   * Encrypt a media frame using AES-GCM-SIV.
   * @param {RTCEncodedVideoFrame | RTCEncodedAudioFrame} frame - The media frame to encrypt.
   * @returns {Promise<RTCEncodedVideoFrame | RTCEncodedAudioFrame>} The frame with encrypted data.
   */
  async encryptFrame(frame) {
    if (!this.key) {
      throw new Error("Encryption key not set.");
    }

    const frameData = new Uint8Array(frame.data);
    
    // 1. Generate a random nonce (12 bytes)
    const nonce = crypto.getRandomValues(new Uint8Array(this.nonceLength));

    try {
      // 2. Encrypt using noble-ciphers gcmsiv
      // noble-ciphers gcmsiv function is expected to be globally available or imported
      const siv = nobleCiphers.aes.gcmsiv(this.key, nonce, this.associatedData);
      const ciphertext = siv.encrypt(frameData);

      // 3. Prepend nonce to ciphertext
      const encryptedData = new Uint8Array(this.nonceLength + ciphertext.byteLength);
      encryptedData.set(nonce, 0);
      encryptedData.set(ciphertext, this.nonceLength);

      // 4. Update frame data
      frame.data = encryptedData.buffer;
      return frame;

    } catch (error) {
      console.error("❌ [E2EECrypto] AES-GCM-SIV Encryption failed:", error);
      // Return original frame on failure to avoid breaking the stream
      // In production, better error handling might be needed
      frame.data = frameData.buffer; // Restore original data
      return frame;
    }
  }

  /**
   * Decrypt a media frame using AES-GCM-SIV.
   * @param {RTCEncodedVideoFrame | RTCEncodedAudioFrame} frame - The media frame to decrypt.
   * @returns {Promise<RTCEncodedVideoFrame | RTCEncodedAudioFrame>} The frame with decrypted data.
   */
  async decryptFrame(frame) {
    if (!this.key) {
      throw new Error("Decryption key not set.");
    }

    const encryptedData = new Uint8Array(frame.data);

    if (encryptedData.byteLength < this.nonceLength) {
      console.error("❌ [E2EECrypto] Decryption failed: Frame data is too short to contain a nonce.");
      // Return original frame as it might be unencrypted or corrupted
      return frame;
    }

    // 1. Extract nonce and ciphertext
    const nonce = encryptedData.slice(0, this.nonceLength);
    const ciphertext = encryptedData.slice(this.nonceLength);

    try {
      // 2. Decrypt using noble-ciphers gcmsiv
      const siv = nobleCiphers.aes.gcmsiv(this.key, nonce, this.associatedData);
      const decryptedData = siv.decrypt(ciphertext);

      // 3. Update frame data
      frame.data = decryptedData.buffer;
      return frame;

    } catch (error) {
      console.error("❌ [E2EECrypto] AES-GCM-SIV Decryption failed:", error);
      // Return original frame on failure (might be corrupted, tampered, or wrong key)
      frame.data = encryptedData.buffer; // Restore original data
      return frame;
    }
  }
}

