class E2EEManager {
  constructor() {
    this.keyPair = null;
    this.sharedSecrets = new Map(); // userId -> shared secret
    this.sessionKeys = new Map(); // userId -> session key
    this.participants = new Set();
    this.isInitialized = false;
    this.keyRotationInterval = null;
    this.KEY_ROTATION_TIME = 5 * 60 * 1000; // 5 minutes
  }

  async initialize() {
    try {
      // Generate key pair for this participant
      this.keyPair = await window.crypto.subtle.generateKey(
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        true,
        ["deriveKey", "deriveBits"]
      );

      // Export public key for sharing
      const publicKey = await window.crypto.subtle.exportKey(
        "spki",
        this.keyPair.publicKey
      );

      this.isInitialized = true;
      console.log("🔐 E2EE Manager initialized successfully");

      return {
        publicKey: publicKey,
        publicKeyBase64: this.arrayBufferToBase64(publicKey),
      };
    } catch (error) {
      console.error("❌ Failed to initialize E2EE Manager:", error);
      throw error;
    }
  }

  async addParticipant(userId, publicKeyBase64) {
    try {
      // Special-case: if adding self, generate a symmetric AES-GCM key
      if (
        userId === window.name ||
        userId === (typeof name !== "undefined" ? name : undefined)
      ) {
        const sessionKey = await window.crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );
        this.sessionKeys.set(userId, sessionKey);
        this.participants.add(userId);
        console.log(
          `🔐 Added self (${userId}) to E2EE session with symmetric key`
        );
        return true;
      }

      const publicKeyBuffer = this.base64ToArrayBuffer(publicKeyBase64);
      const publicKey = await window.crypto.subtle.importKey(
        "spki",
        publicKeyBuffer,
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        false,
        []
      );

      // Derive shared secret (raw bits)
      const sharedSecret = await window.crypto.subtle.deriveBits(
        {
          name: "ECDH",
          public: publicKey,
        },
        this.keyPair.privateKey,
        256
      );

      // Import shared secret as a CryptoKey for PBKDF2
      const sharedSecretKey = await window.crypto.subtle.importKey(
        "raw",
        sharedSecret,
        { name: "PBKDF2" },
        false,
        ["deriveKey"]
      );

      // Derive session key from shared secret key
      const sessionKey = await window.crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: new TextEncoder().encode(`session-${userId}`),
          iterations: 100000,
          hash: "SHA-256",
        },
        sharedSecretKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );

      this.sharedSecrets.set(userId, sharedSecret);
      this.sessionKeys.set(userId, sessionKey);
      this.participants.add(userId);

      console.log(`🔐 Added participant ${userId} to E2EE session`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to add participant ${userId}:`, error);
      return false;
    }
  }

  async removeParticipant(userId) {
    this.sharedSecrets.delete(userId);
    this.sessionKeys.delete(userId);
    this.participants.delete(userId);
    console.log(`🔐 Removed participant ${userId} from E2EE session`);
  }

  async encrypt(data, userId) {
    try {
      const sessionKey = this.sessionKeys.get(userId);
      if (!sessionKey) {
        throw new Error(`No session key found for user ${userId}`);
      }

      // Generate random IV
      const iv = window.crypto.getRandomValues(new Uint8Array(12));

      // Encrypt data using AES-GCM
      const encrypted = await window.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv,
        },
        sessionKey,
        data
      );

      // Combine IV and encrypted data
      const result = new Uint8Array(iv.length + encrypted.byteLength);
      result.set(iv, 0);
      result.set(new Uint8Array(encrypted), iv.length);

      return result;
    } catch (error) {
      console.error(`❌ Encryption failed for user ${userId}:`, error);
      throw error;
    }
  }

  async decrypt(encryptedData, userId) {
    try {
      const sessionKey = this.sessionKeys.get(userId);
      if (!sessionKey) {
        throw new Error(`No session key found for user ${userId}`);
      }

      // Extract IV and encrypted data
      const iv = encryptedData.slice(0, 12);
      const data = encryptedData.slice(12);

      // Decrypt data
      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
        },
        sessionKey,
        data
      );

      return decrypted;
    } catch (error) {
      console.error(`❌ Decryption failed for user ${userId}:`, error);
      throw error;
    }
  }

  async rotateKeys() {
    console.log("🔄 Rotating E2EE session keys...");

    for (const [userId, sharedSecret] of this.sharedSecrets) {
      try {
        // Derive new session key
        const newSessionKey = await window.crypto.subtle.deriveKey(
          {
            name: "PBKDF2",
            salt: new TextEncoder().encode(`session-${userId}-${Date.now()}`),
            iterations: 100000,
            hash: "SHA-256",
          },
          sharedSecret,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );

        this.sessionKeys.set(userId, newSessionKey);
      } catch (error) {
        console.error(`❌ Failed to rotate keys for ${userId}:`, error);
      }
    }
  }

  startKeyRotation() {
    if (this.keyRotationInterval) {
      clearInterval(this.keyRotationInterval);
    }

    this.keyRotationInterval = setInterval(() => {
      this.rotateKeys();
    }, this.KEY_ROTATION_TIME);
  }

  stopKeyRotation() {
    if (this.keyRotationInterval) {
      clearInterval(this.keyRotationInterval);
      this.keyRotationInterval = null;
    }
  }

  getParticipantCount() {
    return this.participants.size;
  }

  isParticipant(userId) {
    return this.participants.has(userId);
  }

  // Utility functions
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  destroy() {
    this.stopKeyRotation();
    this.sharedSecrets.clear();
    this.sessionKeys.clear();
    this.participants.clear();
    this.keyPair = null;
    this.isInitialized = false;
    console.log("🔐 E2EE Manager destroyed");
  }
}
