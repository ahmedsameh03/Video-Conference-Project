// js/e2ee-worker.js - Web Worker for E2EE Encryption/Decryption Operations
console.log('🔒 E2EE Worker Starting...');

// ===== Worker State Variables =====
let cryptoModule = null; // Holds the crypto module instance
let isReady = false;     // Tracks if crypto module is loaded
let keySet = false;      // Tracks if encryption key is set

// ===== Function to Load Crypto Module Safely =====
function loadCryptoModule() {
  // List of possible paths to load the crypto module
  const paths = [
    'e2ee-crypto.js',                    // Same directory
    './e2ee-crypto.js',                  // Explicit same directory
    '/js/e2ee-crypto.js',                // Absolute path
    new URL('e2ee-crypto.js', self.location.href).href // URL resolution
  ];

  console.log('🔄 Loading crypto module...');
  console.log('Worker location:', self.location.href);

  // Try each path until successful
  for (const path of paths) {
    try {
      console.log(`🔄 Trying path: ${path}`);
      self.importScripts(path);
      
      // Check if the E2EECrypto class is now available
      if (typeof E2EECrypto !== 'undefined') {
        cryptoModule = new E2EECrypto();
        isReady = true;
        console.log(`✅ Crypto module loaded from: ${path}`);
        
        // Notify main thread that worker is ready
        self.postMessage({ type: 'worker_ready' });
        return true;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load from ${path}:`, error.message);
    }
  }
  
  // If all paths fail, notify main thread of failure
  console.error('❌ Failed to load crypto module from all paths');
  self.postMessage({ 
    type: 'crypto_load_failed',
    error: 'Failed to load crypto module from all paths'
  });
  return false;
}

// ===== Load Crypto Module on Worker Startup =====
loadCryptoModule();

// ===== Message Handler for Worker Operations =====
self.onmessage = async function(event) {
  const { operation, payload } = event.data;
  
  console.log(`📨 Received operation: ${operation}, Ready: ${isReady}, KeySet: ${keySet}`);
  
  try {
    // Ensure crypto module is loaded before processing any operation
    if (!isReady || !cryptoModule) {
      throw new Error('Crypto module not ready - module not loaded');
    }

    switch (operation) {
      case 'init':
        await handleInit(payload);
        break;
        
      case 'encrypt':
      case 'decrypt':
        // Ensure key is set before encryption/decryption operations
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
  console.log('🔑 Initializing encryption key...');
  
  if (!payload || !payload.keyData) {
    throw new Error('No key data provided for initialization');
  }
  
  try {
    // Import the key data as a CryptoKey for AES-GCM
    const key = await crypto.subtle.importKey(
      'raw',
      payload.keyData,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    
    // Set the key in the crypto module
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
  }, [encrypted.data]); // Transfer ArrayBuffer to main thread
  
  console.log('✅ Encryption complete');
}

async function handleDecrypt(payload) {
  console.log('🔓 Decrypting frame...');
  
  const decrypted = await cryptoModule.decryptFrame(payload.frame);
  self.postMessage({
    type: 'decrypted',
    frame: decrypted
  }, [decrypted.data]); // Transfer ArrayBuffer to main thread
  
  console.log('✅ Decryption complete');
}

console.log('🔒 Worker script loaded and ready for messages');
