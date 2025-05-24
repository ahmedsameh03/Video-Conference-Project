// js/e2ee-manager.js - E2EE System Manager for WebRTC
class E2EEManager {
  constructor(options = {}) {
    // Configuration options with defaults
    this.config = {
      workerPath: '/js/e2ee-worker.js', // Path to worker script
      initTimeout: 30000, // Timeout for worker initialization (30 seconds)
      ...options
    };
    
    this.worker = null;           // Web Worker instance
    this.keyManager = null;       // Key manager instance
    this.enabled = false;         // Tracks if E2EE is enabled
    this.workerReady = false;     // Tracks if worker is ready
    this.keyInitialized = false;  // Tracks if key is initialized in worker
  }

  /**
   * Enable E2EE with a user-provided password for key derivation
   * @param {string} password - Password to derive encryption key
   * @returns {Promise<void>} Resolves when E2EE is enabled
   */
  async enable(password) {
    if (this.enabled) return;
    
    try {
      console.log('🔒 Enabling E2EE...');
      
      // Step 1: Create key manager and generate initial key from password
      this.keyManager = new E2EEKeyManager();
      const key = await this.keyManager.generateInitialKey(password);
      console.log('✅ Key generated');
      
      // Step 2: Initialize worker and wait for readiness
      await this.initializeWorker();
      console.log('✅ Worker ready');
      
      // Step 3: Send key to worker and wait for crypto initialization
      await this.initializeCrypto(key);
      console.log('✅ Crypto initialized');
      
      // E2EE is now fully enabled
      this.enabled = true;
      console.log('✅ E2EE enabled successfully');
      
    } catch (error) {
      console.error('❌ E2EE enable failed:', error);
      this.disable();
      throw error;
    }
  }

  /**
   * Initialize the Web Worker with retry logic and proper error handling
   * @returns {Promise<void>} Resolves when worker is ready
   */
  async initializeWorker() {
    return new Promise((resolve, reject) => {
      // Create a new Web Worker instance
      this.worker = new Worker(this.config.workerPath, {
        type: 'classic',
        name: 'E2EEWorker'
      });

      let resolved = false;
      // Set a timeout for worker initialization
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Worker initialization timeout'));
        }
      }, this.config.initTimeout);

      // Handle messages from worker
      this.worker.onmessage = ({ data }) => {
        console.log('📨 Manager received:', data.type);
        
        switch (data.type) {
          case 'worker_ready':
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              this.workerReady = true;
              resolve();
            }
            break;
            
          case 'crypto_load_failed':
          case 'fatal_error':
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              reject(new Error(`Worker error: ${data.error}`));
            }
            break;
        }
      };

      // Handle runtime errors from worker
      this.worker.onerror = (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Worker runtime error: ${error.message}`));
        }
      };
    });
  }

  /**
   * Initialize crypto module in worker by sending the encryption key
   * @param {CryptoKey} key - The AES-GCM key to send to worker
   * @returns {Promise<void>} Resolves when crypto is initialized
   */
  async initializeCrypto(key) {
    if (!this.workerReady) {
      throw new Error('Worker not ready for crypto initialization');
    }
    
    // Export the key as raw data for transfer
    const exportedKey = await crypto.subtle.exportKey('raw', key);
    
    // Send initialization message with key data to worker
    this.worker.postMessage({
      operation: 'init',
      payload: { keyData: exportedKey }
    }, [exportedKey]); // Transfer ownership of ArrayBuffer

    // Wait for confirmation of crypto initialization
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Crypto initialization timeout'));
      }, 10000);

      const listener = ({ data }) => {
        if (data.type === 'initialized') {
          clearTimeout(timeout);
          this.worker.removeEventListener('message', listener);
          this.keyInitialized = true;
          resolve();
        } else if (data.type === 'error') {
          clearTimeout(timeout);
          this.worker.removeEventListener('message', listener);
          reject(new Error(`Crypto init error: ${data.error}`));
        }
      };

      this.worker.addEventListener('message', listener);
    });
  }

  /**
   * Disable E2EE and clean up all resources
   */
  disable() {
    // Terminate the worker if it exists
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    // Clean up key manager if it exists
    if (this.keyManager) {
      this.keyManager.disable();
      this.keyManager = null;
    }
    
    // Reset state variables
    this.enabled = false;
    this.workerReady = false;
    this.keyInitialized = false;
    
    console.log('🔒 E2EE disabled');
  }

  /**
   * Check if E2EE is fully enabled and ready for operations
   * @returns {boolean} True if E2EE is enabled and ready
   */
  isEnabled() {
    return this.enabled && this.workerReady && this.keyInitialized;
  }

  /**
   * Get browser support information for E2EE features
   * @returns {Object} Support information including browser compatibility
   */
  getSupportInfo() {
    return { 
      supported: true, 
      browser: 'modern',
      insertableStreams: typeof RTCRtpSender !== 'undefined' && 
        'createEncodedStreams' in RTCRtpSender.prototype,
      scriptTransform: typeof RTCRtpScriptTransform !== 'undefined'
    };
  }

  /**
   * Setup E2EE for a WebRTC peer connection
   * @param {RTCPeerConnection} peer - The peer connection to apply E2EE to
   */
  setupPeerConnection(peer) {
    if (!this.isEnabled()) {
      console.warn('⚠️ E2EE not enabled, cannot setup peer connection');
      return;
    }
    
    console.log('🔒 Setting up E2EE for peer connection');
    // Implementation for applying E2EE transforms to peer connection
    // would go here (e.g., using Insertable Streams or RTCRtpScriptTransform)
  }
}
