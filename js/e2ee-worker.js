/**
 * E2EE Worker - Web Worker for offloading encryption/decryption operations
 * 
 * This worker handles the CPU-intensive encryption and decryption operations
 * to prevent blocking the main thread in WebRTC applications.
 */


// Import required modules - use self.location to resolve relative paths
self.importScripts(new URL('e2ee-crypto.js', self.location.href).href);


// Initialize crypto module
let cryptoModule = null;

// Handle messages from main thread
self.onmessage = async function(event) {
  const { operation, frame, keyData, options } = event.data;
  
  try {
    // Initialize or update crypto module
    if (operation === 'init') {
      if (!cryptoModule) {
        cryptoModule = new E2EECrypto();
      }
      
      if (keyData) {
        // Import the key
        const key = await crypto.subtle.importKey(
          'raw',
          keyData,
          { name: 'AES-GCM' },
          false, // not extractable
          ['encrypt', 'decrypt']
        );
        
        // Set the key in the crypto module
        cryptoModule.setKey(key);
      }
      
      self.postMessage({ type: 'initialized' });
      return;
    }
    
    // Check if crypto module is initialized
    if (!cryptoModule || !cryptoModule.key) {
      throw new Error('Crypto module not initialized or no key set');
    }
    
    // Process frame based on operation
    let resultFrame;
    
    switch (operation) {
      case 'encrypt':
        resultFrame = await cryptoModule.encryptFrame(frame);
        self.postMessage({ 
          type: 'encrypted', 
          frame: resultFrame 
        }, [resultFrame.data]); // Transfer frame data to avoid copying
        break;
        
      case 'decrypt':
        resultFrame = await cryptoModule.decryptFrame(frame);
        self.postMessage({ 
          type: 'decrypted', 
          frame: resultFrame 
        }, [resultFrame.data]); // Transfer frame data to avoid copying
        break;
        
      case 'test':
        // Run a test encryption/decryption cycle
        const testResult = await cryptoModule.testEncryptionDecryption(frame.data);
        self.postMessage({ 
          type: 'test-result', 
          result: testResult 
        });
        break;
        
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  } catch (error) {
    // Send error back to main thread
    self.postMessage({ 
      type: 'error', 
      error: error.message,
      operation,
      frameInfo: frame ? {
        type: frame.type,
        codecs: frame.codecs,
        timestamp: frame.timestamp,
        sequenceNumber: frame.sequenceNumber
      } : null
    });
  }
};

// Log worker initialization
self.postMessage({ type: 'log', message: 'E2EE Worker initialized' });
