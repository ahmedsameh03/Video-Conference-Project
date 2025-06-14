// js/e2ee-manager.js - WebRTC Integration Layer for E2EE (Diffie-Hellman)

/**
 * Manages the integration of E2EE (using Diffie-Hellman key exchange)
 * with WebRTC peer connections, coordinating the key manager and worker.
 */
class E2EEManager {
  /**
   * Create a new E2EEManager instance
   * @param {Object} options - Configuration options
   * @param {string} options.workerPath - Path to the E2EE worker script
   * @param {E2EEKeyManager} options.keyManager - Instance of the DH key manager
   */
  constructor(options = {}) {
    this.options = {
      workerPath: options.workerPath || "js/e2ee-worker.js",
      pendingFrameTimeout: options.pendingFrameTimeout || 5000, // Timeout for worker response (ms)
      keyManager: options.keyManager || null // Expecting the DH key manager instance
    };

    if (!this.options.keyManager) {
        throw new Error("E2EEKeyManager instance is required in options.");
    }
    
    this.worker = null;
    this.isE2EEEnabled = false; // Is E2EE *intended* to be active?
    this.isWorkerScriptReady = false; // Has the worker script loaded?
    // Note: Worker key initialization is now per-peer, not a single global state.
    this.senders = new Map(); // Map<RTCRtpSender, { peerId: string, transform: any }>
    this.receivers = new Map(); // Map<RTCRtpReceiver, { peerId: string, transform: any }>
    this.pendingFrames = new Map(); // Used for Chrome Insertable Streams
    this.browserSupport = this._detectBrowserSupport();
    this._workerReadyPromise = null; // Promise to track worker script loading
    this.peerConnectionMap = new Map(); // Map<RTCPeerConnection, peerId> - Needs to be populated from meeting.js
    
    // Bind methods
    this._handleWorkerMessage = this._handleWorkerMessage.bind(this);
    
    console.log("🔒 E2EE Manager initialized (DH Mode)");
    console.log(`🌐 Browser support: ${JSON.stringify(this.browserSupport)}`);
  }
  
  /** Get browser support information */
  getSupportInfo() {
    return this.browserSupport;
  }
  
