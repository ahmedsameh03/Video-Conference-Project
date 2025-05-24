// js/e2ee-key-manager.js - Key Management for E2EE using PBKDF2
class E2EEKeyManager {
  constructor(options = {}) {
    // Configuration for key derivation
    this.iterations = options.iterations || 600000; // OWASP 2023 recommendation for PBKDF2
    this.saltLength = 32; // 256-bit salt for security
    this.keyMaterial = null; // Raw key material from password
    this.currentKey = null; // Derived AES-GCM key
    this.exportedKey = null; // Exported key for transfer
  }

  /**
   * Generate an initial encryption key from a user password
   * @param {string} password - The user-provided password for key derivation
   * @returns {Promise<CryptoKey>} The derived AES-GCM key
   */
  async generateInitialKey(password) {
    try {
      const encoder = new TextEncoder();
      const passwordBuffer = encoder.encode(password);
      
      // Generate a cryptographically random salt
      const salt = crypto.getRandomValues(new Uint8Array(this.saltLength));
      
      // Import password as key material for PBKDF2 derivation
      this.keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      
      // Derive an AES-GCM key using PBKDF2 with the salt
      this.currentKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: this.iterations,
          hash: 'SHA-256'
        },
        this.keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true, // Make key extractable for worker transfer
        ['encrypt', 'decrypt']
      );
      
      // Export the key for transfer to worker
      this.exportedKey = await crypto.subtle.exportKey('raw', this.currentKey);
      
      console.log('🔑 Initial key generated successfully');
      return this.currentKey;
      
    } catch (error) {
      console.error('❌ Key generation failed:', error);
      throw error;
    }
  }

  /**
   * Get the exported key data for transfer to worker
   * @returns {ArrayBuffer} The exported key data
   */
  exportKey() {
    return this.exportedKey;
  }

  /**
   * Clean up sensitive key material on disable
   */
  disable() {
    this.keyMaterial = null;
    this.currentKey = null;
    this.exportedKey = null;
    console.log('🔑 Key manager cleaned up');
  }
}
