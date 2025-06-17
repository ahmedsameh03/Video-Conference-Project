export class E2EEManager {
  constructor() {
    this.worker = new Worker("js/e2ee-worker.js");
    this.key = "secure-seen-room-key"; // 🔐 You can randomize this per meeting if needed
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.worker.postMessage({ type: "init", keyString: this.key });
    this.initialized = true;
  }

  setSenderTransform(sender, enabled) {
    if (!enabled) {
      sender.transform = undefined;
      return;
    }

    const { readable, writable } = sender.createEncodedStreams();

    const senderTransform = new TransformStream({
      transform: (encodedFrame, controller) => {
        const dataCopy = new Uint8Array(encodedFrame.data); // Copy before transfer
        const messageId = crypto.randomUUID();

        const handleMessage = (event) => {
          if (event.data.type === "encrypted") {
            encodedFrame.data = new Uint8Array(event.data.data);
            controller.enqueue(encodedFrame);
            this.worker.removeEventListener("message", handleMessage);
          }
        };

        this.worker.addEventListener("message", handleMessage);
        this.worker.postMessage({ type: "encrypt", data: dataCopy }, [
          dataCopy.buffer,
        ]);
      },
    });

    readable.pipeThrough(senderTransform).pipeTo(writable);
  }

  setReceiverTransform(receiver, enabled) {
    if (!enabled) {
      receiver.transform = undefined;
      return;
    }

    const { readable, writable } = receiver.createEncodedStreams();

    const receiverTransform = new TransformStream({
      transform: (encodedFrame, controller) => {
        const dataCopy = new Uint8Array(encodedFrame.data); // Copy before transfer
        const ivCopy = encodedFrame.iv
          ? new Uint8Array(encodedFrame.iv)
          : crypto.getRandomValues(new Uint8Array(12)); // Fallback

        const messageId = crypto.randomUUID();

        const handleMessage = (event) => {
          if (event.data.type === "decrypted") {
            encodedFrame.data = new Uint8Array(event.data.data);
            controller.enqueue(encodedFrame);
            this.worker.removeEventListener("message", handleMessage);
          }
        };

        this.worker.addEventListener("message", handleMessage);
        this.worker.postMessage(
          { type: "decrypt", data: { data: dataCopy, iv: ivCopy } },
          [dataCopy.buffer]
        );
      },
    });

    readable.pipeThrough(receiverTransform).pipeTo(writable);
  }

  async encrypt(plainData) {
    return new Promise((resolve) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const listener = (event) => {
        if (event.data.type === "encrypted") {
          this.worker.removeEventListener("message", listener);
          resolve({ cipher: event.data.data, iv });
        }
      };
      this.worker.addEventListener("message", listener);
      this.worker.postMessage({ type: "encrypt", data: plainData }, [
        plainData.buffer,
      ]);
    });
  }

  async decrypt(cipher, iv) {
    return new Promise((resolve, reject) => {
      const listener = (event) => {
        if (event.data.type === "decrypted") {
          this.worker.removeEventListener("message", listener);
          resolve(event.data.data);
        }
      };
      this.worker.addEventListener("message", listener);
      this.worker.postMessage({ type: "decrypt", data: { data: cipher, iv } }, [
        cipher.buffer,
      ]);
    });
  }

  isEnabled() {
    return true; // You may link this to the toggle switch in the UI
  }
}
