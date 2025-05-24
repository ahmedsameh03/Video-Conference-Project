// js/e2ee-key-manager.js
class E2EEKeyManager {
  constructor(options = {}) {
    this.iterations = options.iterations || 600000;
    this.saltLength = 32;
    this.keyMaterial = null;
    this.currentKey = null;
    this.exportedKey = null;
    this.roomId = options.roomId || "seen";
  }

  async generateInitialKey(password) {
    try {
      const encoder = new TextEncoder();
      const passwordBuffer = encoder.encode(password);

      // ⛓️ ثابت بناءً على room ID لتوحيد المفتاح بين المستخدمين
      const salt = encoder.encode(this.roomId);

      this.keyMaterial = await crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );

      this.currentKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: this.iterations,
          hash: 'SHA-256'
        },
        this.keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      this.exportedKey = await crypto.subtle.exportKey('raw', this.currentKey);
      console.log('🔑 Initial key generated successfully');
      return this.currentKey;
    } catch (error) {
      console.error('❌ Key generation failed:', error);
      throw error;
    }
  }

  exportKey() {
    return this.exportedKey;
  }

  disable() {
    this.keyMaterial = null;
    this.currentKey = null;
    this.exportedKey = null;
    console.log('🔑 Key manager cleaned up');
  }
}
