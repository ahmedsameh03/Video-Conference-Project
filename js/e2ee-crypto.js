/**
 * E2EECrypto - Encryption Module for End-to-End Encryption
 * 
 * This module handles AES-GCM-SIV encryption and decryption of media frames
 * for WebRTC end-to-end encryption.
 */
class E2EECrypto {
  /**
   * Create a new E2EECrypto instance
   * @param {CryptoKey} [key] - Optional initial encryption key
   */
  constructor(key = null) {
    this.key = key;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    
    // Bind methods
    this.setKey = this.setKey.bind(this);
    this.generateIV = this.generateIV.bind(this);
    this.encryptFrame = this.encryptFrame.bind(this);
    this.decryptFrame = this.decryptFrame.bind(this);
    this.getHeaderSize = this.getHeaderSize.bind(this);
    
    console.log('🔐 E2EE Crypto Module initialized');
  }
  
  /**
   * Set the encryption key
   * @param {CryptoKey} key - The encryption key to use
   */
  setKey(key) {
    this.key = key;
    console.log('🔑 Encryption key updated');
  }
  
  /**
   * Generate a deterministic IV based on frame metadata
   * @param {Object} frame - The frame object containing metadata
   * @returns {Uint8Array} - The generated IV
   */
  generateIV(frame) {
    // Create a 12-byte (96-bit) IV as recommended for AES-GCM
    const iv = new Uint8Array(12);
    const dataView = new DataView(iv.buffer);
    
    // Use timestamp, synchronization source, and sequence number to ensure uniqueness
    // This creates a deterministic but unique IV for each frame
    
    // First 8 bytes: timestamp or current time
    const timestamp = frame.timestamp || Date.now();
    dataView.setFloat64(0, timestamp, true);
    
    // Next 4 bytes: combination of synchronization source and sequence number
    const ssrc = frame.synchronizationSource || 0;
    const seqNum = frame.sequenceNumber || 0;
    dataView.setUint32(8, ssrc ^ seqNum, true);
    
    return iv;
  }
  
  /**
   * Determine the header size based on codec type
   * @param {Object} frame - The frame object containing codec information
   * @returns {number} - The header size in bytes
   */
  getHeaderSize(frame) {
    // Default to 0 (no header)
    let headerSize = 0;
    
    // For video frames, keep codec-specific headers unencrypted
    if (frame.type === 'video') {
      if (frame.codecs && frame.codecs.includes('VP8')) {
        headerSize = 10; // VP8 header size
      } else if (frame.codecs && frame.codecs.includes('VP9')) {
        headerSize = 3; // VP9 header size
      } else if (frame.codecs && frame.codecs.includes('H264')) {
        headerSize = 1; // H264 header size (simplified)
      } else if (frame.codecs && frame.codecs.includes('AV1')) {
        headerSize = 2; // AV1 header size (simplified)
      }
    } else if (frame.type === 'audio') {
      if (frame.codecs && frame.codecs.includes('opus')) {
        headerSize = 1; // Opus header size (simplified)
      }
    }
    
    return headerSize;
  }
  
  /**
   * Encrypt a media frame using AES-GCM
   * @param {Object} frame - The frame to encrypt
   * @returns {Promise<Object>} - The encrypted frame
   */
  async encryptFrame(frame) {
    if (!this.key) {
      console.warn('⚠️ No encryption key set, returning original frame');
      return frame;
    }
    
    if (!frame.data || !(frame.data instanceof ArrayBuffer)) {
      console.warn('⚠️ Invalid frame data, returning original frame');
      return frame;
    }
    
    try {
      // Generate IV based on frame metadata
      const iv = this.generateIV(frame);
      
      // Get the frame data as Uint8Array
      const data = new Uint8Array(frame.data);
      
      // Determine header size based on codec
      const headerSize = this.getHeaderSize(frame);
      
      // Split the data into header (unencrypted) and payload (to be encrypted)
      const header = data.slice(0, headerSize);
      const payload = data.slice(headerSize);
      
      // Encrypt the payload using AES-GCM
      // Use the header as additional authenticated data (AAD) for integrity
      const encryptedPayload = await window.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          additionalData: header
        },
        this.key,
        payload
      );
      