  /** Detect browser support for E2EE APIs */
  _detectBrowserSupport() {
    // (Implementation remains the same as previous version)
    const support = {
      insertableStreams: false,
      scriptTransform: false,
      supported: false,
      browser: "unknown"
    };
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("chrome") || userAgent.includes("edge")) {
      support.browser = "chrome/edge";
      support.insertableStreams = typeof RTCRtpSender !== "undefined" && "createEncodedStreams" in RTCRtpSender.prototype;
    } else if (userAgent.includes("firefox")) {
      support.browser = "firefox";
      support.scriptTransform = typeof RTCRtpScriptTransform !== "undefined";
    } else if (userAgent.includes("safari") && !userAgent.includes("chrome")) {
      support.browser = "safari";
      support.scriptTransform = typeof RTCRtpScriptTransform !== "undefined";
    }
    support.supported = support.insertableStreams || support.scriptTransform;
    return support;
  }
  
  /** Set up the Web Worker */
  _setupWorker() {
    if (this._workerReadyPromise) return this._workerReadyPromise;

    this._workerReadyPromise = new Promise((resolve, reject) => {
      try {
        console.log(`[E2EE Manager] Creating worker from path: ${this.options.workerPath}`);
        this.worker = new Worker(this.options.workerPath);
        this.worker.onmessage = this._handleWorkerMessage;
        this.worker.onerror = (error) => {
          console.error("❌ [E2EE Manager] Worker error event:", error);
          reject(new Error(`Worker error: ${error.message || "Unknown worker error"}`)); 
          this._workerReadyPromise = null; 
          this.isWorkerScriptReady = false;
        };
        
        const readyTimeout = setTimeout(() => {
          console.error("❌ [E2EE Manager] Worker readiness timeout.");
          reject(new Error("Worker readiness timeout"));
          this._workerReadyPromise = null; 
          this.isWorkerScriptReady = false;
        }, 15000);

        this._resolveWorkerReady = () => {
            console.log("[E2EE Manager] Worker reported ready.");
            this.isWorkerScriptReady = true;
            clearTimeout(readyTimeout);
            resolve();
        };
        this._rejectWorkerReady = (error) => {
            console.error("❌ [E2EE Manager] Worker ready promise rejected:", error);
            clearTimeout(readyTimeout);
            reject(error);
        };
      } catch (error) {
        console.error("❌ [E2EE Manager] Error creating worker:", error);
        reject(error);
        this._workerReadyPromise = null; 
        this.isWorkerScriptReady = false;
      }
    });
    return this._workerReadyPromise;
  }
  
  /** Handle messages from the worker */
  _handleWorkerMessage(event) {
    const { type, frame, error, message, peerId, operation } = event.data;
    
    // Clear timeout for pending frames if response received
    if (frame && frame.id && this.pendingFrames.has(frame.id)) {
        const pending = this.pendingFrames.get(frame.id);
        clearTimeout(pending.timeoutId);
    }

    switch (type) {
      case "worker_ready":
        if (this._resolveWorkerReady) this._resolveWorkerReady();
        break;

      // No single "initialized" message anymore, keys are per-peer
      case "key_initialized": // Worker confirms key for a specific peer
        console.log(`✅ [E2EE Manager] Worker confirmed key initialization for peer: ${peerId}`);
        // Potentially update UI or internal state if needed
        break;

      case "encrypted":
      case "decrypted":
        if (frame && frame.id && this.pendingFrames.has(frame.id)) {
          const pending = this.pendingFrames.get(frame.id);
          pending.controller.enqueue(frame);
          this.pendingFrames.delete(frame.id);
        }
        break;
        
      case "error":
        console.error(`❌ [E2EE Manager] Received error from worker: ${error}`, `Operation: ${operation}`, `PeerID: ${peerId}`);
        // Handle pending frames if error occurred during encrypt/decrypt
        if (frame && frame.id && this.pendingFrames.has(frame.id)) {
          console.warn(`[E2EE Manager] Worker error during frame processing (ID: ${frame.id}, Peer: ${peerId}). Forwarding original frame.`);
          const pending = this.pendingFrames.get(frame.id);
          pending.controller.enqueue(frame); // Forward original frame
          this.pendingFrames.delete(frame.id);
        }
        break;
        
      case "log":
        console.log(`[E2EE Worker Log] ${message}`);
        break;
        
      default:
        console.warn(`❓ [E2EE Manager] Unknown message type from worker: ${type}`);
    }
  }
  
  /**
   * Enable end-to-end encryption (DH Mode).
   * This sets up the worker but does not handle key exchange itself.
   * Key exchange is initiated by meeting-e2ee.js.
   * @param {string} mode - Should indicate DH mode (e.g., "dh-mode")
   * @returns {Promise<void>}
   */
  async enable(mode) {
    if (this.isE2EEEnabled) {
      console.log("🔒 [E2EE Manager] E2EE already enabled");
      return;
    }
    if (mode !== "dh-mode") {
        console.warn("[E2EE Manager] Enable called without specifying 'dh-mode'. Assuming DH.");
    }
    if (!this.browserSupport.supported) {
      throw new Error(`E2EE not supported in this browser (${this.browserSupport.browser})`);
    }
    if (!this.options.keyManager) {
        throw new Error("E2EEKeyManager instance not provided during initialization.");
    }
    
    try {
      console.log("🔒 [E2EE Manager] Enabling E2EE (DH Mode)...");
      
      // Set up worker (returns promise that resolves on worker_ready)
      console.log("[E2EE Manager] Setting up worker...");
      await this._setupWorker(); 
      console.log("✅ [E2EE Manager] Worker setup complete (worker_ready received).");

      // Key generation is handled by meeting-e2ee.js calling keyManager.generateKeyPair()
      // Key exchange is handled by meeting-e2ee.js via signaling
      // Keys are sent to worker via setPeerKey() method below
      
      this.isE2EEEnabled = true;
      console.log("✅ [E2EE Manager] E2EE enabled (waiting for key exchange). Worker is ready.");

    } catch (error) {
      console.error("❌ [E2EE Manager] Error enabling E2EE:", error);
      await this.disable(); // Clean up on failure
      throw error; 
    }
  }

  /**
   * Sends a derived key for a specific peer to the worker.
   * @param {string} peerId - The unique identifier for the peer.
   * @param {Uint8Array} keyData - The raw 32-byte derived key.
   * @returns {Promise<void>}
   */
  async setPeerKey(peerId, keyData) {
      if (!this.isE2EEEnabled || !this.worker || !this.isWorkerScriptReady) {
          console.error(`[E2EE Manager] Cannot set key for peer ${peerId}: E2EE not enabled or worker not ready.`);
          return;
      }
      if (!peerId || !keyData || !(keyData instanceof Uint8Array) || keyData.byteLength !== 32) {
          console.error(`[E2EE Manager] Invalid peerId or keyData provided for setPeerKey.`);
          return;
      }

      console.log(`[E2EE Manager] Sending key for peer ${peerId} to worker...`);
      this.worker.postMessage({
          operation: "setKey",
          peerId: peerId,
          keyData: keyData
      });
      // Apply transforms now that key is available (or re-apply if needed)
      this.setupTransformsForPeer(peerId);
  }
  
  /**
   * Disable end-to-end encryption
   */
  async disable() {
    if (!this.isE2EEEnabled && !this.worker) {
      console.log("🔓 [E2EE Manager] E2EE already disabled or not initialized.");
      return;
    }
    
    console.log("🔓 [E2EE Manager] Disabling E2EE...");
    this.isE2EEEnabled = false; // Set enabled to false immediately
    
    // Remove transforms from all senders and receivers
    console.log("[E2EE Manager] Removing transforms...");
    this.senders.forEach((senderInfo, sender) => this._removeSenderTransform(sender));
    this.receivers.forEach((receiverInfo, receiver) => this._removeReceiverTransform(receiver));
    
    this.senders.clear();
    this.receivers.clear();
    this.peerConnectionMap.clear();
    this.pendingFrames.forEach(pending => clearTimeout(pending.timeoutId));
    this.pendingFrames.clear();
    console.log("[E2EE Manager] Maps and pending frames cleared.");
    
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      console.log("[E2EE Manager] Worker terminated.");
    }
    
    // Key manager cleanup is handled by meeting-e2ee.js
    
    this._workerReadyPromise = null;
    this.isWorkerScriptReady = false;
    
    console.log("✅ [E2EE Manager] E2EE disabled fully.");
  }
  
  /** Check if E2EE is enabled AND worker script is ready */
  isReady() {
    // Note: Key readiness is now per-peer, managed by the worker
    return this.isE2EEEnabled && this.isWorkerScriptReady;
  }

  /** 
   * Associate a peer connection with a peer ID. 
   * MUST be called from meeting.js when a connection is established.
   */
  addPeerConnection(peerConnection, peerId) {
      if (!peerId) {
          console.error("[E2EE Manager] Cannot add peer connection without peerId.");
          return;
      }
      this.peerConnectionMap.set(peerConnection, peerId);
      console.log(`[E2EE Manager] Associated PeerConnection with peerId: ${peerId}`);
      // Attempt to set up transforms if E2EE is already enabled
      if (this.isE2EEEnabled) {
          this.setupTransformsForPeer(peerId, peerConnection);
      }
  }

  /** Remove peer connection association */
  removePeerConnection(peerConnection) {
      const peerId = this.peerConnectionMap.get(peerConnection);
      if (peerId) {
          console.log(`[E2EE Manager] Removing association for peerId: ${peerId}`);
          // Clean up transforms associated with this connection
          peerConnection.getSenders().forEach(sender => {
              if (this.senders.has(sender) && this.senders.get(sender).peerId === peerId) {
                  this._removeSenderTransform(sender);
                  this.senders.delete(sender);
              }
          });
          peerConnection.getReceivers().forEach(receiver => {
              if (this.receivers.has(receiver) && this.receivers.get(receiver).peerId === peerId) {
                  this._removeReceiverTransform(receiver);
                  this.receivers.delete(receiver);
              }
          });
          this.peerConnectionMap.delete(peerConnection);
          // Optionally tell worker to remove key for this peerId if no other connections use it
          // this.worker.postMessage({ operation: "removeKey", peerId: peerId });
      } else {
          console.warn("[E2EE Manager] Tried to remove unmapped PeerConnection.");
      }
  }

  /** Find the peerId associated with a sender or receiver */
  _findPeerId(senderOrReceiver) {
      for (const [pc, peerId] of this.peerConnectionMap.entries()) {
          if (pc.getSenders().includes(senderOrReceiver) || pc.getReceivers().includes(senderOrReceiver)) {
              return peerId;
          }
      }
      console.warn("[E2EE Manager] Could not find peerId for sender/receiver.");
      return null;
  }

  /** Setup transforms for all senders/receivers associated with a peerId */
  setupTransformsForPeer(peerId, specificPeerConnection = null) {
      if (!this.isE2EEEnabled) return;
      console.log(`[E2EE Manager] Setting up transforms for peer: ${peerId}`);
      
      const connectionsToUpdate = specificPeerConnection 
          ? [specificPeerConnection] 
          : Array.from(this.peerConnectionMap.keys());

      connectionsToUpdate.forEach(pc => {
          if (this.peerConnectionMap.get(pc) === peerId) {
              pc.getSenders().forEach(sender => this.setupSenderTransform(sender, peerId));
              pc.getReceivers().forEach(receiver => this.setupReceiverTransform(receiver, peerId));
          }
      });
  }
  
  /** Set up transform for an RTCRtpSender */
  setupSenderTransform(sender, peerId) {
    if (!this.isE2EEEnabled || !sender || this.senders.has(sender) || !sender.track) return;
    
    const resolvedPeerId = peerId || this._findPeerId(sender);
    if (!resolvedPeerId) {
        console.error(`[E2EE Manager] Cannot setup sender transform: Missing peerId for track ${sender.track?.id}`);
        return;
    }

    // Check if worker has the key for this peer (optional, worker handles errors)
    // if (!this.options.keyManager.getPeerKey(resolvedPeerId)) {
    //     console.warn(`[E2EE Manager] Delaying sender transform for ${resolvedPeerId}: Key not yet derived.`);
    //     return;
    // }

    try {
      console.log(`🔒 [E2EE Manager] Setting up sender transform for peer ${resolvedPeerId}, track ${sender.track?.kind}`);
      let transform;
      if (this.browserSupport.insertableStreams && sender.createEncodedStreams) {
        transform = this._setupSenderTransformChrome(sender, resolvedPeerId);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== "undefined") {
        transform = this._setupSenderTransformStandard(sender, resolvedPeerId);
      } else {
        console.warn("⚠️ [E2EE Manager] No supported E2EE API available for sender transform");
        return;
      }
      this.senders.set(sender, { peerId: resolvedPeerId, transform: transform });
    } catch (error) {
      console.error(`❌ [E2EE Manager] Error setting up sender transform for peer ${resolvedPeerId}:`, error);
    }
  }
  
  /** Set up transform for an RTCRtpReceiver */
  setupReceiverTransform(receiver, peerId) {
    if (!this.isE2EEEnabled || !receiver || this.receivers.has(receiver) || !receiver.track) return;

    const resolvedPeerId = peerId || this._findPeerId(receiver);
     if (!resolvedPeerId) {
        console.error(`[E2EE Manager] Cannot setup receiver transform: Missing peerId for track ${receiver.track?.id}`);
        return;
    }

    // Check if worker has the key for this peer (optional)
    // if (!this.options.keyManager.getPeerKey(resolvedPeerId)) {
    //     console.warn(`[E2EE Manager] Delaying receiver transform for ${resolvedPeerId}: Key not yet derived.`);
    //     return;
    // }

    try {
      console.log(`🔒 [E2EE Manager] Setting up receiver transform for peer ${resolvedPeerId}, track ${receiver.track?.kind}`);
      let transform;
      if (this.browserSupport.insertableStreams && receiver.createEncodedStreams) {
        transform = this._setupReceiverTransformChrome(receiver, resolvedPeerId);
      } else if (this.browserSupport.scriptTransform && typeof RTCRtpScriptTransform !== "undefined") {
        transform = this._setupReceiverTransformStandard(receiver, resolvedPeerId);
      } else {
        console.warn("⚠️ [E2EE Manager] No supported E2EE API available for receiver transform");
        return;
      }
      this.receivers.set(receiver, { peerId: resolvedPeerId, transform: transform });
    } catch (error) {
      console.error(`❌ [E2EE Manager] Error setting up receiver transform for peer ${resolvedPeerId}:`, error);
    }
  }
  
  /** Set up sender transform using Chrome Insertable Streams */
  _setupSenderTransformChrome(sender, peerId) {
    console.log(`[E2EE Manager] Setting up Chrome sender transform for peer ${peerId}, track ${sender?.track?.id}`);
    const { readable, writable } = sender.createEncodedStreams();
    const frameIdCounter = 0;
    
    const transformStream = new TransformStream({
      transform: (encodedFrame, controller) => {
        if (!this.isE2EEEnabled || !this.worker || !this.isWorkerScriptReady) {
          controller.enqueue(encodedFrame); // Pass through if not ready
          return;
        }
        
        const frameId = `${peerId}-s-${frameIdCounter++}`;
        encodedFrame.id = frameId; // Add ID for tracking
        
        // Store controller and set timeout
        const timeoutId = setTimeout(() => {
          console.error(`❌ [E2EE Manager] Timeout waiting for worker response (encrypt frame ${frameId}, peer ${peerId}). Forwarding original.`);
          if (this.pendingFrames.has(frameId)) {
              controller.enqueue(encodedFrame); // Forward original on timeout
              this.pendingFrames.delete(frameId);
          }
        }, this.options.pendingFrameTimeout);
        
        this.pendingFrames.set(frameId, { controller, timeoutId });
        
        // Send to worker for encryption
        this.worker.postMessage({
          operation: "encrypt",
          peerId: peerId, // Include peerId
          frame: encodedFrame
        }, [encodedFrame.data]); // Transfer data buffer
      }
    });
    
    readable.pipeThrough(transformStream).pipeTo(writable);
    return transformStream; // Return for potential removal later
  }
  
  /** Set up receiver transform using Chrome Insertable Streams */
  _setupReceiverTransformChrome(receiver, peerId) {
    console.log(`[E2EE Manager] Setting up Chrome receiver transform for peer ${peerId}, track ${receiver?.track?.id}`);
    const { readable, writable } = receiver.createEncodedStreams();
    const frameIdCounter = 0;

    const transformStream = new TransformStream({
      transform: (encodedFrame, controller) => {
        if (!this.isE2EEEnabled || !this.worker || !this.isWorkerScriptReady) {
          controller.enqueue(encodedFrame); // Pass through if not ready
          return;
        }
        
        const frameId = `${peerId}-r-${frameIdCounter++}`;
        encodedFrame.id = frameId;
        
        const timeoutId = setTimeout(() => {
          console.error(`❌ [E2EE Manager] Timeout waiting for worker response (decrypt frame ${frameId}, peer ${peerId}). Forwarding original.`);
           if (this.pendingFrames.has(frameId)) {
              controller.enqueue(encodedFrame);
              this.pendingFrames.delete(frameId);
          }
        }, this.options.pendingFrameTimeout);
        
        this.pendingFrames.set(frameId, { controller, timeoutId });
        
        // Send to worker for decryption
        this.worker.postMessage({
          operation: "decrypt",
          peerId: peerId, // Include peerId
          frame: encodedFrame
        }, [encodedFrame.data]); // Transfer data buffer
      }
    });
    
    readable.pipeThrough(transformStream).pipeTo(writable);
    return transformStream;
  }
  
  /** Set up sender transform using Standard RTCRtpScriptTransform */
  _setupSenderTransformStandard(sender, peerId) {
    if (!this.worker) throw new Error("Worker not initialized for standard transform");
    console.log(`[E2EE Manager] Setting up Standard sender transform for peer ${peerId}, track ${sender?.track?.id}`);
    const transform = new RTCRtpScriptTransform(this.worker, {
      operation: "encrypt",
      peerId: peerId // Pass peerId to worker options
    });
    sender.transform = transform;
    return transform;
  }
  
  /** Set up receiver transform using Standard RTCRtpScriptTransform */
  _setupReceiverTransformStandard(receiver, peerId) {
    if (!this.worker) throw new Error("Worker not initialized for standard transform");
    console.log(`[E2EE Manager] Setting up Standard receiver transform for peer ${peerId}, track ${receiver?.track?.id}`);
    const transform = new RTCRtpScriptTransform(this.worker, {
      operation: "decrypt",
      peerId: peerId // Pass peerId to worker options
    });
    receiver.transform = transform;
    return transform;
  }

  /** Remove sender transform */
  _removeSenderTransform(sender) {
      try {
          if (this.browserSupport.insertableStreams && sender.rtpSender && sender.rtpSender.transport) {
              // For Chrome, breaking the pipe is complex, often relies on connection closing.
              // We mainly rely on the isE2EEEnabled flag in the transform function.
              console.log(`[E2EE Manager] Chrome sender transform removal relies on isE2EEEnabled flag.`);
          } else if (this.browserSupport.scriptTransform && sender.transform) {
              sender.transform = null;
              console.log(`[E2EE Manager] Removed Standard sender transform.`);
          }
      } catch (error) {
          console.error("Error removing sender transform:", error);
      }
  }

  /** Remove receiver transform */
  _removeReceiverTransform(receiver) {
      try {
          if (this.browserSupport.insertableStreams && receiver.rtpReceiver && receiver.rtpReceiver.transport) {
              console.log(`[E2EE Manager] Chrome receiver transform removal relies on isE2EEEnabled flag.`);
          } else if (this.browserSupport.scriptTransform && receiver.transform) {
              receiver.transform = null;
              console.log(`[E2EE Manager] Removed Standard receiver transform.`);
          }
      } catch (error) {
          console.error("Error removing receiver transform:", error);
      }
  }
}

