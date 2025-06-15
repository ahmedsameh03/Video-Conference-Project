class E2EEManager {
  constructor() {
    this.worker = new Worker("js/e2ee-worker.js");
    this.key = "secure-seen-room-key"; // You may dynamically generate or rotate this later
  }

  async init() {
    this.worker.postMessage({ type: "init", keyString: this.key });
  }

  setSenderTransform(sender, enabled) {
    if (!enabled) {
      sender.transform = undefined;
      return;
    }

    const senderTransform = new TransformStream({
      transform: async (encodedFrame, controller) => {
        const data = encodedFrame.data;
        this.worker.postMessage({ type: "encrypt", data }, [data.buffer]);
        this.worker.onmessage = (event) => {
          if (event.data.type === "encrypted") {
            encodedFrame.data = new Uint8Array(event.data.data);
            controller.enqueue(encodedFrame);
          }
        };
      },
    });

    const senderStream = sender.createEncodedStreams().readable;
    senderStream
      .pipeThrough(senderTransform)
      .pipeTo(sender.createEncodedStreams().writable);
  }

  setReceiverTransform(receiver, enabled) {
    if (!enabled) {
      receiver.transform = undefined;
      return;
    }

    const receiverTransform = new TransformStream({
      transform: async (encodedFrame, controller) => {
        const data = encodedFrame.data;
        this.worker.postMessage(
          { type: "decrypt", data: { data, iv: encodedFrame.iv } },
          [data.buffer]
        );
        this.worker.onmessage = (event) => {
          if (event.data.type === "decrypted") {
            encodedFrame.data = new Uint8Array(event.data.data);
            controller.enqueue(encodedFrame);
          }
        };
      },
    });

    const receiverStream = receiver.createEncodedStreams().readable;
    receiverStream
      .pipeThrough(receiverTransform)
      .pipeTo(receiver.createEncodedStreams().writable);
  }
}
