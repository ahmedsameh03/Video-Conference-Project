/**
 * E2EEKeyManager - Key Management Module for End-to-End Encryption
 * 
 * This module handles secure key generation, derivation, and ratcheting
 * for AES-GCM-SIV encryption in WebRTC communications.
 */
class E2EEKeyManager {
  /**
   * Create a new E2EEKeyManager instance
   * @param {Object} options - Configuration options
   * @param {string} options.roomId - The room ID to use as part of the salt
   * @param {number} options.ratchetInterval - Interval in ms for key ratcheting (default: 60000)
   * @param {number} options.iterations - PBKDF2 iterations (default: 100000)
   */
  constructor(options = {}) {
    this.keyMaterial = null;
    this.currentKey = null;
    this.exportedKey = null;
    this.keyCounter = 0;
    this.ratchetInterval = options.ratchetInterval || 60000; // 1 minute default
    this.roomId = options.roomId || '';
    this.iterations = options.iterations || 100000;
    this.ratchetTimer = null;
    this.onKeyRatchet = null;
    this.enabled = false;
    
    // Bind methods
    this.generateInitialKey = this.generateInitialKey.bind(this);
    this.ratchetKey = this.ratchetKey.bind(this);
    this.startKeyRatcheting = this.startKeyRatcheting.bind(this);
    this.stopKeyRatcheting = this.stopKeyRatcheting.bind(this);
    this.exportKey = this.exportKey.bind(this);
    this.importKey = this.importKey.bind(this);
    
    console.log('🔑 E2EE Key Manager initialized');
  }

  /**
   * Generate the initial encryption key from a password
   * @param {string} password - The password to derive the key from
   * @returns {Promise<ArrayBuffer>} - The exported key
   */
  async generateInitialKey(password) {
    if (!password) {
      throw new Error('Password is required for key generation');
    }
    
    console.log('🔑 Generating initial encryption key');
    
    try {
      // Use TextEncoder to convert the password to a Uint8Array
      const encoder = new TextEncoder();
      const passwordBuffer = encoder.encode(password);
      
      // Use room ID as part of the salt for domain separation
      const salt = encoder.encode(`e2ee-${this.roomId}-salt`);
      
      // Import password as key material for PBKDF2
      this.keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );
      
      // Derive the actual encryption key
      await this.ratchetKey();
      
      // Set up periodic key ratcheting
      this.startKeyRatcheting();
      this.enabled = true;
      
      return this.exportedKey;
    } catch (error) {
      console.error('❌ Error generating initial key:', error);
      throw new Error(`Key generation failed: ${error.message}`);
    }
  }

  /**
   * Derive a new key using the key material and counter (key ratcheting)
   * @returns {Promise<ArrayBuffer>} - The exported key
   */
  async ratchetKey() {
    if (!this.keyMaterial) {
      throw new Error('Key material not initialized. Call generateInitialKey first.');
    }
    
    try {
      // Increment counter for key ratcheting
      this.keyCounter++;
      
      // Create a unique salt for this ratchet step
      const salt = new TextEncoder().encode(`e2ee-${this.roomId}-${this.keyCounter}`);
      
      // Derive a new key using PBKDF2
      this.currentKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: this.iterations,
          hash: 'SHA-256'
        },
        this.keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true, // extractable
        ['encrypt', 'decrypt']
      );
      
      // Export the key for distribution
      this.exportedKey = await window.crypto.subtle.exportKey('raw', this.currentKey);
      
      console.log(`🔄 Key ratcheted (iteration: ${this.keyCounter})`);
      
      // Notify about key change if callback is set
      if (this.onKeyRatchet && typeof this.onKeyRatchet === 'function') {
        this.onKeyRatchet(this.exportedKey);
      }
      
      return this.exportedKey;
    } catch (error) {
      console.error('❌ Error ratcheting key:', error);
      throw new Error(`Key ratcheting failed: ${error.message}`);
    }
  }
  
  /**
   * Start periodic key ratcheting
   */
  startKeyRatcheting() {
    if (this.ratchetTimer) {
      clearInterval(this.ratchetTimer);
    }
    
    this.ratchetTimer = setInterval(async () => {
      try {
        await this.ratchetKey();
      } catch (error) {
        console.error('❌ Error during scheduled key ratcheting:', error);
      }
    }, this.ratchetInterval);
    
    console.log(`🔄 Key ratcheting started (interval: ${this.ratchetInterval}ms)`);
  }
  
  /**
   * Stop periodic key ratcheting
   */
  stopKeyRatcheting() {
    if (this.ratchetTimer) {
      clearInterval(this.ratchetTimer);
      this.ratchetTimer = null;
      console.log('🛑 Key ratcheting stopped');
    }
  }
  
  /**
   * Export the current key for distribution
   * @returns {ArrayBuffer|null} - The current key as ArrayBuffer or null if not initialized
   */
  exportKey() {
    return this.exportedKey;
  }
  
  /**
   * Import an external key
   * @param {ArrayBuffer} keyData - The key data to import
   * @returns {Promise<CryptoKey>} - The imported key
   */
  async importKey(keyData) {
    try {
      this.currentKey = await window.crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'AES-GCM', length: 256 },
        false, // not extractable
        ['encrypt', 'decrypt']
      );
      
      this.exportedKey = keyData;
      console.log('✅ External key imported successfully');
      
      return this.currentKey;
    } catch (error) {
      console.error('❌ Error importing key:', error);
      throw new Error(`Key import failed: ${error.message}`);
    }
  }
  
  /**
   * Get the current encryption key
   * @returns {CryptoKey|null} - The current CryptoKey or null if not initialized
   */
  getCurrentKey() {
    return this.currentKey;
  }
  
  /**
   * Check if the key manager is enabled and has a valid key
   * @returns {boolean} - True if enabled and has a valid key
   */
  isEnabled() {
    return this.enabled && this.currentKey !== null;
  }
  
  /**
   * Disable the key manager and clear sensitive data
   */
  disable() {
    this.stopKeyRatcheting();
    this.currentKey = null;
    this.exportedKey = null;
    this.enabled = false;
    console.log('🔒 E2EE Key Manager disabled');
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = E2EEKeyManager;
}
