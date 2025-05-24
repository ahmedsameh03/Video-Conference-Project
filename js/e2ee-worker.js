// js/e2ee-worker.js - Final Solution for "Crypto module not ready" error
console.log('🔒 E2EE Worker Starting...');

// ===== Worker Variables =====
let cryptoModule = null;
let isReady = false;
let keySet = false;

// ===== Safe Crypto Module Loading Function =====
async function loadCryptoModule() {
  const paths = [
    'e2ee-crypto.js',                    // Same directory
    './e2ee-crypto.js',                  // Explicit same directory
    '/js/e2ee-crypto.js',                // Absolute path
    new URL('e2ee-crypto.js', self.location.href).href  // URL resolution
  ];

  console.log('🔄 Loading crypto module...');
  console.log('Worker location:', self.location.href);

  for (const path of paths) {
    try {
      console.log(`🔄 Trying: ${path}`);
      self.importScripts(path);
      
      // Check if crypto class is available
      if (typeof E2EECrypto !== 'undefined') {
        cryptoModule = new E2EECrypto();
        isReady = true;
        console.log(`✅ Crypto loaded from: ${path}`);
        
        // Send ready signal to main thread
        self.postMessage({ type: 'worker_ready' });
        return true;
      }
    } catch (error) {
      console.warn(`⚠️ Failed ${path}:`, error.message);
    }
  }
  
  console.error('❌ Failed to load crypto from all paths');
  self.postMessage({ 
    type: 'crypto_load_failed',
    error: 'Failed to load crypto module from all paths'
  });
  return false;
}

// ===== Load Crypto on Worker Startup =====
loadCryptoModule();

// ===== Enhanced Message Handler =====
self.onmessage = async function(event) {
  const { operation, payload } = event.data;
  
  console.log(`📨 Received: ${operation}, Ready: ${isReady}, KeySet: ${keySet}`);
  
  try {
    // Check crypto readiness first
    if (!isReady || !cryptoModule) {
      throw new Error('Crypto module not ready - module not loaded');
    }

    switch (operation) {
      case 'init':
        await handleInit(payload);
        break;
        
      case 'encrypt':
      case 'decrypt':
        // Check if key is set before operations
        if (!keySet) {
          throw new Error('Crypto module not ready - key not set');
        }
        
        if (operation === 'encrypt') {
          await handleEncrypt(payload);
        } else {
          await handleDecrypt(payload);
        }
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  } catch (error) {
    console.error(`❌ Error in ${operation}:`, error);
    self.postMessage({
      type: 'error',
      error: error.message,
      operation: operation
    });
  }
};

// ===== Operation Handler Functions =====
async function handleInit(payload) {
  console.log('🔑 Initializing key...');
  
  if (!payload || !payload.keyData) {
    throw new Error('No key data provided');
  }
  
  try {
    // Import the encryption key
    const key = await crypto.subtle.importKey(
      'raw',
      payload.keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    
    // Set key in crypto module
    await cryptoModule.setKey(key);
    keySet = true;
    
    console.log('✅ Key set successfully');
    self.postMessage({ type: 'initialized' });
    
  } catch (error) {
    keySet = false;
    throw new Error(`Key initialization failed: ${error.message}`);
  }
}

async function handleEncrypt(payload) {
  console.log('🔒 Encrypting frame...');
  
  const encrypted = await cryptoModule.encryptFrame(payload.frame);
  self.postMessage({
    type: 'encrypted',
    frame: encrypted
  }, [encrypted.data]);
  
  console.log('✅ Encryption complete');
}

async function handleDecrypt(payload) {
  console.log('🔓 Decrypting frame...');
  
  const decrypted = await cryptoModule.decryptFrame(payload.frame);
  self.postMessage({
    type: 'decrypted',
    frame: decrypted
  }, [decrypted.data]);
  
  console.log('✅ Decryption complete');
}

console.log('🔒 Worker script loaded and ready');