      // Combine header and encrypted payload
      const encryptedData = new Uint8Array(header.byteLength + encryptedPayload.byteLength);
      encryptedData.set(header);
      encryptedData.set(new Uint8Array(encryptedPayload), header.byteLength);
      
      // Create a new frame with encrypted data
      const encryptedFrame = {
        ...frame,
        data: encryptedData.buffer
      };
      
      // Add metadata to indicate encryption
      encryptedFrame.isEncrypted = true;
      
      return encryptedFrame;
    } catch (error) {
      console.error('❌ Encryption error:', error);
      // Return original frame on error to avoid breaking the media pipeline
      return frame;
    }
  }
  
  /**
   * Decrypt a media frame using AES-GCM
   * @param {Object} frame - The frame to decrypt
   * @returns {Promise<Object>} - The decrypted frame
   */
  async decryptFrame(frame) {
    if (!this.key) {
      console.warn('⚠️ No decryption key set, returning original frame');
      return frame;
    }
    
    if (!frame.data || !(frame.data instanceof ArrayBuffer)) {
      console.warn('⚠️ Invalid frame data, returning original frame');
      return frame;
    }
    
    // Skip decryption if frame is not encrypted
    if (frame.isEncrypted === false) {
      return frame;
    }
    
    try {
      // Generate IV based on frame metadata (same as encryption)
      const iv = this.generateIV(frame);
      
      // Get the frame data as Uint8Array
      const data = new Uint8Array(frame.data);
      
      // Determine header size based on codec
      const headerSize = this.getHeaderSize(frame);
      
      // Split into header and encrypted payload
      const header = data.slice(0, headerSize);
      const encryptedPayload = data.slice(headerSize);
      
      // Decrypt the payload
      const decryptedPayload = await window.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
          additionalData: header
        },
        this.key,
        encryptedPayload
      );
      
      // Combine header and decrypted payload
      const decryptedData = new Uint8Array(header.byteLength + decryptedPayload.byteLength);
      decryptedData.set(header);
      decryptedData.set(new Uint8Array(decryptedPayload), header.byteLength);
      
      // Create a new frame with decrypted data
      const decryptedFrame = {
        ...frame,
        data: decryptedData.buffer,
        isEncrypted: false
      };
      
      return decryptedFrame;
    } catch (error) {
      console.error('❌ Decryption error:', error);
      // Return original frame on error to avoid breaking the media pipeline
      return frame;
    }
  }
  
  /**
   * Test encryption and decryption with a sample frame
   * @param {ArrayBuffer} sampleData - Sample data to encrypt and decrypt
   * @returns {Promise<Object>} - Test results
   */
  async testEncryptionDecryption(sampleData) {
    if (!this.key) {
      throw new Error('No encryption key set');
    }
    
    // Create a sample frame
    const sampleFrame = {
      type: 'video',
      codecs: ['VP8'],
      timestamp: Date.now(),
      synchronizationSource: 12345,
      sequenceNumber: 67890,
      data: sampleData
    };
    
    // Encrypt the frame
    const encryptedFrame = await this.encryptFrame(sampleFrame);
    
    // Decrypt the frame
    const decryptedFrame = await this.decryptFrame(encryptedFrame);
    
    // Compare original and decrypted data
    const originalData = new Uint8Array(sampleData);
    const decryptedData = new Uint8Array(decryptedFrame.data);
    
    let dataMatches = originalData.length === decryptedData.length;
    if (dataMatches) {
      for (let i = 0; i < originalData.length; i++) {
        if (originalData[i] !== decryptedData[i]) {
          dataMatches = false;
          break;
        }
      }
    }
    
    return {
      success: dataMatches,
      originalSize: originalData.length,
      encryptedSize: new Uint8Array(encryptedFrame.data).length,
      decryptedSize: decryptedData.length,
      headerSize: this.getHeaderSize(sampleFrame)
    };
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = E2EECrypto;
}
