export class E2EEManager {
  constructor() {
    this.worker = new Worker("js/e2ee-worker.js");
    this.key = "secure-seen-room-key";
    this.enabled = false;
  }

  async init() {
    this.worker.postMessage({ type: "init", keyString: this.key });
    console.log("🔐 E2EE initialized.");
  }

  toggle() {
    this.enabled = !this.enabled;
    console.log(this.enabled ? "🔒 E2EE enabled" : "🔓 E2EE disabled");
  }

  isEnabled() {
    return this.enabled;
  }

  encrypt(data) {
    return new Promise((resolve) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      this.worker.onmessage = (e) => {
        if (e.data.type === "encrypted") {
          resolve({ cipher: e.data.data, iv: e.data.iv });
        }
      };
      this.worker.postMessage({ type: "encrypt", data }, [data]);
    });
  }

  decrypt(cipher, iv) {
    return new Promise((resolve) => {
      this.worker.onmessage = (e) => {
        if (e.data.type === "decrypted") {
          resolve(e.data.data);
        }
      };
      this.worker.postMessage({ type: "decrypt", data: { data: cipher, iv } }, [
        cipher,
      ]);
    });
  }

  setSenderTransform(sender) {
    if (!this.enabled) return;

    const transformStream = new TransformStream({
      transform: async (frame, controller) => {
        const { cipher, iv } = await this.encrypt(frame.data);
        frame.data = new Uint8Array(cipher);
        frame.iv = iv;
        controller.enqueue(frame);
      },
    });

    const streams = sender.createEncodedStreams();
    streams.readable.pipeThrough(transformStream).pipeTo(streams.writable);
  }

  setReceiverTransform(receiver) {
    if (!this.enabled) return;

    const transformStream = new TransformStream({
      transform: async (frame, controller) => {
        const decrypted = await this.decrypt(frame.data, frame.iv);
        frame.data = new Uint8Array(decrypted);
        controller.enqueue(frame);
      },
    });

    const streams = receiver.createEncodedStreams();
    streams.readable.pipeThrough(transformStream).pipeTo(streams.writable);
  }
}
