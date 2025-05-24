// js/e2ee-crypto.js - Complete Crypto Module
class E2EECrypto {
  constructor() {
    this.key = null;
    this.ALGORITHM = { name: 'AES-GCM', length: 256 };
    this.IV_LENGTH = 12;
    console.log('🔒 E2EECrypto initialized');
  }

  async setKey(key) {
    if (!(key instanceof CryptoKey)) {
      throw new Error('Invalid CryptoKey');
    }
    this.key = key;
    console.log('🔑 Key set successfully');
  }

  async encryptFrame(frame) {
    if (!this.key) {
      throw new Error('No encryption key');
    }

    try {
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.key,
        frame.data
      );

      return {
        ...frame,
        data: encrypted,
        iv: iv.buffer,
        isEncrypted: true
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  async decryptFrame(frame) {
    if (!this.key) {
      throw new Error('No decryption key');
    }

    try {
      const iv = new Uint8Array(frame.iv);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        this.key,
        frame.data
      );

      return {
        ...frame,
        data: decrypted,
        isEncrypted: false
      };
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  async testEncryptionDecryption(data) {
    const frame = {
      type: 'test',
      timestamp: Date.now(),
      data: data
    };

    try {
      const encrypted = await this.encryptFrame(frame);
      const decrypted = await this.decryptFrame(encrypted);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Export for worker
if (typeof self !== 'undefined') {
  self.E2EECrypto = E2EECrypto;
  console.log('✅ E2EECrypto exported to worker');
}
