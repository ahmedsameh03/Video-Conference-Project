// e2ee-manager.js

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
    this.pendingFrames = new Map();
    this._workerReadyPromise = null;
    this._workerInitializedPromise = null;

    this._handleWorkerMessage = this._handleWorkerMessage.bind(this);
  }

  async enable(password) {
    if (this.isE2EEEnabled) return;
    try {
      this.keyManager = new E2EEKeyManager({ roomId: this.options.roomId });
      await this._setupWorker();
      await this.keyManager.generateInitialKey(password);
      const rawKey = this.keyManager.exportKey();

      this.worker.postMessage({ operation: "init", keyData: rawKey });

      await this._workerInitializedPromise;
      this.isE2EEEnabled = true;
      console.log("✅ E2EE enabled successfully");
    } catch (e) {
      console.error("❌ E2EE failed to enable:", e);
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
    this.pendingFrames.clear();
    console.log("🔓 E2EE disabled");
  }

  async _setupWorker() {
    if (this._workerReadyPromise) return this._workerReadyPromise;
    this._workerReadyPromise = new Promise((resolve, reject) => {
      this.worker = new Worker(this.options.workerPath);
      this.worker.onmessage = this._handleWorkerMessage;

      this.worker.onerror = (e) => {
        console.error("❌ Worker error:", e.message);
        reject(e);
      };

      this._workerInitializedPromise = new Promise((resInit) => {
        this._resolveWorkerInitialized = resInit;
      });

      this._resolveWorkerReady = resolve;
    });
    return this._workerReadyPromise;
  }

  _handleWorkerMessage(event) {
    const { type } = event.data;
    if (type === "worker_ready") {
      this.isWorkerScriptReady = true;
      this._resolveWorkerReady?.();
    } else if (type === "initialized") {
      this.isWorkerKeyInitialized = true;
      this._resolveWorkerInitialized?.();
    } else {
      console.log(`[Worker] Message:`, type, event.data);
    }
  }

  isReady() {
    return this.isE2EEEnabled && this.isWorkerKeyInitialized;
  }
}
