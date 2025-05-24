class E2EEManager {
  constructor(options = {}) {
    this.options = {
      roomId: options.roomId || "",
      ratchetInterval: options.ratchetInterval || 60000,
      workerPath: options.workerPath || "js/e2ee-worker.js"
    };

    this.keyManager = null;
    this.worker = null;
    this.isE2EEEnabled = false;
    this.isWorkerScriptReady = false;
    this.isWorkerKeyInitialized = false;
    this._workerReadyPromise = null;
    this._workerInitializedPromise = null;
    this._resolveWorkerReady = null;
    this._resolveWorkerInitialized = null;
  }

  async enable(password) {
    if (this.isE2EEEnabled) {
      console.log("🔒 E2EE already enabled.");
      return;
    }

    try {
      this.keyManager = new E2EEKeyManager({
        roomId: this.options.roomId,
        ratchetInterval: this.options.ratchetInterval
      });

      await this._setupWorker();
      await this.keyManager.generateInitialKey(password);
      const rawKey = this.keyManager.exportKey();

      this.worker.postMessage({
        operation: "init",
        keyData: rawKey
      });

      await this._workerInitializedPromise;
      this.isE2EEEnabled = true;
      console.log("✅ E2EE enabled successfully.");
    } catch (error) {
      console.error("❌ Failed to enable E2EE:", error);
      await this.disable();
      throw error;
    }
  }

  async disable() {
    this.isE2EEEnabled = false;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.keyManager) {
      this.keyManager.disable();
      this.keyManager = null;
    }

    this.isWorkerScriptReady = false;
    this.isWorkerKeyInitialized = false;
    this._workerReadyPromise = null;
    this._workerInitializedPromise = null;

    console.log("🔓 E2EE disabled.");
  }

  isReady() {
    return this.isE2EEEnabled && this.isWorkerScriptReady && this.isWorkerKeyInitialized;
  }

  async _setupWorker() {
    if (this._workerReadyPromise) return this._workerReadyPromise;

    this._workerReadyPromise = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(this.options.workerPath);

        this.worker.onmessage = this._handleWorkerMessage.bind(this);
        this.worker.onerror = (e) => {
          reject(new Error("Worker error: " + e.message));
        };

        this._workerInitializedPromise = new Promise((resInit) => {
          this._resolveWorkerInitialized = resInit;
        });

        this._resolveWorkerReady = resolve;
      } catch (error) {
        reject(error);
      }
    });

    return this._workerReadyPromise;
  }

  _handleWorkerMessage(event) {
    const { type } = event.data;

    if (type === "worker_ready") {
      this.isWorkerScriptReady = true;
      if (this._resolveWorkerReady) this._resolveWorkerReady();
    }

    if (type === "initialized") {
      this.isWorkerKeyInitialized = true;
      if (this._resolveWorkerInitialized) this._resolveWorkerInitialized();
    }

    if (type === "error") {
      console.error("[E2EE Worker] Error:", event.data.error);
    }
  }

  setupPeerConnection(peer) {
    if (!this.isReady()) {
      console.warn("[E2EE] Skipping E2EE transform — not ready.");
      return;
    }

    try {
      if (peer.getSenders) {
        peer.getSenders().forEach(sender => {
          if (sender.createEncodedStreams) {
            const { readable, writable } = sender.createEncodedStreams();
            const transformStream = new TransformStream({
              async transform(encodedFrame, controller) {
                const id = "frame-" + Date.now();
                encodedFrame.id = id;
                self.pendingFrames = self.pendingFrames || {};
                self.pendingFrames[id] = controller;

                self.worker.postMessage({ operation: "encrypt", frame: encodedFrame }, [encodedFrame.data]);
              }
            });
            readable.pipeThrough(transformStream).pipeTo(writable);
          }
        });
      }

      if (peer.getReceivers) {
        peer.getReceivers().forEach(receiver => {
          if (receiver.createEncodedStreams) {
            const { readable, writable } = receiver.createEncodedStreams();
            const transformStream = new TransformStream({
              async transform(encodedFrame, controller) {
                const id = "frame-" + Date.now();
                encodedFrame.id = id;
                self.pendingFrames = self.pendingFrames || {};
                self.pendingFrames[id] = controller;

                self.worker.postMessage({ operation: "decrypt", frame: encodedFrame }, [encodedFrame.data]);
              }
            });
            readable.pipeThrough(transformStream).pipeTo(writable);
          }
        });
      }

    } catch (err) {
      console.error("❌ Error applying E2EE transforms:", err);
    }
  }
}
