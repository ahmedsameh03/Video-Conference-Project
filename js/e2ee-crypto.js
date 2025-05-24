// js/e2ee-crypto.js - AES-GCM Encryption Module
class E2EECrypto {
  constructor() {
    this.key = null;
    this.ALGORITHM = { name: 'AES-GCM', length: 256 };
    this.IV_LENGTH = 12;  // 96-bit IV for AES-GCM
    this.TAG_LENGTH = 16; // 128-bit authentication tag
    console.log('🔒 E2EECrypto instance created');
  }

  /**
   * Set the encryption key
   * @param {CryptoKey} key - The AES-GCM key
   */
  async setKey(key) {
    if (!(key instanceof CryptoKey)) {
      throw new Error('Invalid CryptoKey provided');
    }
    
    // Validate key algorithm
    if (key.algorithm.name !== 'AES-GCM') {
      throw new Error('Key must be AES-GCM algorithm');
    }
    
    this.key = key;
    console.log('🔑 Encryption key set successfully');
  }

  /**
   * Encrypt a video/audio frame
   * @param {Object} frame - Frame object with data property
   * @returns {Object} Encrypted frame with IV
   */
  async encryptFrame(frame) {
    if (!this.key) {
      throw new Error('Encryption key not initialized');
    }

    try {
      // Generate random IV for this frame
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
      
      // Encrypt the frame data
      const encrypted = await crypto.subtle.encrypt(
        { 
          name: 'AES-GCM', 
          iv: iv,
          tagLength: this.TAG_LENGTH * 8 // Convert to bits
        },
        this.key,
        frame.data
      );

      return {
        ...frame,
        data: encrypted,
        iv: iv.buffer,
        isEncrypted: true,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('❌ Encryption failed:', error);
      throw new Error(`Frame encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt a video/audio frame
   * @param {Object} frame - Encrypted frame object
   * @returns {Object} Decrypted frame
   */
  async decryptFrame(frame) {
    if (!this.key) {
      throw new Error('Decryption key not initialized');
    }

    try {
      // Extract IV from frame
      const iv = new Uint8Array(frame.iv);
      
      // Decrypt the frame data
      const decrypted = await crypto.subtle.decrypt(
        { 
          name: 'AES-GCM', 
          iv: iv,
          tagLength: this.TAG_LENGTH * 8 // Convert to bits
        },
        this.key,
        frame.data
      );

      return {
        ...frame,
        data: decrypted,
        isEncrypted: false
      };
    } catch (error) {
      console.error('❌ Decryption failed:', error);
      throw new Error(`Frame decryption failed: ${error.message}`);
    }
  }

  /**
   * Test encryption/decryption with sample data
   * @param {ArrayBuffer} testData - Sample data to test
   * @returns {Object} Test result
   */
  async testEncryptionDecryption(testData) {
    const frame = {
      type: 'test',
      timestamp: Date.now(),
      data: testData
    };

    try {
      // Test encrypt -> decrypt cycle
      const encrypted = await this.encryptFrame(frame);
      const decrypted = await this.decryptFrame(encrypted);
      
      // Compare original and decrypted data
      const original = new Uint8Array(testData);
      const result = new Uint8Array(decrypted.data);
      
      const isValid = original.length === result.length &&
        original.every((val, idx) => val === result[idx]);
      
      return {
        success: isValid,
        originalLength: original.length,
        decryptedLength: result.length
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message 
      };
    }
  }
}

// Export for Worker context
if (typeof self !== 'undefined') {
  self.E2EECrypto = E2EECrypto;
  console.log('✅ E2EECrypto exported to worker scope');
}

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = E2EECrypto;
}
