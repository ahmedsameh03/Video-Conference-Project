// js/e2ee-manager.js - E2EE System Manager with Timeout Fixes
class E2EEManager {
  constructor(options = {}) {
    this.config = {
      workerPath: '/js/e2ee-worker.js',
      initTimeout: 30000, // Increased timeout to 30 seconds
      ...options
    };
    
    this.worker = null;
    this.keyManager = null;
    this.enabled = false;
    this.workerReady = false;
    this.keyInitialized = false;
  }

  /**
   * Enable E2EE with password-based key derivation
   * @param {string} password - User password for key generation
   */
  async enable(password) {
    if (this.enabled) return;
    
    try {
      console.log('🔒 Enabling E2EE...');
      
      // Step 1: Create key manager and generate key
      this.keyManager = new E2EEKeyManager();
      const key = await this.keyManager.generateInitialKey(password);
      console.log('✅ Key generated');
      
      // Step 2: Initialize worker and wait until ready
      await this.initializeWorker();
      console.log('✅ Worker ready');
      
      // Step 3: Send key to worker and wait for confirmation
      await this.initializeCrypto(key);
      console.log('✅ Crypto initialized');
      
      this.enabled = true;
      console.log('✅ E2EE enabled successfully');
      
    } catch (error) {
      console.error('❌ E2EE enable failed:', error);
      this.disable();
      throw error;
    }
  }

  /**
   * Initialize Web Worker with proper error handling
   * @returns {Promise} Resolves when worker is ready
   */
  async initializeWorker() {
    return new Promise((resolve, reject) => {
      // Create worker with classic type
      this.worker = new Worker(this.config.workerPath, {
        type: 'classic',
        name: 'E2EEWorker'
      });

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Worker initialization timeout'));
        }
      }, this.config.initTimeout);

      // Handle worker messages
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

      // Handle worker runtime errors
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
   * Initialize crypto module in worker with key
   * @param {CryptoKey} key - The encryption key
   * @returns {Promise} Resolves when crypto is initialized
   */
  async initializeCrypto(key) {
    if (!this.workerReady) {
      throw new Error('Worker not ready for crypto initialization');
    }
    
    // Export key for transfer to worker
    const exportedKey = await crypto.subtle.exportKey('raw', key);
    
    // Send initialization message to worker
    this.worker.postMessage({
      operation: 'init',
      payload: { keyData: exportedKey }
    }, [exportedKey]); // Transfer ownership of ArrayBuffer

    // Wait for initialization confirmation
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
   * Disable E2EE and clean up resources
   */
  disable() {
    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    // Clean up key manager
    if (this.keyManager) {
      this.keyManager.disable();
      this.keyManager = null;
    }
    
    // Reset state
    this.enabled = false;
    this.workerReady = false;
    this.keyInitialized = false;
    
    console.log('🔒 E2EE disabled');
  }

  /**
   * Check if E2EE is fully enabled and ready
   * @returns {boolean} True if ready for encryption/decryption
   */
  isEnabled() {
    return this.enabled && this.workerReady && this.keyInitialized;
  }

  /**
   * Get browser support information for E2EE
   * @returns {Object} Support information
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
   * Setup E2EE for a peer connection
   * @param {RTCPeerConnection} peer - The peer connection
   */
  setupPeerConnection(peer) {
    if (!this.isEnabled()) {
      console.warn('⚠️ E2EE not enabled, cannot setup peer connection');
      return;
    }
    
    console.log('🔒 Setting up E2EE for peer connection');
    
    // Implementation would go here for applying transforms
    // to senders and receivers of the peer connection
  }
}
