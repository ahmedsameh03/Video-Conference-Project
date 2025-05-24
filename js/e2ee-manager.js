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
    this.enabled = false; // Is E2EE *intended* to be active?
    this.workerReady = false; // Has the worker script loaded?
    this.workerInitialized = false; // Has the worker received the key?
    this.senders = new Map();
    this.receivers = new Map();
    this.pendingFrames = new Map(); // Used for Chrome Insertable Streams
    this.browserSupport = this.detectBrowserSupport();
    this.workerReadyPromise = null; // Promise to track worker script loading
    this.workerInitializedPromise = null; // Promise to track key initialization in worker
    
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
        console.log(`[E2EE Manager] Creating worker from path: ${this.options.workerPath}`);
        this.worker = new Worker(this.options.workerPath);
        console.log("[E2EE Manager] Worker object created.");

        // Centralized message handler
        this.worker.onmessage = this.handleWorkerMessage;
        
        // Error handler
        this.worker.onerror = (error) => {
          console.error("❌ [E2EE Manager] Worker error event:", error);
          reject(new Error(`Worker error: ${error.message || 'Unknown worker error'}`)); 
          this.workerReadyPromise = null; 
          this.workerInitializedPromise = null;
          this.workerReady = false;
          this.workerInitialized = false;
        };
        
        // Timeout for worker readiness (importScripts)
        const readyTimeout = setTimeout(() => {
          console.error("❌ [E2EE Manager] Worker readiness timeout (waiting for worker_ready).");
          reject(new Error("Worker readiness timeout"));
          this.workerReadyPromise = null; 
          this.workerInitializedPromise = null;
          this.workerReady = false;
          this.workerInitialized = false;
        }, 15000); // 15 seconds timeout

        // Store resolve/reject for worker_ready signal
        this._resolveWorkerReady = () => {
            console.log("[E2EE Manager] Worker reported ready, resolving workerReadyPromise.");
            this.workerReady = true;
            resolve();
        };
        this._rejectWorkerReady = reject;
        this._clearReadyTimeout = () => clearTimeout(readyTimeout);

        // Also prepare promise for key initialization
        this.workerInitializedPromise = new Promise((resolveInit, rejectInit) => {
          this._resolveWorkerInitialized = () => {
              console.log("[E2EE Manager] Worker reported initialized, resolving workerInitializedPromise.");
              this.workerInitialized = true;
              resolveInit();
          };
          this._rejectWorkerInitialized = rejectInit;
        });

      } catch (error) {
        console.error("❌ [E2EE Manager] Error creating worker:", error);
        reject(error);
        this.workerReadyPromise = null; 
        this.workerInitializedPromise = null;
        this.workerReady = false;
        this.workerInitialized = false;
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
    
    // console.log(`[E2EE Manager] Received message from worker - Type: ${type}`); // Reduce noise

    switch (type) {
      case "worker_ready":
        console.log("✅ [E2EE Manager] Worker reported ready (worker_ready message).");
        if (this._clearReadyTimeout) this._clearReadyTimeout();
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
        if (!this.workerInitialized && this._rejectWorkerInitialized) {
           console.error("❌ [E2EE Manager] Worker error occurred during initialization phase.");
           // this._rejectWorkerInitialized(new Error(`Worker error: ${error}`));
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
    if (this.enabled) {
      console.log("🔒 [E2EE Manager] E2EE already enabled");
      return;
    }
    
    if (!this.browserSupport.supported) {
      throw new Error(`E2EE not supported in this browser (${this.browserSupport.browser})`);
    }
    
    // Reset state flags before enabling
    this.enabled = false;
    this.workerReady = false;
    this.workerInitialized = false;

    try {
      console.log("🔒 [E2EE Manager] Enabling E2EE...");
      
      // Initialize key manager
      console.log("[E2EE Manager] Initializing Key Manager...");
      this.keyManager = new E2EEKeyManager({
        roomId: this.options.roomId,
        ratchetInterval: this.options.ratchetInterval
      });
      
      // Generate initial key
      console.log("[E2EE Manager] Generating initial key...");
      const exportedKey = await this.keyManager.generateInitialKey(password);
      console.log("[E2EE Manager] Initial key generated.");

      // Set up key ratcheting callback
      this.keyManager.onKeyRatchet = async (newKey) => {
        if (this.worker && this.enabled && this.workerInitialized) { // Only send if worker exists, E2EE enabled, AND worker is initialized
          console.log("[E2EE Manager] Key ratcheted. Sending new key to worker.");
          this.worker.postMessage({
            operation: "init", // Use 'init' to update/set key
            keyData: newKey
          });
        } else {
            console.warn("[E2EE Manager] Key ratcheted, but not sending to worker (not ready/enabled/initialized).");
        }
      };
      
      // Set up worker (returns promise that resolves on worker_ready)
      console.log("[E2EE Manager] Setting up worker...");
      await this.setupWorker(); 
      console.log("✅ [E2EE Manager] Worker setup promise resolved (worker_ready received). State: workerReady=", this.workerReady);

      // Initialize worker with the first key AFTER worker is ready
      console.log("[E2EE Manager] Sending initial key to worker...");
      this.worker.postMessage({
        operation: "init",
        keyData: exportedKey
      });

      // Wait for the worker to confirm key initialization
      console.log("[E2EE Manager] Waiting for worker initialization confirmation (initialized message)...");
      await this.workerInitializedPromise; // Wait for the 'initialized' signal
      console.log("✅ [E2EE Manager] Worker initialization confirmed. State: workerInitialized=", this.workerInitialized);
      
      // --- CRITICAL: Set enabled flag ONLY after successful initialization --- 
      this.enabled = true;
      console.log("✅ [E2EE Manager] E2EE enabled successfully. State: enabled=", this.enabled);

    } catch (error) {
      console.error("❌ [E2EE Manager] Error enabling E2EE:", error);
      // Clean up on failure
      await this.disable(); // Ensure disable runs fully
      throw error; // Re-throw the error for the caller
    }
  }
  
  /**
   * Disable end-to-end encryption
   */
  async disable() { // Make disable async if needed for cleanup
    if (!this.enabled && !this.worker && !this.keyManager) { // Check if already fully disabled
      console.log("🔓 [E2EE Manager] E2EE already disabled or not initialized.");
      return;
    }
    
    console.log("🔓 [E2EE Manager] Disabling E2EE...");
    this.enabled = false; // Set enabled to false immediately
    
    // Remove transforms from all senders and receivers
    console.log("[E2EE Manager] Removing transforms...");
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
    this.workerReadyPromise = null;
    this.workerInitializedPromise = null;
    this.workerReady = false;
    this.workerInitialized = false;
    
    console.log("✅ [E2EE Manager] E2EE disabled fully.");
  }
  
  /**
   * Check if E2EE is enabled AND ready for processing
   * @returns {boolean} - True if E2EE is enabled and worker is initialized
   */
  isReady() {
    return this.enabled && this.workerReady && this.workerInitialized;
  }
  
  /**
   * Set up transform for an RTCRtpSender
   * @param {RTCRtpSender} sender - The sender to transform
   */
  setupSenderTransform(sender) {
    // Check if E2EE is *intended* to be enabled, not necessarily fully ready yet
    if (!this.enabled || !sender || this.senders.has(sender) || !sender.track) {
      console.log(`[E2EE Manager] Skipping sender transform setup for track ${sender?.track?.id} (enabled: ${this.enabled}, sender exists: ${!!sender}, already transformed: ${this.senders.has(sender)}, track exists: ${!!sender?.track})`);
      return;
    }
    
    try {
      console.log(`🔒 [E2EE Manager] Setting up sender transform for track kind: ${sender.track?.kind}`);
      
      if (this.browserSupport.insertableStreams && sender.createEncodedStreams) {
        // Chrome API
        this.setupSenderTransformChrome(sender);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== "undefined") {
        // Firefox/Safari API
        this.setupSenderTransformStandard(sender);
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
    if (!this.enabled || !receiver || this.receivers.has(receiver) || !receiver.track) {
       console.log(`[E2EE Manager] Skipping receiver transform setup for track ${receiver?.track?.id} (enabled: ${this.enabled}, receiver exists: ${!!receiver}, already transformed: ${this.receivers.has(receiver)}, track exists: ${!!receiver?.track})`);
      return;
    }
    
    try {
      console.log(`🔒 [E2EE Manager] Setting up receiver transform for track kind: ${receiver.track?.kind}`);
      
      if (this.browserSupport.insertableStreams && receiver.createEncodedStreams) {
        // Chrome API
        this.setupReceiverTransformChrome(receiver);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== "undefined") {
        // Firefox/Safari API
        this.setupReceiverTransformStandard(receiver);
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
   */
  setupSenderTransformChrome(sender) {
    console.log(`[E2EE Manager] Setting up Chrome sender transform for track ${sender?.track?.id}`);
    const { readable, writable } = sender.createEncodedStreams();
    
    const transformStream = new TransformStream({
      transform: async (encodedFrame, controller) => {
        // --- CRITICAL GUARD --- 
        // Only attempt encryption if E2EE is fully enabled AND worker is initialized
        if (!this.isReady()) {
          // console.log("[Sender Transform] E2EE not ready, passing frame through unencrypted."); // Reduce noise
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
   */
  setupReceiverTransformChrome(receiver) {
    console.log(`[E2EE Manager] Setting up Chrome receiver transform for track ${receiver?.track?.id}`);
    const { readable, writable } = receiver.createEncodedStreams();
    
    const transformStream = new TransformStream({
      transform: async (encodedFrame, controller) => {
         // --- CRITICAL GUARD --- 
        // Only attempt decryption if E2EE is fully enabled AND worker is initialized
        if (!this.isReady()) {
          // console.log("[Receiver Transform] E2EE not ready, passing frame through undecrypted."); // Reduce noise
          controller.enqueue(encodedFrame);
          return;
        }
        // --- END GUARD --- 
        
        try {
          // Add receiver ID to track the frame
          const frameId = `receiver-${Date.now()}-${Math.random()}`;
          encodedFrame.receiver = frameId; // Used by worker message handler
          encodedFrame.id = frameId; // Used for error handling

          // Store controller for later use
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
   * (Used by Firefox/Safari)
   * @param {RTCRtpSender} sender - The sender to transform
   */
  setupSenderTransformStandard(sender) {
    console.log(`[E2EE Manager] Setting up Standard sender transform for track ${sender?.track?.id}`);
    if (!this.worker) {
        console.error("❌ [E2EE Manager] Cannot setup standard transform, worker not available.");
        return;
    }
    try {
      // Create a transform linked to our worker
      // Note: Standard API doesn't have the same fine-grained readiness check as Insertable Streams
      // The worker itself needs to handle cases where it receives frames before being ready.
      const transform = new RTCRtpScriptTransform(this.worker, {
        operation: "encrypt", // Pass operation type
        kind: "sender"
      });
      
      // Apply transform to sender
      sender.transform = transform;
      console.log("✅ [E2EE Manager] Standard sender transform applied.");
    } catch (error) {
      console.error("❌ [E2EE Manager] Error setting up standard sender transform:", error);
    }
  }
  
  /**
   * Set up receiver transform using standard RTCRtpScriptTransform API
   * (Used by Firefox/Safari)
   * @param {RTCRtpReceiver} receiver - The receiver to transform
   */
  setupReceiverTransformStandard(receiver) {
     console.log(`[E2EE Manager] Setting up Standard receiver transform for track ${receiver?.track?.id}`);
     if (!this.worker) {
        console.error("❌ [E2EE Manager] Cannot setup standard transform, worker not available.");
        return;
    }
    try {
      // Create a transform linked to our worker
      const transform = new RTCRtpScriptTransform(this.worker, {
        operation: "decrypt", // Pass operation type
        kind: "receiver"
      });
      
      // Apply transform to receiver
      receiver.transform = transform;
      console.log("✅ [E2EE Manager] Standard receiver transform applied.");
    } catch (error) {
      console.error("❌ [E2EE Manager] Error setting up standard receiver transform:", error);
    }
  }
  
  /**
   * Remove transform from a sender
   * @param {RTCRtpSender} sender - The sender to remove transform from
   */
  removeSenderTransform(sender) {
    if (!sender) return;
    console.log(`[E2EE Manager] Removing sender transform for track ${sender?.track?.id}`);
    try {
      // For standard API, set transform to null
      if (this.browserSupport.scriptTransform && sender.transform) {
        sender.transform = null;
        console.log("[E2EE Manager] Standard sender transform removed.");
      }
      // For Chrome API, the pipeline disconnects automatically when disabling/closing, 
      // but explicitly removing helps ensure cleanup.
      if (this.browserSupport.insertableStreams && sender.transport && sender.transport.rtpSender === sender) {
         // No direct 'remove transform' API for Insertable Streams, relies on disable() cleanup
      }
      
      // Remove from map
      this.senders.delete(sender);
    } catch (error) {
      console.error("❌ [E2EE Manager] Error removing sender transform:", error);
    }
  }
  
  /**
   * Remove transform from a receiver
   * @param {RTCRtpReceiver} receiver - The receiver to remove transform from
   */
  removeReceiverTransform(receiver) {
    if (!receiver) return;
    console.log(`[E2EE Manager] Removing receiver transform for track ${receiver?.track?.id}`);
    try {
      // For standard API, set transform to null
      if (this.browserSupport.scriptTransform && receiver.transform) {
        receiver.transform = null;
        console.log("[E2EE Manager] Standard receiver transform removed.");
      }
      // For Chrome API, relies on disable() cleanup
      if (this.browserSupport.insertableStreams && receiver.transport && receiver.transport.rtpReceiver === receiver) {
         // No direct 'remove transform' API
      }

      // Remove from map
      this.receivers.delete(receiver);
    } catch (error) {
      console.error("❌ [E2EE Manager] Error removing receiver transform:", error);
    }
  }
  
  /**
   * Apply transforms to all relevant senders and receivers in a peer connection
   * @param {RTCPeerConnection} peerConnection - The peer connection
   */
  setupPeerConnection(peerConnection) {
    // Only setup if E2EE is intended to be enabled
    if (!this.enabled || !peerConnection) {
       console.log(`[E2EE Manager] Skipping E2EE setup for PeerConnection (enabled: ${this.enabled}, peer valid: ${!!peerConnection})`);
      return;
    }
    
    console.log("🔒 [E2EE Manager] Setting up E2EE for PeerConnection");
    try {
      // Set up existing senders
      peerConnection.getSenders().forEach(sender => {
        // Only apply transform to media tracks (audio/video)
        if (sender.track && (sender.track.kind === "audio" || sender.track.kind === "video")) {
           this.setupSenderTransform(sender);
        }
      });
      
      // Set up existing receivers
      peerConnection.getReceivers().forEach(receiver => {
         // Only apply transform to media tracks (audio/video)
        if (receiver.track && (receiver.track.kind === "audio" || receiver.track.kind === "video")) {
           this.setupReceiverTransform(receiver);
        }
      });
      
      // Note: Handling dynamically added tracks (via 'track' event) 
      // should also call setupReceiverTransform. This is typically handled 
      // in the main application logic (e.g., meeting.js or meeting-e2ee.js).

    } catch (error) {
      console.error("❌ [E2EE Manager] Error setting up peer connection transforms:", error);
    }
  }
}

