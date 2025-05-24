class E2EECrypto {
  constructor() {
    this.key = null;
    this.encoder = new TextEncoder();
  }

  /**
   * Set the encryption key from raw buffer
   * @param {ArrayBuffer} rawKeyBuffer 
   */
  async setKey(rawKeyBuffer) {
    this.key = await crypto.subtle.importKey(
      'raw',
      rawKeyBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    console.log("🔐 Crypto: Key set");
  }

  /**
   * Generate 12-byte IV using timestamp and SSRC
   */
  generateIV(frame) {
    const iv = new Uint8Array(12);
    const view = new DataView(iv.buffer);

    const timestamp = frame.timestamp || Date.now();
    view.setFloat64(0, timestamp, true);

    const ssrc = frame.synchronizationSource || 0;
    const seq = frame.sequenceNumber || 0;
    view.setUint32(8, ssrc ^ seq, true);

    return iv;
  }

  /**
   * Return codec-specific header size
   */
  getHeaderSize(frame) {
    if (frame.type === 'video') {
      if (frame.codecs?.includes("VP8")) return 10;
      if (frame.codecs?.includes("VP9")) return 3;
      if (frame.codecs?.includes("H264")) return 1;
      if (frame.codecs?.includes("AV1")) return 2;
    } else if (frame.type === 'audio' && frame.codecs?.includes("opus")) {
      return 1;
    }
    return 0;
  }

  /**
   * Encrypt a frame (video/audio)
   */
  async encryptFrame(frame) {
    if (!this.key || !frame.data) return frame;

    try {
      const iv = this.generateIV(frame);
      const data = new Uint8Array(frame.data);
      const headerSize = this.getHeaderSize(frame);
      const header = data.slice(0, headerSize);
      const payload = data.slice(headerSize);

      const encryptedPayload = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          additionalData: header
        },
        this.key,
        payload
      );

      const result = new Uint8Array(headerSize + encryptedPayload.byteLength);
      result.set(header);
      result.set(new Uint8Array(encryptedPayload), headerSize);

      return {
        ...frame,
        data: result.buffer,
        isEncrypted: true
      };

    } catch (e) {
      console.error("❌ Encryption failed:", e);
      return frame;
    }
  }

  /**
   * Decrypt a frame
   */
  async decryptFrame(frame) {
    if (!this.key || !frame.data || frame.isEncrypted === false) return frame;

    try {
      const iv = this.generateIV(frame);
      const data = new Uint8Array(frame.data);
      const headerSize = this.getHeaderSize(frame);
      const header = data.slice(0, headerSize);
      const payload = data.slice(headerSize);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          additionalData: header
        },
        this.key,
        payload
      );

      const result = new Uint8Array(headerSize + decrypted.byteLength);
      result.set(header);
      result.set(new Uint8Array(decrypted), headerSize);

      return {
        ...frame,
        data: result.buffer,
        isEncrypted: false
      };

    } catch (e) {
      console.error("❌ Decryption failed:", e);
      return frame;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = E2EECrypto;
}
