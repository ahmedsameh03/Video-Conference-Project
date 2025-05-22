/**
 * E2EEManager - WebRTC Integration Layer for End-to-End Encryption
 * 
 * This module integrates the key management, encryption, and worker thread
 * components with WebRTC's peer connections for end-to-end encrypted media.
 */
class E2EEManager {
  /**
   * Create a new E2EEManager instance
   * @param {Object} options - Configuration options
   * @param {string} options.roomId - The room ID for key derivation
   * @param {number} options.ratchetInterval - Interval in ms for key ratcheting
   */
  constructor(options = {}) {
    this.options = {
      roomId: options.roomId || '',
      ratchetInterval: options.ratchetInterval || 60000, // 1 minute default
      workerPath: options.workerPath || 'js/e2ee-worker.js'
    };
    
    this.keyManager = null;
    this.worker = null;
    this.enabled = false;
    this.senders = new Map();
    this.receivers = new Map();
    this.pendingFrames = new Map();
    this.browserSupport = this.detectBrowserSupport();
    
    // Bind methods
    this.enable = this.enable.bind(this);
    this.disable = this.disable.bind(this);
    this.setupSenderTransform = this.setupSenderTransform.bind(this);
    this.setupReceiverTransform = this.setupReceiverTransform.bind(this);
    this.setupWorker = this.setupWorker.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    
    console.log('🔒 E2EE Manager initialized');
    console.log(`🌐 Browser support: ${JSON.stringify(this.browserSupport)}`);
  }
  
  /**
   * Get browser support information
   * @returns {Object} - Object containing support information
   */
  getSupportInfo() {
    return this.browserSupport;
  }
  
  /**
   * Detect browser support for E2EE APIs
   * @returns {Object} - Object containing support information
   */
  detectBrowserSupport() {
    const support = {
      insertableStreams: false,
      scriptTransform: false,
      supported: false,
      browser: 'unknown'
    };
    
    // Detect browser
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Chrome')) {
      support.browser = 'chrome';
    } else if (userAgent.includes('Firefox')) {
      support.browser = 'firefox';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      support.browser = 'safari';
    } else if (userAgent.includes('Edge')) {
      support.browser = 'edge';
    }
    
    // Check for Insertable Streams API (Chrome)
    const hasCreateEncodedStreams = typeof RTCRtpSender !== 'undefined' && 
      'createEncodedStreams' in RTCRtpSender.prototype;
    
    if (hasCreateEncodedStreams) {
      support.insertableStreams = true;
    }
    
    // Check for RTCRtpScriptTransform API (Firefox, Safari)
    const hasScriptTransform = typeof RTCRtpScriptTransform !== 'undefined';
    
    if (hasScriptTransform) {
      support.scriptTransform = true;
    }
    
    // Overall support
    support.supported = support.insertableStreams || support.scriptTransform;
    
