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
   * @param {string} options.workerPath - Path to the E2EE worker script
   */
  constructor(options = {}) {
    this.options = {
      roomId: options.roomId || "",
      ratchetInterval: options.ratchetInterval || 60000, // 1 minute default
      // Ensure workerPath is provided or correctly defaulted
      workerPath: options.workerPath || new URL("e2ee-worker.js", document.currentScript?.src || window.location.href).href
    };
    
    this.keyManager = null;
    this.worker = null;
    this.enabled = false;
    this.senders = new Map();
    this.receivers = new Map();
    this.pendingFrames = new Map(); // Used for Chrome Insertable Streams
    this.browserSupport = this.detectBrowserSupport();
    this.workerReadyPromise = null; // Promise to track worker readiness
    this.workerInitializedPromise = null; // Promise to track key initialization
    
    // Bind methods
    this.enable = this.enable.bind(this);
    this.disable = this.disable.bind(this);
    this.setupSenderTransform = this.setupSenderTransform.bind(this);
    this.setupReceiverTransform = this.setupReceiverTransform.bind(this);
    this.setupWorker = this.setupWorker.bind(this);
    this.handleWorkerMessage = this.handleWorkerMessage.bind(this);
    
    console.log("🔒 E2EE Manager initialized");
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
      browser: "unknown"
    };
    
    // Detect browser
    const userAgent = navigator.userAgent;
    if (userAgent.includes("Chrome")) {
      support.browser = "chrome";
    } else if (userAgent.includes("Firefox")) {
      support.browser = "firefox";
    } else if (userAgent.includes("Safari") && !userAgent.includes("Chrome")) {
      support.browser = "safari";
    } else if (userAgent.includes("Edge")) {
      support.browser = "edge";
    }
    
    // Check for Insertable Streams API (Chrome)
    const hasCreateEncodedStreams = typeof RTCRtpSender !== "undefined" && 
      "createEncodedStreams" in RTCRtpSender.prototype;
    
    if (hasCreateEncodedStreams) {
      support.insertableStreams = true;
    }
    
    // Check for RTCRtpScriptTransform API (Firefox, Safari)
    const hasScriptTransform = typeof RTCRtpScriptTransform !== "undefined";
    
    if (hasScriptTransform) {
      support.scriptTransform = true;
    }
    
    // Overall support
    support.supported = support.insertableStreams || support.scriptTransform;
    
    return support;
  }
  
  /**
   * Set up the Web Worker for encryption/decryption
   * Returns a promise that resolves when the worker is ready (imported scripts)
   * @returns {Promise<void>}
   */
  setupWorker() {
    // If already setting up or ready, return the existing promise
    if (this.workerReadyPromise) {
      return this.workerReadyPromise;
    }

    this.workerReadyPromise = new Promise((resolve, reject) => {
      try {
        console.log(`Manager: Creating worker from path: ${this.options.workerPath}`);
        this.worker = new Worker(this.options.workerPath);
        console.log("Manager: Worker object created.");

        // Centralized message handler
        this.worker.onmessage = this.handleWorkerMessage;
        
        // Error handler
        this.worker.onerror = (error) => {
          console.error("❌ Manager: Worker error event:", error);
          // Ensure rejection propagates
          reject(new Error(`Worker error: ${error.message || 'Unknown worker error'}`)); 
          this.workerReadyPromise = null; // Reset promise on error
          this.workerInitializedPromise = null;
        };
        
        // Timeout for worker readiness (importScripts)
        // Increased timeout slightly, but focus on fixing the root cause
        const readyTimeout = setTimeout(() => {
          console.error("❌ Manager: Worker readiness timeout (waiting for worker_ready).");
          reject(new Error("Worker readiness timeout"));
          this.workerReadyPromise = null; // Reset promise on timeout
          this.workerInitializedPromise = null;
        }, 10000); // 10 seconds timeout

        // Store resolve/reject for worker_ready signal
        this._resolveWorkerReady = resolve;
        this._rejectWorkerReady = reject;
        this._clearReadyTimeout = () => clearTimeout(readyTimeout);

        // Also prepare promise for key initialization
        this.workerInitializedPromise = new Promise((resolveInit, rejectInit) => {
          this._resolveWorkerInitialized = resolveInit;
          this._rejectWorkerInitialized = rejectInit;
        });

      } catch (error) {
        console.error("❌ Manager: Error creating worker:", error);
        reject(error);
        this.workerReadyPromise = null; // Reset promise on creation error
        this.workerInitializedPromise = null;
      }
    });

    return this.workerReadyPromise;
  }
  
  /**
   * Handle messages from the worker
   * @param {MessageEvent} event - The message event
   */
  handleWorkerMessage(event) {
    const { type, frame, error, message, result } = event.data;
    
    console.log(`Manager: Received message from worker - Type: ${type}`);

    switch (type) {
      case "worker_ready":
        console.log("✅ Manager: Worker reported ready.");
        if (this._clearReadyTimeout) this._clearReadyTimeout();
        if (this._resolveWorkerReady) this._resolveWorkerReady();
        break;

      case "initialized":
        console.log("✅ Manager: Worker reported initialized (key likely set).");
        if (this._resolveWorkerInitialized) this._resolveWorkerInitialized();
        break;

      case "encrypted":
        // Forward encrypted frame (Chrome Insertable Streams)
        if (frame && frame.sender && this.pendingFrames.has(frame.sender)) {
          const controller = this.pendingFrames.get(frame.sender);
          controller.enqueue(frame);
          this.pendingFrames.delete(frame.sender);
        }
        break;
        
      case "decrypted":
        // Forward decrypted frame (Chrome Insertable Streams)
        if (frame && frame.receiver && this.pendingFrames.has(frame.receiver)) {
          const controller = this.pendingFrames.get(frame.receiver);
          controller.enqueue(frame);
          this.pendingFrames.delete(frame.receiver);
        }
        break;
        
      case "error":
        console.error(`❌ Manager: Received error from worker: ${error}`);
        // Reject initialization promise if error occurs during init
        if (this._rejectWorkerInitialized) {
           // Check if the error is related to init before rejecting
           // For now, reject on any error during the init phase
           // this._rejectWorkerInitialized(new Error(`Worker error: ${error}`));
        }
        // Handle pending frames if error occurred during encrypt/decrypt
        if (frame && frame.id && this.pendingFrames.has(frame.id)) {
          const controller = this.pendingFrames.get(frame.id);
          controller.enqueue(frame); // Forward original frame
          this.pendingFrames.delete(frame.id);
        }
        break;
        
      case "log":
        console.log(`👷 Worker Log: ${message}`);
        break;

      case "test-result":
        console.log("🧪 Worker Test Result:", result);
        break;
        
      default:
        console.log(`❓ Manager: Unknown message type from worker: ${type}`);
    }
  }
  
  /**
   * Enable end-to-end encryption
   * @param {string} password - The encryption password
   * @returns {Promise<void>}
   */
  async enable(password) {
    if (this.enabled) {
      console.log("🔒 E2EE already enabled");
      return;
    }
    
    if (!this.browserSupport.supported) {
      throw new Error(`E2EE not supported in this browser (${this.browserSupport.browser})`);
    }
    
    try {
      console.log("🔒 Manager: Enabling E2EE...");
      
      // Initialize key manager
      this.keyManager = new E2EEKeyManager({
        roomId: this.options.roomId,
        ratchetInterval: this.options.ratchetInterval
      });
      
      // Generate initial key
      const exportedKey = await this.keyManager.generateInitialKey(password);
      console.log("Manager: Initial key generated.");

      // Set up key ratcheting callback
      this.keyManager.onKeyRatchet = async (newKey) => {
        if (this.worker && this.enabled) { // Only send if worker exists and E2EE is enabled
          console.log("Manager: Key ratcheted. Sending new key to worker.");
          this.worker.postMessage({
            operation: "init", // Use 'init' to update/set key
            keyData: newKey
          });
          // Optional: Wait for worker confirmation ('initialized') after key update
        }
      };
      
      // Set up worker (returns promise that resolves on worker_ready)
      await this.setupWorker(); 
      console.log("Manager: Worker setup promise resolved (worker_ready received).");

      // Initialize worker with the first key AFTER worker is ready
      console.log("Manager: Sending initial key to worker...");
      this.worker.postMessage({
        operation: "init",
        keyData: exportedKey
      });

      // Wait for the worker to confirm key initialization
      console.log("Manager: Waiting for worker initialization confirmation (initialized message)...");
      await this.workerInitializedPromise; // Wait for the 'initialized' signal
      console.log("Manager: Worker initialization confirmed.");
      
      this.enabled = true;
      console.log("✅ Manager: E2EE enabled successfully");

    } catch (error) {
      console.error("❌ Manager: Error enabling E2EE:", error);
      // Clean up on failure
      this.disable(); 
      throw error; // Re-throw the error for the caller
    }
  }
  
  /**
   * Disable end-to-end encryption
   */
  disable() {
    if (!this.enabled && !this.worker) { // Check if already disabled or never enabled
      return;
    }
    
    console.log("🔓 Manager: Disabling E2EE...");
    
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
      console.log("Manager: Worker terminated.");
    }
    
    // Disable key manager
    if (this.keyManager) {
      this.keyManager.disable();
      this.keyManager = null;
      console.log("Manager: Key manager disabled.");
    }

    // Reset promises
    this.workerReadyPromise = null;
    this.workerInitializedPromise = null;
    
    this.enabled = false;
    console.log("✅ Manager: E2EE disabled");
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
    if (!this.enabled || !sender || this.senders.has(sender) || !sender.track) {
      return;
    }
    
    try {
      console.log(`🔒 Manager: Setting up sender transform for track kind: ${sender.track?.kind}`);
      
      if (this.browserSupport.insertableStreams && sender.createEncodedStreams) {
        // Chrome API
        this.setupSenderTransformChrome(sender);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== "undefined") {
        // Firefox/Safari API
        this.setupSenderTransformStandard(sender);
      } else {
        console.warn("⚠️ Manager: No supported E2EE API available for sender transform");
        return;
      }
      
      // Mark sender as transformed
      this.senders.set(sender, true);
    } catch (error) {
      console.error("❌ Manager: Error setting up sender transform:", error);
    }
  }
  
  /**
   * Set up transform for an RTCRtpReceiver
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   */
  setupReceiverTransform(receiver) {
    if (!this.enabled || !receiver || this.receivers.has(receiver) || !receiver.track) {
      return;
    }
    
    try {
      console.log(`🔒 Manager: Setting up receiver transform for track kind: ${receiver.track?.kind}`);
      
      if (this.browserSupport.insertableStreams && receiver.createEncodedStreams) {
        // Chrome API
        this.setupReceiverTransformChrome(receiver);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== "undefined") {
        // Firefox/Safari API
        this.setupReceiverTransformStandard(receiver);
      } else {
        console.warn("⚠️ Manager: No supported E2EE API available for receiver transform");
        return;
      }
      
      // Mark receiver as transformed
      this.receivers.set(receiver, true);
    } catch (error) {
      console.error("❌ Manager: Error setting up receiver transform:", error);
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
          // Add sender ID to track the frame for response matching
          const frameId = `sender-${Date.now()}-${Math.random()}`;
          encodedFrame.sender = frameId; // Used by worker message handler
          encodedFrame.id = frameId; // Used for error handling
          
          // Store controller for later use when worker responds
          this.pendingFrames.set(frameId, controller);
          
          // Send to worker for encryption, transferring buffer ownership
          this.worker.postMessage({
            operation: "encrypt",
            frame: encodedFrame
          }, [encodedFrame.data]);
        } catch (error) {
          console.error("❌ Manager: Error in sender transform:", error);
          // Ensure frame is still enqueued if postMessage fails
          if (this.pendingFrames.has(encodedFrame.id)) {
             this.pendingFrames.delete(encodedFrame.id);
          }
          controller.enqueue(encodedFrame);
        }
      }
    });
    
    // Connect the streams
    readable
      .pipeThrough(transformStream)
      .pipeTo(writable)
      .catch(error => {
        console.error("❌ Manager: Error in sender transform pipeline:", error);
      });
  }
  
  /**
   * Set up receiver transform using Chrome's Insertable Streams API
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   */
  setupReceiverTransformChrome(receiver) {
    const { readable, writable } = receiver.createEncodedStreams();
    
    co
(Content truncated due to size limit. Use line ranges to read in chunks)
