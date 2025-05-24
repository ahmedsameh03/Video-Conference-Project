// js/e2ee-manager.js - Fixed Timeout Issues
class E2EEManager {
  constructor(options = {}) {
    this.config = {
      workerPath: '/js/e2ee-worker.js',
      initTimeout: 20000, // Increased timeout
      ...options
    };
    
    this.worker = null;
    this.keyManager = null;
    this.enabled = false;
    this.retryCount = 0;
  }

  async enable(password) {
    if (this.enabled) return;
    
    try {
      console.log('🔒 Enabling E2EE...');
      
      // Create key manager
      this.keyManager = new E2EEKeyManager();
      const key = await this.keyManager.generateInitialKey(password);
      
      // Initialize worker with retry
      await this.initializeWorkerWithRetry();
      
      // Send key to worker
      await this.initializeCrypto(key);
      
      this.enabled = true;
      console.log('✅ E2EE enabled successfully');
      
    } catch (error) {
      console.error('❌ E2EE enable failed:', error);
      this.disable();
      throw error;
    }
  }

  async initializeWorkerWithRetry() {
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Worker init attempt ${attempt}/${maxRetries}`);
        await this.initializeWorker();
        return;
      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
        if (attempt === maxRetries) {
          throw new Error(`Worker failed after ${maxRetries} attempts`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async initializeWorker() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.config.workerPath, {
          type: 'classic',
          name: 'E2EEWorker'
        });
      } catch (error) {
        reject(new Error(`Worker creation failed: ${error.message}`));
        return;
      }

      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Worker initialization timeout'));
        }
      }, this.config.initTimeout);

      this.worker.onmessage = ({ data }) => {
        if (data.type === 'worker_ready' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('✅ Worker ready');
          resolve();
        } else if (data.type === 'fatal_error' || data.type === 'crypto_load_failed') {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(new Error(`Worker error: ${data.error}`));
          }
        }
      };

      this.worker.onerror = (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Worker runtime error: ${error.message}`));
        }
      };
    });
  }

  async initializeCrypto(key) {
    const exportedKey = await crypto.subtle.exportKey('raw', key);
    
    this.worker.postMessage({
      operation: 'init',
      payload: { keyData: exportedKey }
    }, [exportedKey]);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Crypto initialization timeout'));
      }, 10000);

      const listener = ({ data }) => {
        if (data.type === 'initialized') {
          clearTimeout(timeout);
          this.worker.removeEventListener('message', listener);
          resolve();
        } else if (data.type === 'error') {
          clearTimeout(timeout);
          this.worker.removeEventListener('message', listener);
          reject(new Error(data.error));
        }
      };

      this.worker.addEventListener('message', listener);
    });
  }

  disable() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.keyManager) {
      this.keyManager.disable();
      this.keyManager = null;
    }
    this.enabled = false;
    console.log('🔒 E2EE disabled');
  }

  isEnabled() {
    return this.enabled;
  }

  getSupportInfo() {
    return { supported: true, browser: 'modern' };
  }

  setupPeerConnection(peer) {
    console.log('🔒 Setting up E2EE for peer');
    // Implementation for peer connection setup
  }
}
