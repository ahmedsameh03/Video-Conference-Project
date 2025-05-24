// js/e2ee-key-manager.js - PBKDF2 Key Management
class E2EEKeyManager {
  constructor(options = {}) {
    this.iterations = options.iterations || 600000; // OWASP 2023 recommendation
    this.saltLength = 32; // 256-bit salt
    this.keyMaterial = null;
    this.currentKey = null;
    this.exportedKey = null;
  }

  /**
   * Generate initial encryption key from password
   * @param {string} password - User password
   * @returns {CryptoKey} The derived encryption key
   */
  async generateInitialKey(password) {
    try {
      const encoder = new TextEncoder();
      const passwordBuffer = encoder.encode(password);
      
      // Generate cryptographically random salt
      const salt = crypto.getRandomValues(new Uint8Array(this.saltLength));
      
      // Import password as key material for PBKDF2
      this.keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );
      
      // Derive AES-GCM key using PBKDF2
      this.currentKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: this.iterations,
          hash: 'SHA-256'
        },
        this.keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true, // Extractable for worker transfer
        ['encrypt', 'decrypt']
      );
      
      // Export key for transfer to worker
      this.exportedKey = await crypto.subtle.exportKey('raw', this.currentKey);
      
      console.log('🔑 Initial key generated successfully');
      return this.currentKey;
      
    } catch (error) {
      console.error('❌ Key generation failed:', error);
      throw error;
    }
  }

  /**
   * Export the current key for worker transfer
   * @returns {ArrayBuffer} The exported key data
   */
  exportKey() {
    return this.exportedKey;
  }

  /**
   * Clean up sensitive key material
   */
  disable() {
    this.keyMaterial = null;
    this.currentKey = null;
    this.exportedKey = null;
    console.log('🔑 Key manager cleaned up');
  }
}
