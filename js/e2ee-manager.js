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

  async checkAESGCM_SIVSupport() {
    try {
      // Test if AES-GCM-SIV is supported
      const testKey = await window.crypto.subtle.generateKey(
        { name: "AES-GCM-SIV", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );

      const testData = new TextEncoder().encode("test");
      const testNonce = window.crypto.getRandomValues(new Uint8Array(12));

      await window.crypto.subtle.encrypt(
        { name: "AES-GCM-SIV", iv: testNonce },
        testKey,
        testData
      );

      console.log("✅ AES-GCM-SIV is supported by this browser");
      return true;
    } catch (error) {
      console.error("❌ This browser does not support AES-GCM-SIV encryption");
      throw new Error(
        "AES-GCM-SIV encryption is required but not supported by this browser"
      );
    }
  }

  async initialize() {
    try {
      // Check AES-GCM-SIV support first - will throw if not supported
      await this.checkAESGCM_SIVSupport();

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
      console.log("🔐 E2EE Manager initialized successfully with AES-GCM-SIV");

      return {
        publicKey: publicKey,
        publicKeyBase64: this.arrayBufferToBase64(publicKey),
        algorithm: "AES-GCM-SIV",
      };
    } catch (error) {
      console.error("❌ Failed to initialize E2EE Manager:", error);
      throw error;
    }
  }

  async addParticipant(userId, publicKeyBase64) {
    try {
      // Get current user name from URL parameters
      const currentName = new URLSearchParams(window.location.search).get(
        "name"
      );

      // Special-case: if adding self, create a shared secret for verification
      if (userId === currentName) {
        // For self-verification, we need to create a shared secret
        // We'll use a deterministic method based on the user's public key
        const selfPublicKey = await window.crypto.subtle.exportKey(
          "spki",
          this.keyPair.publicKey
        );

        // Create a "shared secret" for self by hashing the public key
        const hash = await window.crypto.subtle.digest(
          "SHA-256",
          selfPublicKey
        );
        const sharedSecret = new ArrayBuffer(32);
        const hashArray = new Uint8Array(hash);
        const secretArray = new Uint8Array(sharedSecret);
        secretArray.set(hashArray.slice(0, 32));

        // Create session key for self using AES-GCM-SIV
        const sessionKey = await window.crypto.subtle.generateKey(
          { name: "AES-GCM-SIV", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );

        this.sharedSecrets.set(userId, sharedSecret);
        this.sessionKeys.set(userId, sessionKey);
        this.participants.add(userId);
        console.log(
          `🔐 Added self (${userId}) to E2EE session with self-verification key using AES-GCM-SIV`
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

      // Derive session key from shared secret key using AES-GCM-SIV
      const sessionKey = await window.crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: new TextEncoder().encode(`session-${userId}`),
          iterations: 100000,
          hash: "SHA-256",
        },
        sharedSecretKey,
        { name: "AES-GCM-SIV", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );

      this.sharedSecrets.set(userId, sharedSecret);
      this.sessionKeys.set(userId, sessionKey);
      this.participants.add(userId);

      console.log(
        `🔐 Added participant ${userId} to E2EE session using AES-GCM-SIV`
      );
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

      // Generate random nonce/IV (12 bytes)
      const nonce = window.crypto.getRandomValues(new Uint8Array(12));

      // Encrypt data using AES-GCM-SIV
      const encrypted = await window.crypto.subtle.encrypt(
        {
          name: "AES-GCM-SIV",
          iv: nonce,
        },
        sessionKey,
        data
      );

      // Combine nonce and encrypted data
      const result = new Uint8Array(nonce.length + encrypted.byteLength);
      result.set(nonce, 0);
      result.set(new Uint8Array(encrypted), nonce.length);

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

      // Extract nonce and encrypted data
      const nonce = encryptedData.slice(0, 12);
      const data = encryptedData.slice(12);

      // Decrypt data using AES-GCM-SIV
      const decrypted = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM-SIV",
          iv: nonce,
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
        // Derive new session key using AES-GCM-SIV
        const sessionKey = await window.crypto.subtle.deriveKey(
          {
            name: "PBKDF2",
            salt: new TextEncoder().encode(`session-${userId}-${Date.now()}`),
            iterations: 100000,
            hash: "SHA-256",
          },
          sharedSecret,
          { name: "AES-GCM-SIV", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );

        this.sessionKeys.set(userId, sessionKey);
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
