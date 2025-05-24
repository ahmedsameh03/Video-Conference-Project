/**
 * E2EECrypto - Encryption Module for End-to-End Encryption
 * 
 * This module handles AES-GCM encryption and decryption of media frames
 * for WebRTC end-to-end encryption.
 */
class E2EECrypto {
  constructor() {
    this.key = null;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();

    // Bind methods
    this.setKey = this.setKey.bind(this);
    this.generateIV = this.generateIV.bind(this);
    this.encryptFrame = this.encryptFrame.bind(this);
    this.decryptFrame = this.decryptFrame.bind(this);
    this.getHeaderSize = this.getHeaderSize.bind(this);

    console.log('🔐 E2EE Crypto Module initialized');
  }

  /**
   * Set the encryption key using ArrayBuffer (imported from worker)
   * @param {ArrayBuffer} rawKeyBuffer 
   */
  async setKey(rawKeyBuffer) {
    try {
      this.key = await crypto.subtle.importKey(
        'raw',
        rawKeyBuffer,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
      console.log('🔑 Encryption key imported successfully');
    } catch (error) {
      console.error('❌ Failed to import encryption key:', error);
      throw error;
    }
  }

  /**
   * Generate a deterministic IV based on frame metadata
   */
  generateIV(frame) {
    const iv = new Uint8Array(12);
    const view = new DataView(iv.buffer);

    const timestamp = frame.timestamp || Date.now();
    view.setFloat64(0, timestamp, true);

    const ssrc = frame.synchronizationSource || 0;
    const seqNum = frame.sequenceNumber || 0;
    view.setUint32(8, ssrc ^ seqNum, true);

    return iv;
  }

  /**
   * Determine codec header size
   */
  getHeaderSize(frame) {
    if (frame.type === 'video') {
      if (frame.codecs?.includes('VP8')) return 10;
      if (frame.codecs?.includes('VP9')) return 3;
      if (frame.codecs?.includes('H264')) return 1;
      if (frame.codecs?.includes('AV1')) return 2;
    } else if (frame.type === 'audio') {
      if (frame.codecs?.includes('opus')) return 1;
    }
    return 0;
  }

  /**
   * Encrypt media frame
   */
  async encryptFrame(frame) {
    if (!this.key) {
      console.warn('⚠️ No encryption key set');
      return frame;
    }

    if (!frame.data || !(frame.data instanceof ArrayBuffer)) {
      console.warn('⚠️ Invalid frame data');
      return frame;
    }

    try {
      const iv = this.generateIV(frame);
      const data = new Uint8Array(frame.data);
      const headerSize = this.getHeaderSize(frame);
      const header = data.slice(0, headerSize);
      const payload = data.slice(headerSize);

      const encryptedPayload = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: header
        },
        this.key,
        payload
      );

      const encryptedData = new Uint8Array(header.length + encryptedPayload.byteLength);
      encryptedData.set(header);
      encryptedData.set(new Uint8Array(encryptedPayload), header.length);

      return {
        ...frame,
        data: encryptedData.buffer,
        isEncrypted: true
      };
    } catch (error) {
      console.error('❌ Encryption error:', error);
      return frame;
    }
  }

  /**
   * Decrypt media frame
   */
  async decryptFrame(frame) {
    if (!this.key) {
      console.warn('⚠️ No decryption key set');
      return frame;
    }

    if (!frame.data || !(frame.data instanceof ArrayBuffer)) {
      console.warn('⚠️ Invalid frame data');
      return frame;
    }

    if (frame.isEncrypted === false) return frame;

    try {
      const iv = this.generateIV(frame);
      const data = new Uint8Array(frame.data);
      const headerSize = this.getHeaderSize(frame);
      const header = data.slice(0, headerSize);
      const encryptedPayload = data.slice(headerSize);

      const decryptedPayload = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: header
        },
        this.key,
        encryptedPayload
      );

      const decryptedData = new Uint8Array(header.length + decryptedPayload.byteLength);
      decryptedData.set(header);
      decryptedData.set(new Uint8Array(decryptedPayload), header.length);

      return {
        ...frame,
        data: decryptedData.buffer,
        isEncrypted: false
      };
    } catch (error) {
      console.error('❌ Decryption error:', error);
      return frame;
    }
  }

  /**
   * For manual testing (optional)
   */
  async testEncryptionDecryption(sampleData) {
    const sampleFrame = {
      type: 'video',
      codecs: ['VP8'],
      timestamp: Date.now(),
      synchronizationSource: 123,
      sequenceNumber: 456,
      data: sampleData
    };

    const encrypted = await this.encryptFrame(sampleFrame);
    const decrypted = await this.decryptFrame(encrypted);

    const original = new Uint8Array(sampleData);
    const result = new Uint8Array(decrypted.data);

    const match = original.length === result.length &&
      original.every((byte, i) => byte === result[i]);

    return {
      success: match,
      originalLength: original.length,
      encryptedLength: encrypted.data.byteLength,
      decryptedLength: result.length
    };
  }
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = E2EECrypto;
}
