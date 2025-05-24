// js/e2ee-worker.js - Corrected Syntax
console.log('🔒 E2EE Worker Starting');

// Check worker context
if (typeof importScripts !== 'function') {
  self.postMessage({ 
    type: 'fatal_error', 
    error: 'NOT_IN_WORKER_CONTEXT' 
  });
} else {
  console.log('✅ Worker context confirmed');
}

// Variables
let cryptoModule = null;
let isReady = false;

// Safe import function
function loadCrypto() {
  const paths = [
    'e2ee-crypto.js',
    './e2ee-crypto.js', 
    '/js/e2ee-crypto.js'
  ];

  for (const path of paths) {
    try {
      console.log(`🔄 Importing: ${path}`);
      importScripts(path);
      
      if (typeof E2EECrypto !== 'undefined') {
        cryptoModule = new E2EECrypto();
        isReady = true;
        console.log(`✅ Crypto loaded from: ${path}`);
        self.postMessage({ type: 'worker_ready' });
        return;
      }
    } catch (error) {
      console.warn(`⚠️ Failed ${path}:`, error.message);
    }
  }
  
  self.postMessage({ 
    type: 'crypto_load_failed',
    error: 'Failed to load crypto module'
  });
}

// Load crypto on startup
loadCrypto();

// Message handler
self.onmessage = async function(event) {
  const { operation, payload } = event.data;
  
  try {
    if (!isReady || !cryptoModule) {
      throw new Error('Crypto module not ready');
    }

    switch (operation) {
      case 'init':
        if (payload && payload.keyData) {
          const key = await crypto.subtle.importKey(
            'raw',
            payload.keyData,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
          );
          cryptoModule.setKey(key);
          self.postMessage({ type: 'initialized' });
        }
        break;

      case 'encrypt':
        const encrypted = await cryptoModule.encryptFrame(payload.frame);
        self.postMessage({ 
          type: 'encrypted', 
          frame: encrypted 
        }, [encrypted.data]);
        break;

      case 'decrypt':
        const decrypted = await cryptoModule.decryptFrame(payload.frame);
        self.postMessage({ 
          type: 'decrypted', 
          frame: decrypted 
        }, [decrypted.data]);
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  } catch (error) {
    console.error(`❌ Worker error in ${operation}:`, error);
    self.postMessage({
      type: 'error',
      error: error.message,
      operation: operation
    });
  }
};

console.log('🔒 Worker script loaded');
