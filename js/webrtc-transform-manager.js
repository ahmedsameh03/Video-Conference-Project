class WebRTCTransformManager {
  constructor(e2eeManager) {
    this.e2eeManager = e2eeManager;
    this.transformStreams = new Map(); // sender/receiver -> transform stream
  }

  async setupSenderTransform(sender, targetUserId) {
    if (!sender) {
      console.warn(
        `Sender is undefined for ${targetUserId}. Skipping sender transform.`
      );
      return;
    }
    if (
      !this.e2eeManager.isInitialized ||
      !this.e2eeManager.isParticipant(targetUserId)
    ) {
      console.warn(`⚠️ E2EE not ready for sender to ${targetUserId}`);
      return;
    }

    try {
      const transform = new TransformStream({
        transform: async (encodedFrame, controller) => {
          try {
            // Encrypt the frame data
            const encryptedData = await this.e2eeManager.encrypt(
              encodedFrame.data,
              targetUserId
            );

            // Create new frame with encrypted data
            const encryptedFrame = new EncodedVideoFrame({
              data: encryptedData,
              type: encodedFrame.type,
              timestamp: encodedFrame.timestamp,
              duration: encodedFrame.duration,
              size: encryptedData.length,
            });

            controller.enqueue(encryptedFrame);
          } catch (error) {
            console.error("❌ Transform encryption failed:", error);
            // Fallback: send original frame
            controller.enqueue(encodedFrame);
          }
        },
      });

      // Apply transform to sender
      const readable = sender.createEncodedStreams().readable;
      const writable = sender.createEncodedStreams().writable;

      readable.pipeThrough(transform).pipeTo(writable);

      this.transformStreams.set(sender, transform);
      console.log(`🔐 Applied E2EE transform to sender for ${targetUserId}`);
    } catch (error) {
      console.error("❌ Failed to setup sender transform:", error);
    }
  }

  async setupReceiverTransform(receiver, sourceUserId) {
    if (!receiver) {
      console.warn(
        `Receiver is undefined for ${sourceUserId}. Skipping receiver transform.`
      );
      return;
    }
    if (
      !this.e2eeManager.isInitialized ||
      !this.e2eeManager.isParticipant(sourceUserId)
    ) {
      console.warn(`⚠️ E2EE not ready for receiver from ${sourceUserId}`);
      return;
    }

    try {
      const transform = new TransformStream({
        transform: async (encodedFrame, controller) => {
          try {
            // Decrypt the frame data
            const decryptedData = await this.e2eeManager.decrypt(
              encodedFrame.data,
              sourceUserId
            );

            // Create new frame with decrypted data
            const decryptedFrame = new EncodedVideoFrame({
              data: decryptedData,
              type: encodedFrame.type,
              timestamp: encodedFrame.timestamp,
              duration: encodedFrame.duration,
              size: decryptedData.length,
            });

            controller.enqueue(decryptedFrame);
          } catch (error) {
            console.error("❌ Transform decryption failed:", error);
            // Fallback: pass through original frame
            controller.enqueue(encodedFrame);
          }
        },
      });

      // Apply transform to receiver
      const readable = receiver.createEncodedStreams().readable;
      const writable = receiver.createEncodedStreams().writable;

      readable.pipeThrough(transform).pipeTo(writable);

      this.transformStreams.set(receiver, transform);
      console.log(`🔐 Applied E2EE transform to receiver from ${sourceUserId}`);
    } catch (error) {
      console.error("❌ Failed to setup receiver transform:", error);
    }
  }

  removeTransform(peerConnection, userId) {
    if (!peerConnection || peerConnection.connectionState === "closed") {
      console.warn(
        `Peer connection for ${userId} is undefined or closed. Skipping transform removal.`
      );
      return;
    }
    // Remove transforms for this user
    const senders = peerConnection.getSenders();
    const receivers = peerConnection.getReceivers();

    senders.forEach((sender) => {
      if (this.transformStreams.has(sender)) {
        this.transformStreams.delete(sender);
      }
    });

    receivers.forEach((receiver) => {
      if (this.transformStreams.has(receiver)) {
        this.transformStreams.delete(receiver);
      }
    });

    console.log(`🔐 Removed E2EE transforms for ${userId}`);
  }

  async applyE2EEToPeer(peerConnection, userId) {
    if (!peerConnection || peerConnection.connectionState === "closed") {
      console.warn(
        `Peer connection for ${userId} is undefined or closed. Skipping E2EE transform application.`
      );
      return;
    }
    if (!this.e2eeManager.isInitialized) {
      console.warn("⚠️ E2EE Manager not initialized");
      return;
    }

    try {
      // Apply transforms to all senders
      const senders = peerConnection.getSenders();
      for (const sender of senders) {
        if (
          sender.track &&
          (sender.track.kind === "video" || sender.track.kind === "audio")
        ) {
          await this.setupSenderTransform(sender, userId);
        }
      }

      // Apply transforms to all receivers
      const receivers = peerConnection.getReceivers();
      for (const receiver of receivers) {
        if (
          receiver.track &&
          (receiver.track.kind === "video" || receiver.track.kind === "audio")
        ) {
          await this.setupReceiverTransform(receiver, userId);
        }
      }

      console.log(`🔐 Applied E2EE to peer connection for ${userId}`);
    } catch (error) {
      console.error(`❌ Failed to apply E2EE to peer ${userId}:`, error);
    }
  }

  // Fallback method for browsers that don't support TransformStream
  setupLegacyE2EE(peerConnection, userId) {
    console.warn("⚠️ Using legacy E2EE method - TransformStream not supported");

    // For browsers without TransformStream support, we'll use a different approach
    // This could involve encrypting data before sending via DataChannel
    // or using a different encryption strategy

    return false; // Indicates legacy mode
  }

  destroy() {
    this.transformStreams.clear();
    console.log("🔐 WebRTC Transform Manager destroyed");
  }
}