    return support;
  }
  
  /**
   * Set up the Web Worker for encryption/decryption
   * @returns {Promise<void>}
   */
  setupWorker() {
    return new Promise((resolve, reject) => {
      try {
        // Create worker
        this.worker = new Worker(this.options.workerPath);
        
        // Set up message handler
        this.worker.onmessage = this.handleWorkerMessage;
        
        // Set up error handler
        this.worker.onerror = (error) => {
          console.error('❌ Worker error:', error);
          reject(error);
        };
        
        // Wait for worker to initialize
        const initTimeout = setTimeout(() => {
          reject(new Error('Worker initialization timeout'));
        }, 5000);
        
        // One-time handler for initialization
        const originalHandler = this.worker.onmessage;
        this.worker.onmessage = (event) => {
          const { type } = event.data;
          
          if (type === 'initialized') {
            clearTimeout(initTimeout);
            this.worker.onmessage = originalHandler;
            resolve();
          } else {
            // Pass to original handler
            originalHandler(event);
          }
        };
        
        console.log('👷 Worker created');
      } catch (error) {
        console.error('❌ Error creating worker:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Handle messages from the worker
   * @param {MessageEvent} event - The message event
   */
  handleWorkerMessage(event) {
    const { type, frame, error } = event.data;
    
    switch (type) {
      case 'encrypted':
        // Forward encrypted frame to the appropriate sender
        if (frame && frame.sender && this.pendingFrames.has(frame.sender)) {
          const controller = this.pendingFrames.get(frame.sender);
          controller.enqueue(frame);
          this.pendingFrames.delete(frame.sender);
        }
        break;
        
      case 'decrypted':
        // Forward decrypted frame to the appropriate receiver
        if (frame && frame.receiver && this.pendingFrames.has(frame.receiver)) {
          const controller = this.pendingFrames.get(frame.receiver);
          controller.enqueue(frame);
          this.pendingFrames.delete(frame.receiver);
        }
        break;
        
      case 'error':
        console.error(`❌ Worker error: ${error}`);
        
        // If there's a pending frame associated with this error, forward the original frame
        if (frame && frame.id && this.pendingFrames.has(frame.id)) {
          const controller = this.pendingFrames.get(frame.id);
          controller.enqueue(frame);
          this.pendingFrames.delete(frame.id);
        }
        break;
        
      case 'log':
        console.log(`👷 Worker: ${event.data.message}`);
        break;
        
      default:
        console.log(`👷 Worker message: ${type}`);
    }
  }
  
  /**
   * Enable end-to-end encryption
   * @param {string} password - The encryption password
   * @returns {Promise<void>}
   */
  async enable(password) {
    if (this.enabled) {
      console.log('🔒 E2EE already enabled');
      return;
    }
    
    if (!this.browserSupport.supported) {
      throw new Error(`E2EE not supported in this browser (${this.browserSupport.browser})`);
    }
    
    try {
      console.log('🔒 Enabling E2EE...');
      
      // Initialize key manager
      this.keyManager = new E2EEKeyManager({
        roomId: this.options.roomId,
        ratchetInterval: this.options.ratchetInterval
      });
      
      // Generate initial key
      const exportedKey = await this.keyManager.generateInitialKey(password);
      
      // Set up key ratcheting callback
      this.keyManager.onKeyRatchet = async (newKey) => {
        if (this.worker) {
          this.worker.postMessage({
            operation: 'init',
            keyData: newKey
          });
        }
      };
      
      // Set up worker
      await this.setupWorker();
      
      // Initialize worker with key
      this.worker.postMessage({
        operation: 'init',
        keyData: exportedKey
      });
      
      this.enabled = true;
      console.log('✅ E2EE enabled successfully');
    } catch (error) {
      console.error('❌ Error enabling E2EE:', error);
      this.disable();
      throw error;
    }
  }
  
  /**
   * Disable end-to-end encryption
   */
  disable() {
    if (!this.enabled) {
      return;
    }
    
    console.log('🔓 Disabling E2EE...');
    
    // Remove transforms from all senders and receivers
    this.senders.forEach((transform, sender) => {
      this.removeSenderTransform(sender);
    });
    
    this.receivers.forEach((transform, receiver) => {
      this.removeReceiverTransform(receiver);
    });
    
    // Clear maps
    this.senders.clear();
    this.receivers.clear();
    this.pendingFrames.clear();
    
    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    // Disable key manager
    if (this.keyManager) {
      this.keyManager.disable();
      this.keyManager = null;
    }
    
    this.enabled = false;
    console.log('✅ E2EE disabled');
  }
  
  /**
   * Check if E2EE is enabled
   * @returns {boolean} - True if E2EE is enabled
   */
  isEnabled() {
    return this.enabled;
  }
  
  /**
   * Set up transform for an RTCRtpSender
   * @param {RTCRtpSender} sender - The sender to transform
   */
  setupSenderTransform(sender) {
    if (!this.enabled || !sender || this.senders.has(sender)) {
      return;
    }
    
    try {
      console.log(`🔒 Setting up sender transform for track kind: ${sender.track?.kind}`);
      
      if (this.browserSupport.insertableStreams && sender.createEncodedStreams) {
        // Chrome API
        this.setupSenderTransformChrome(sender);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== 'undefined') {
        // Firefox/Safari API
        this.setupSenderTransformStandard(sender);
      } else {
        console.warn('⚠️ No supported E2EE API available for this browser');
        return;
      }
      
      // Mark sender as transformed
      this.senders.set(sender, true);
    } catch (error) {
      console.error('❌ Error setting up sender transform:', error);
    }
  }
  
  /**
   * Set up transform for an RTCRtpReceiver
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   */
  setupReceiverTransform(receiver) {
    if (!this.enabled || !receiver || this.receivers.has(receiver)) {
      return;
    }
    
    try {
      console.log(`🔒 Setting up receiver transform for track kind: ${receiver.track?.kind}`);
      
      if (this.browserSupport.insertableStreams && receiver.createEncodedStreams) {
        // Chrome API
        this.setupReceiverTransformChrome(receiver);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== 'undefined') {
        // Firefox/Safari API
        this.setupReceiverTransformStandard(receiver);
      } else {
        console.warn('⚠️ No supported E2EE API available for this browser');
        return;
      }
      
      // Mark receiver as transformed
      this.receivers.set(receiver, true);
    } catch (error) {
      console.error('❌ Error setting up receiver transform:', error);
    }
  }
  
  /**
   * Set up sender transform using Chrome's Insertable Streams API
   * @param {RTCRtpSender} sender - The sender to transform
   */
  setupSenderTransformChrome(sender) {
    const { readable, writable } = sender.createEncodedStreams();
    
    const transformStream = new TransformStream({
      transform: async (encodedFrame, controller) => {
        if (!this.enabled || !this.worker) {
          controller.enqueue(encodedFrame);
          return;
        }
        
        try {
          // Add sender ID to track the frame
          const frameId = `sender-${Date.now()}-${Math.random()}`;
          encodedFrame.sender = frameId;
          
          // Store controller for later use
          this.pendingFrames.set(frameId, controller);
          
          // Send to worker for encryption
          this.worker.postMessage({
            operation: 'encrypt',
            frame: encodedFrame
          }, [encodedFrame.data]);
        } catch (error) {
          console.error('❌ Error in sender transform:', error);
          controller.enqueue(encodedFrame);
        }
      }
    });
    
    // Connect the streams
    readable
      .pipeThrough(transformStream)
      .pipeTo(writable)
      .catch(error => {
        console.error('❌ Error in sender transform pipeline:', error);
      });
  }
  
  /**
   * Set up receiver transform using Chrome's Insertable Streams API
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   */
  setupReceiverTransformChrome(receiver) {
    const { readable, writable } = receiver.createEncodedStreams();
    
    const transformStream = new TransformStream({
      transform: async (encodedFrame, controller) => {
        if (!this.enabled || !this.worker) {
          controller.enqueue(encodedFrame);
          return;
        }
        
        try {
          // Add receiver ID to track the frame
          const frameId = `receiver-${Date.now()}-${Math.random()}`;
          encodedFrame.receiver = frameId;
          
          // Store controller for later use
          this.pendingFrames.set(frameId, controller);
          
          // Send to worker for decryption
          this.worker.postMessage({
            operation: 'decrypt',
            frame: encodedFrame
          }, [encodedFrame.data]);
        } catch (error) {
          console.error('❌ Error in receiver transform:', error);
          controller.enqueue(encodedFrame);
        }
      }
    });
    
    // Connect the streams
    readable
      .pipeThrough(transformStream)
      .pipeTo(writable)
      .catch(error => {
        console.error('❌ Error in receiver transform pipeline:', error);
      });
  }
  
  /**
   * Set up sender transform using standard RTCRtpScriptTransform API
   * @param {RTCRtpSender} sender - The sender to transform
   */
  setupSenderTransformStandard(sender) {
    try {
      // Create a transform with our worker
      const transform = new RTCRtpScriptTransform(this.worker, {
        operation: 'encrypt',
        kind: 'sender'
      });
      
      // Apply transform to sender
      sender.transform = transform;
    } catch (error) {
      console.error('❌ Error setting up standard sender transform:', error);
    }
  }
  
  /**
   * Set up receiver transform using standard RTCRtpScriptTransform API
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   */
  setupReceiverTransformStandard(receiver) {
    try {
      // Create a transform with our worker
      const transform = new RTCRtpScriptTransform(this.worker, {
        operation: 'decrypt',
        kind: 'receiver'
      });
      
      // Apply transform to receiver
      receiver.transform = transform;
    } catch (error) {
      console.error('❌ Error setting up standard receiver transform:', error);
    }
  }
  
  /**
   * Remove transform from a sender
   * @param {RTCRtpSender} sender - The sender to remove transform from
   */
  removeSenderTransform(sender) {
    if (!sender) return;
    
    try {
      if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== 'undefined') {
        // Firefox/Safari API
        sender.transform = null;
      }
      
      // Remove from map
      this.senders.delete(sender);
    } catch (error) {
      console.error('❌ Error removing sender transform:', error);
    }
  }
  
  /**
   * Remove transform from a receiver
   * @param {RTCRtpReceiver} receiver - The receiver to remove transform from
   */
  removeReceiverTransform(receiver) {
    if (!receiver) return;
    
    try {
      if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== 'undefined') {
        // Firefox/Safari API
        receiver.transform = null;
      }
      
      // Remove from map
      this.receivers.delete(receiver);
    } catch (error) {
      console.error('❌ Error removing receiver transform:', error);
    }
  }
  
  /**
   * Apply transforms to all senders and receivers in a peer connection
   * @param {RTCPeerConnection} peerConnection - The peer connection
   */
  setupPeerConnection(peerConnection) {
    if (!this.enabled || !peerConnection) {
      return;
    }
    
    try {
      // Set up existing senders
      peerConnection.getSenders().forEach(sender => {
        this.setupSenderTransform(sender);
      });
      
      // Set up existing receivers
      peerConnection.getReceivers().forEach(receiver => {
        this.setupReceiverTransform(receiver);
      });
      
      // Set up handlers for new senders/receivers
      peerConnection.addEventListener('track', (event) => {
        if (event.track && event.receiver) {
          this.setupReceiverTransform(event.receiver);
        }
      });
      
      // Monitor for new senders
      const originalAddTrack = peerConnection.addTrack;
      peerConnection.addTrack = function(...args) {
        const sender = originalAddTrack.apply(this, args);
        this.setupSenderTransform(sender);
        return sender;
      }.bind(peerConnection, this);
    } catch (error) {
      console.error('❌ Error setting up peer connection:', error);
    }
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = E2EEManager;
}
