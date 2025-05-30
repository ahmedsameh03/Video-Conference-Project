// js/e2ee-key-manager.js - Key Management using X25519 Diffie-Hellman and HKDF

/**
 * Manages cryptographic keys for E2EE using X25519 Diffie-Hellman key exchange
 * and HKDF for deriving symmetric keys.
 * 
 * Relies on noble-curves and noble-hashes libraries being available in the context
 * where these methods are called (likely the main thread via e2ee-manager.js).
 */

// Assume noble libraries are available in the scope (e.g., imported in e2ee-manager)
declare var nobleCurves: any; 
declare var nobleHashes: any;

class E2EEKeyManager {
  constructor(options = {}) {
    this.privateKey = null; // User's own X25519 private key (Uint8Array)
    this.publicKey = null;  // User's own X25519 public key (Uint8Array)
    this.peerKeys = new Map(); // Map<peerId, { publicKey: Uint8Array, sharedKey?: Uint8Array }>
    
    // HKDF configuration
    this.hkdfHash = nobleHashes.sha256; // Hash function for HKDF
    this.hkdfSalt = new TextEncoder().encode("e2ee-hkdf-salt"); // Optional salt for HKDF
    this.hkdfInfo = new TextEncoder().encode("e2ee-aes-gcm-siv-key"); // Context info for HKDF
    this.derivedKeyLength = 32; // 256 bits for AES-GCM-SIV key

    console.log("[E2EE Key Manager] Initialized for Diffie-Hellman (X25519) + HKDF.");
  }

  /**
   * Generates the local user's X25519 key pair.
   * Should be called once when E2EE is initialized.
   */
  async generateKeyPair() {
    try {
      this.privateKey = nobleCurves.curve25519.utils.randomPrivateKey();
      this.publicKey = nobleCurves.curve25519.getPublicKey(this.privateKey);
      console.log("[E2EE Key Manager] X25519 key pair generated successfully.");
    } catch (error) {
      console.error("❌ [E2EE Key Manager] Error generating key pair:", error);
      this.privateKey = null;
      this.publicKey = null;
      throw error;
    }
  }

  /**
   * Returns the local user's public key.
   * @returns {Uint8Array | null} The public key as Uint8Array, or null if not generated.
   */
  getPublicKey() {
    return this.publicKey;
  }

  /**
   * Stores a peer's public key.
   * @param {string} peerId - The unique identifier for the peer.
   * @param {Uint8Array} peerPublicKey - The peer's public key as Uint8Array.
   */
  addPeerPublicKey(peerId, peerPublicKey) {
    if (!peerPublicKey || peerPublicKey.length !== 32) {
        console.error(`[E2EE Key Manager] Invalid public key received for peer ${peerId}.`);
        return;
    }
    if (!this.peerKeys.has(peerId)) {
        this.peerKeys.set(peerId, { publicKey: peerPublicKey });
        console.log(`[E2EE Key Manager] Stored public key for peer: ${peerId}`);
    } else {
        // Optionally update if needed, though keys are usually static per session
        this.peerKeys.get(peerId).publicKey = peerPublicKey;
        console.log(`[E2EE Key Manager] Updated public key for peer: ${peerId}`);
    }
  }

  /**
   * Computes the shared secret with a peer and derives the symmetric encryption key using HKDF.
   * @param {string} peerId - The unique identifier for the peer.
   * @returns {Promise<Uint8Array | null>} The derived 32-byte AES-GCM-SIV key as Uint8Array, or null on error.
   */
  async deriveKeyForPeer(peerId) {
    if (!this.privateKey) {
      console.error("[E2EE Key Manager] Cannot derive key: Local private key not generated.");
      return null;
    }
    
    const peerInfo = this.peerKeys.get(peerId);
    if (!peerInfo || !peerInfo.publicKey) {
      console.error(`[E2EE Key Manager] Cannot derive key for peer ${peerId}: Peer public key not found.`);
      return null;
    }

    try {
      // 1. Compute Shared Secret using X25519
      const sharedSecret = nobleCurves.curve25519.scalarMult(this.privateKey, peerInfo.publicKey);
      console.log(`[E2EE Key Manager] Computed shared secret with peer ${peerId}.`);

      // 2. Derive Symmetric Key using HKDF
      const derivedKey = nobleHashes.hkdf(this.hkdfHash, sharedSecret, this.hkdfSalt, this.hkdfInfo, this.derivedKeyLength);
      console.log(`[E2EE Key Manager] Derived AES-GCM-SIV key for peer ${peerId}.`);

      // Store the derived key (optional, could be passed directly to worker)
      peerInfo.sharedKey = derivedKey;
      
      return derivedKey;

    } catch (error) {
      console.error(`❌ [E2EE Key Manager] Error deriving key for peer ${peerId}:`, error);
      return null;
    }
  }

  /**
   * Retrieves the previously derived key for a peer.
   * @param {string} peerId - The unique identifier for the peer.
   * @returns {Uint8Array | undefined} The derived key or undefined if not derived yet.
   */
  getPeerKey(peerId) {
    return this.peerKeys.get(peerId)?.sharedKey;
  }

  /**
   * Removes a peer's information (e.g., when they leave).
   * @param {string} peerId - The unique identifier for the peer.
   */
  removePeer(peerId) {
    if (this.peerKeys.has(peerId)) {
      // Optionally zero out sensitive data before deleting
      const peerInfo = this.peerKeys.get(peerId);
      if (peerInfo.sharedKey) {
        peerInfo.sharedKey.fill(0);
      }
      this.peerKeys.delete(peerId);
      console.log(`[E2EE Key Manager] Removed peer ${peerId}.`);
    }
  }

  /**
   * Clean up sensitive key material on disable.
   */
  disable() {
    // Zero out private key
    if (this.privateKey) {
      this.privateKey.fill(0);
      this.privateKey = null;
    }
    this.publicKey = null;

    // Zero out derived peer keys
    this.peerKeys.forEach(peerInfo => {
      if (peerInfo.sharedKey) {
        peerInfo.sharedKey.fill(0);
      }
    });
    this.peerKeys.clear();
    
    console.log("🔑 [E2EE Key Manager] Cleaned up all keys.");
  }
}

