// js/e2ee-crypto.js - AES-GCM Encryption Module for E2EE
class E2EECrypto {
  constructor() {
    this.key = null; // Holds the encryption/decryption key
    this.ALGORITHM = { name: 'AES-GCM', length: 256 }; // AES-GCM with 256-bit key
    this.IV_LENGTH = 12; // 96-bit Initialization Vector for AES-GCM
    this.TAG_LENGTH = 16; // 128-bit authentication tag
    console.log('🔒 E2EECrypto instance created');
  }

  /**
   * Set the encryption key for AES-GCM operations
   * @param {CryptoKey} key - The AES-GCM key to use for encryption/decryption
   */
  async setKey(key) {
    if (!(key instanceof CryptoKey)) {
      throw new Error('Invalid CryptoKey provided');
    }
    
    // Validate that the key is for AES-GCM
    if (key.algorithm.name !== 'AES-GCM') {
      throw new Error('Key must be for AES-GCM algorithm');
    }
    
    this.key = key;
    console.log('🔑 Encryption key set successfully');
  }

  /**
   * Encrypt a media frame (audio/video) using AES-GCM
   * @param {Object} frame - The frame object containing data to encrypt
   * @returns {Object} The encrypted frame with IV and metadata
   */
  async encryptFrame(frame) {
    if (!this.key) {
      throw new Error('Encryption key not initialized');
    }

    try {
      // Generate a random IV for this encryption
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
      
      // Encrypt the frame data using AES-GCM
      const encrypted = await crypto.subtle.encrypt(
        { 
          name: 'AES-GCM', 
          iv: iv,
          tagLength: this.TAG_LENGTH * 8 // Convert bytes to bits
        },
        this.key,
        frame.data
      );

      return {
        ...frame,
        data: encrypted,
        iv: iv.buffer, // Store IV for decryption
        isEncrypted: true,
        timestamp: Date.now() // Add timestamp for replay protection
      };
    } catch (error) {
      console.error('❌ Encryption failed:', error);
      throw new Error(`Frame encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt a media frame (audio/video) using AES-GCM
   * @param {Object} frame - The encrypted frame object
   * @returns {Object} The decrypted frame
   */
  async decryptFrame(frame) {
    if (!this.key) {
      throw new Error('Decryption key not initialized');
    }

    try {
      // Extract IV from the frame
      const iv = new Uint8Array(frame.iv);
      
      // Decrypt the frame data using AES-GCM
      const decrypted = await crypto.subtle.decrypt(
        { 
          name: 'AES-GCM', 
          iv: iv,
          tagLength: this.TAG_LENGTH * 8 // Convert bytes to bits
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
}

// Export the class to the Worker scope
if (typeof self !== 'undefined') {
  self.E2EECrypto = E2EECrypto;
  console.log('✅ E2EECrypto exported to worker scope');
}

// Export for Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = E2EECrypto;
}
