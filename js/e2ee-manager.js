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
      workerPath: options.workerPath || "js/e2ee-worker.js"
    };
    
    this.keyManager = null;
    this.worker = null;
    this.isE2EEEnabled = false; // Is E2EE *intended* to be active?
    this.isWorkerScriptReady = false; // Has the worker script loaded?
    this.isWorkerKeyInitialized = false; // Has the worker received the key?
    this.senders = new Map();
    this.receivers = new Map();
    this.pendingFrames = new Map(); // Used for Chrome Insertable Streams
    this.browserSupport = this._detectBrowserSupport();
    this._workerReadyPromise = null; // Promise to track worker script loading
    this._workerInitializedPromise = null; // Promise to track key initialization in worker
    
    // Bind methods
    this._handleWorkerMessage = this._handleWorkerMessage.bind(this);
    
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
   * @private
   */
  _detectBrowserSupport() {
    const support = {
      insertableStreams: false,
      scriptTransform: false,
      supported: false,
      browser: "unknown"
    };
    
    // Detect browser
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("chrome")) {
      support.browser = "chrome";
    } else if (userAgent.includes("firefox")) {
      support.browser = "firefox";
    } else if (userAgent.includes("safari") && !userAgent.includes("chrome")) {
      support.browser = "safari";
    } else if (userAgent.includes("edge")) {
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
   * @private
   */
  _setupWorker() {
    // If already setting up or ready, return the existing promise
    if (this._workerReadyPromise) {
      return this._workerReadyPromise;
    }

    this._workerReadyPromise = new Promise((resolve, reject) => {
      try {
        console.log(`[E2EE Manager] Creating worker from path: ${this.options.workerPath}`);
        this.worker = new Worker(this.options.workerPath);
        console.log("[E2EE Manager] Worker object created.");

        // Centralized message handler
        this.worker.onmessage = this._handleWorkerMessage;
        
        // Error handler
        this.worker.onerror = (error) => {
          console.error("❌ [E2EE Manager] Worker error event:", error);
          reject(new Error(`Worker error: ${error.message || 'Unknown worker error'}`)); 
          this._workerReadyPromise = null; 
          this._workerInitializedPromise = null;
          this.isWorkerScriptReady = false;
          this.isWorkerKeyInitialized = false;
        };
        
        // Timeout for worker readiness (importScripts)
        const readyTimeout = setTimeout(() => {
          console.error("❌ [E2EE Manager] Worker readiness timeout (waiting for worker_ready).");
          reject(new Error("Worker readiness timeout"));
          this._workerReadyPromise = null; 
          this._workerInitializedPromise = null;
          this.isWorkerScriptReady = false;
          this.isWorkerKeyInitialized = false;
        }, 15000); // 15 seconds timeout

        // Store resolve/reject for worker_ready signal
        this._resolveWorkerReady = () => {
            console.log("[E2EE Manager] Worker reported ready, resolving workerReadyPromise.");
            this.isWorkerScriptReady = true;
            clearTimeout(readyTimeout);
            resolve();
        };
        this._rejectWorkerReady = (error) => {
            console.error("❌ [E2EE Manager] Worker ready promise rejected:", error);
            clearTimeout(readyTimeout);
            reject(error);
        };

        // Also prepare promise for key initialization
        this._workerInitializedPromise = new Promise((resolveInit, rejectInit) => {
          this._resolveWorkerInitialized = () => {
              console.log("[E2EE Manager] Worker reported initialized, resolving workerInitializedPromise.");
              this.isWorkerKeyInitialized = true;
              resolveInit();
          };
          this._rejectWorkerInitialized = (error) => {
              console.error("❌ [E2EE Manager] Worker initialization promise rejected:", error);
              rejectInit(error);
          };
        });

      } catch (error) {
        console.error("❌ [E2EE Manager] Error creating worker:", error);
        reject(error);
        this._workerReadyPromise = null; 
        this._workerInitializedPromise = null;
        this.isWorkerScriptReady = false;
        this.isWorkerKeyInitialized = false;
      }
    });

    return this._workerReadyPromise;
  }
  
  /**
   * Handle messages from the worker
   * @param {MessageEvent} event - The message event
   * @private
   */
  _handleWorkerMessage(event) {
    const { type, frame, error, message, result } = event.data;
    
    switch (type) {
      case "worker_ready":
        console.log("✅ [E2EE Manager] Worker reported ready (worker_ready message).");
        if (this._resolveWorkerReady) this._resolveWorkerReady();
        break;

      case "initialized":
        console.log("✅ [E2EE Manager] Worker reported initialized (initialized message).");
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
        console.error(`❌ [E2EE Manager] Received error from worker: ${error}`);
        // Reject initialization promise if error occurs during init
        if (!this.isWorkerKeyInitialized && this._rejectWorkerInitialized) {
           console.error("❌ [E2EE Manager] Worker error occurred during initialization phase.");
           // Don't reject here to allow retries
        }
        // Handle pending frames if error occurred during encrypt/decrypt
        if (frame && frame.id && this.pendingFrames.has(frame.id)) {
          console.warn(`[E2EE Manager] Worker error during frame processing (ID: ${frame.id}). Forwarding original frame.`);
          const controller = this.pendingFrames.get(frame.id);
          controller.enqueue(frame); // Forward original frame
          this.pendingFrames.delete(frame.id);
        }
        break;
        
      case "log":
        console.log(`[E2EE Worker Log] ${message}`);
        break;

      case "test-result":
        console.log("🧪 [E2EE Manager] Worker Test Result:", result);
        break;
        
      default:
        console.warn(`❓ [E2EE Manager] Unknown message type from worker: ${type}`);
    }
  }
  
  /**
   * Enable end-to-end encryption
   * @param {string} password - The encryption password
   * @returns {Promise<void>}
   */
  async enable(password) {
    if (this.isE2EEEnabled) {
      console.log("🔒 [E2EE Manager] E2EE already enabled");
      return;
    }
    
    if (!this.browserSupport.supported) {
      throw new Error(`E2EE not supported in this browser (${this.browserSupport.browser})`);
    }
    
    try {
      console.log("🔒 [E2EE Manager] Enabling E2EE...");
      
      // Initialize key manager
      console.log("[E2EE Manager] Initializing Key Manager...");
      this.keyManager = new E2EEKeyManager({
        roomId: this.options.roomId,
        ratchetInterval: this.options.ratchetInterval
      });
      
      // Set up worker (returns promise that resolves on worker_ready)
      console.log("[E2EE Manager] Setting up worker...");
      await this._setupWorker(); 
      console.log("✅ [E2EE Manager] Worker setup promise resolved (worker_ready received).");

      // Generate initial key
      console.log("[E2EE Manager] Generating initial key...");
      const exportedKey = await this.keyManager.generateInitialKey(password);
      console.log("[E2EE Manager] Initial key generated.");

      // Set up key ratcheting callback
      this.keyManager.onKeyRatchet = async (newKey) => {
        if (this.worker && this.isE2EEEnabled && this.isWorkerKeyInitialized) {
          console.log("[E2EE Manager] Key ratcheted. Sending new key to worker.");
          this.worker.postMessage({
            operation: "init", // Use 'init' to update/set key
            keyData: newKey
          });
        } else {
            console.warn("[E2EE Manager] Key ratcheted, but not sending to worker (not ready/enabled/initialized).");
        }
      };
      
      // Initialize worker with the first key AFTER worker is ready
      console.log("[E2EE Manager] Sending initial key to worker...");
      this.worker.postMessage({
        operation: "init",
        keyData: exportedKey
      });

      // Wait for the worker to confirm key initialization
      console.log("[E2EE Manager] Waiting for worker initialization confirmation...");
      await this._workerInitializedPromise; 
      console.log("✅ [E2EE Manager] Worker initialization confirmed.");
      
      // Set enabled flag ONLY after successful initialization
      this.isE2EEEnabled = true;
      console.log("✅ [E2EE Manager] E2EE enabled successfully.");

    } catch (error) {
      console.error("❌ [E2EE Manager] Error enabling E2EE:", error);
      // Clean up on failure
      await this.disable();
      throw error; // Re-throw the error for the caller
    }
  }
  
  /**
   * Disable end-to-end encryption
   */
  async disable() {
    if (!this.isE2EEEnabled && !this.worker && !this.keyManager) {
      console.log("🔓 [E2EE Manager] E2EE already disabled or not initialized.");
      return;
    }
    
    console.log("🔓 [E2EE Manager] Disabling E2EE...");
    this.isE2EEEnabled = false; // Set enabled to false immediately
    
    // Remove transforms from all senders and receivers
    console.log("[E2EE Manager] Removing transforms...");
    this.senders.forEach((transform, sender) => {
      this._removeSenderTransform(sender);
    });
    this.receivers.forEach((transform, receiver) => {
      this._removeReceiverTransform(receiver);
    });
    
    // Clear maps
    this.senders.clear();
    this.receivers.clear();
    this.pendingFrames.clear();
    console.log("[E2EE Manager] Maps cleared.");
    
    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      console.log("[E2EE Manager] Worker terminated.");
    }
    
    // Disable key manager
    if (this.keyManager) {
      this.keyManager.disable();
      this.keyManager = null;
      console.log("[E2EE Manager] Key manager disabled.");
    }

    // Reset promises and flags
    this._workerReadyPromise = null;
    this._workerInitializedPromise = null;
    this.isWorkerScriptReady = false;
    this.isWorkerKeyInitialized = false;
    
    console.log("✅ [E2EE Manager] E2EE disabled fully.");
  }
  
  /**
   * Check if E2EE is enabled AND ready for processing
   * @returns {boolean} - True if E2EE is enabled and worker is initialized
   */
  isReady() {
    return this.isE2EEEnabled && this.isWorkerScriptReady && this.isWorkerKeyInitialized;
  }
  
  /**
   * Set up transform for an RTCRtpSender
   * @param {RTCRtpSender} sender - The sender to transform
   */
  setupSenderTransform(sender) {
    // Check if E2EE is *intended* to be enabled, not necessarily fully ready yet
    if (!this.isE2EEEnabled || !sender || this.senders.has(sender) || !sender.track) {
      return;
    }
    
    try {
      console.log(`🔒 [E2EE Manager] Setting up sender transform for track kind: ${sender.track?.kind}`);
      
      if (this.browserSupport.insertableStreams && sender.createEncodedStreams) {
        // Chrome API
        this._setupSenderTransformChrome(sender);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== "undefined") {
        // Firefox/Safari API
        this._setupSenderTransformStandard(sender);
      } else {
        console.warn("⚠️ [E2EE Manager] No supported E2EE API available for sender transform");
        return;
      }
      
      // Mark sender as transformed
      this.senders.set(sender, true);
    } catch (error) {
      console.error("❌ [E2EE Manager] Error setting up sender transform:", error);
    }
  }
  
  /**
   * Set up transform for an RTCRtpReceiver
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   */
  setupReceiverTransform(receiver) {
    // Check if E2EE is *intended* to be enabled
    if (!this.isE2EEEnabled || !receiver || this.receivers.has(receiver) || !receiver.track) {
      return;
    }
    
    try {
      console.log(`🔒 [E2EE Manager] Setting up receiver transform for track kind: ${receiver.track?.kind}`);
      
      if (this.browserSupport.insertableStreams && receiver.createEncodedStreams) {
        // Chrome API
        this._setupReceiverTransformChrome(receiver);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== "undefined") {
        // Firefox/Safari API
        this._setupReceiverTransformStandard(receiver);
      } else {
        console.warn("⚠️ [E2EE Manager] No supported E2EE API available for receiver transform");
        return;
      }
      
      // Mark receiver as transformed
      this.receivers.set(receiver, true);
    } catch (error) {
      console.error("❌ [E2EE Manager] Error setting up receiver transform:", error);
    }
  }
  
  /**
   * Set up sender transform using Chrome's Insertable Streams API
   * @param {RTCRtpSender} sender - The sender to transform
   * @private
   */
  _setupSenderTransformChrome(sender) {
    console.log(`[E2EE Manager] Setting up Chrome sender transform for track ${sender?.track?.id}`);
    const { readable, writable } = sender.createEncodedStreams();
    
    const transformStream = new TransformStream({
      transform: async (encodedFrame, controller) => {
        // --- CRITICAL GUARD --- 
        // Only attempt encryption if E2EE is fully enabled AND worker is initialized
        if (!this.isReady()) {
          controller.enqueue(encodedFrame);
          return;
        }
        // --- END GUARD --- 
        
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
          console.error("❌ [E2EE Manager] Error in sender transform:", error);
          // Ensure frame is still enqueued if postMessage fails or worker error occurs
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
        console.error("❌ [E2EE Manager] Error in sender transform pipeline:", error);
      });
  }
  
  /**
   * Set up receiver transform using Chrome's Insertable Streams API
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   * @private
   */
  _setupReceiverTransformChrome(receiver) {
    console.log(`[E2EE Manager] Setting up Chrome receiver transform for track ${receiver?.track?.id}`);
    const { readable, writable } = receiver.createEncodedStreams();
    
    const transformStream = new TransformStream({
      transform: async (encodedFrame, controller) => {
         // --- CRITICAL GUARD --- 
        // Only attempt decryption if E2EE is fully enabled AND worker is initialized
        if (!this.isReady()) {
          controller.enqueue(encodedFrame);
          return;
        }
        // --- END GUARD --- 
        
        try {
          // Add receiver ID to track the frame
          const frameId = `receiver-${Date.now()}-${Math.random()}`;
          encodedFrame.receiver = frameId; // Used by worker message handler
          encodedFrame.id = frameId; // Used for error handling
          
          // Store controller for later use when worker responds
          this.pendingFrames.set(frameId, controller);
          
          // Send to worker for decryption, transferring buffer ownership
          this.worker.postMessage({
            operation: "decrypt",
            frame: encodedFrame
          }, [encodedFrame.data]);
        } catch (error) {
          console.error("❌ [E2EE Manager] Error in receiver transform:", error);
          // Ensure frame is still enqueued if postMessage fails or worker error occurs
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
        console.error("❌ [E2EE Manager] Error in receiver transform pipeline:", error);
      });
  }
  
  /**
   * Set up sender transform using standard RTCRtpScriptTransform API
   * @param {RTCRtpSender} sender - The sender to transform
   * @private
   */
  _setupSenderTransformStandard(sender) {
    console.log(`[E2EE Manager] Setting up standard sender transform for track ${sender?.track?.id}`);
    
    try {
      // Create a transform using the RTCRtpScriptTransform API
      const transform = new RTCRtpScriptTransform(this.worker, {
        operation: "encrypt",
        kind: sender.track.kind
      });
      
      // Apply the transform to the sender
      sender.transform = transform;
      
      console.log(`[E2EE Manager] Standard sender transform applied for track ${sender.track.id}`);
    } catch (error) {
      console.error("❌ [E2EE Manager] Error setting up standard sender transform:", error);
    }
  }
  
  /**
   * Set up receiver transform using standard RTCRtpScriptTransform API
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   * @private
   */
  _setupReceiverTransformStandard(receiver) {
    console.log(`[E2EE Manager] Setting up standard receiver transform for track ${receiver?.track?.id}`);
    
    try {
      // Create a transform using the RTCRtpScriptTransform API
      const transform = new RTCRtpScriptTransform(this.worker, {
        operation: "decrypt",
        kind: receiver.track.kind
      });
      
      // Apply the transform to the receiver
      receiver.transform = transform;
      
      console.log(`[E2EE Manager] Standard receiver transform applied for track ${receiver.track.id}`);
    } catch (error) {
      console.error("❌ [E2EE Manager] Error setting up standard receiver transform:", error);
    }
  }
  
  /**
   * Remove transform from a sender
   * @param {RTCRtpSender} sender - The sender to remove transform from
   * @private
   */
  _removeSenderTransform(sender) {
    if (!sender) return;
    
    try {
      if (this.browserSupport.scriptTransform && sender.transform) {
        sender.transform = null;
      }
      // For Chrome's Insertable Streams API, the transform is removed when the worker is terminated
      
      this.senders.delete(sender);
      console.log(`[E2EE Manager] Sender transform removed for track ${sender.track?.id}`);
    } catch (error) {
      console.error("❌ [E2EE Manager] Error removing sender transform:", error);
    }
  }
  
  /**
   * Remove transform from a receiver
   * @param {RTCRtpReceiver} receiver - The receiver to remove transform from
   * @private
   */
  _removeReceiverTransform(receiver) {
    if (!receiver) return;
    
    try {
      if (this.browserSupport.scriptTransform && receiver.transform) {
        receiver.transform = null;
      }
      // For Chrome's Insertable Streams API, the transform is removed when the worker is terminated
      
      this.receivers.delete(receiver);
      console.log(`[E2EE Manager] Receiver transform removed for track ${receiver.track?.id}`);
    } catch (error) {
      console.error("❌ [E2EE Manager] Error removing receiver transform:", error);
    }
  }
  
  /**
   * Apply E2EE transforms to all tracks in a peer connection
   * @param {RTCPeerConnection} peerConnection - The peer connection to apply transforms to
   */
  setupPeerConnection(peerConnection) {
    if (!peerConnection || !this.isE2EEEnabled) {
      return;
    }
    
    console.log("[E2EE Manager] Setting up peer connection for E2EE");
    
    // Apply transforms to all senders
    peerConnection.getSenders().forEach(sender => {
      if (sender.track) {
        this.setupSenderTransform(sender);
      }
    });
    
    // Apply transforms to all receivers
    peerConnection.getReceivers().forEach(receiver => {
      if (receiver.track) {
        this.setupReceiverTransform(receiver);
      }
    });
    
    // Set up event listeners for new tracks
    peerConnection.addEventListener("track", (event) => {
      console.log("[E2EE Manager] New track added to peer connection");
      
      // Apply transform to the receiver for the new track
      event.receiver && this.setupReceiverTransform(event.receiver);
    });
  }
}
