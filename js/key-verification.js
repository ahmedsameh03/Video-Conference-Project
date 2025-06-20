class KeyVerification {
  constructor(e2eeManager) {
    this.e2eeManager = e2eeManager;
    this.verificationStatus = new Map(); // userId -> verification status
    this.verificationCallbacks = new Map(); // userId -> callback functions
  }

  async generateVerificationCode(userId) {
    try {
      // Get the shared secret for this user
      const sharedSecret = this.e2eeManager.sharedSecrets.get(userId);
      if (!sharedSecret) {
        throw new Error(`No shared secret found for user ${userId}`);
      }

      // Create a verification message that includes both user IDs
      const currentName =
        new URLSearchParams(window.location.search).get("name") || "unknown";
      const verificationMessage = `VERIFY-${currentName}-${userId}-${Date.now()}`;

      console.log(
        `🔐 Generating verification code for ${userId} from ${currentName}`
      );
      console.log(`🔐 Verification message: ${verificationMessage}`);

      // Create a hash of the shared secret and verification message
      const messageBuffer = new TextEncoder().encode(verificationMessage);
      const sharedSecretBuffer = new Uint8Array(sharedSecret);

      // Combine shared secret and message
      const combined = new Uint8Array(
        sharedSecretBuffer.length + messageBuffer.length
      );
      combined.set(sharedSecretBuffer, 0);
      combined.set(messageBuffer, sharedSecretBuffer.length);

      // Create hash
      const hash = await window.crypto.subtle.digest("SHA-256", combined);

      // Convert to base64 and take first 8 characters
      const hashArray = new Uint8Array(hash);
      const hashBase64 = btoa(String.fromCharCode(...hashArray));
      const verificationCode = hashBase64.substring(0, 8).toUpperCase();

      console.log(`🔐 Generated verification code: ${verificationCode}`);

      return {
        code: verificationCode,
        message: verificationMessage,
        timestamp: Date.now(),
        userId: currentName,
        targetUserId: userId,
      };
    } catch (error) {
      console.error(
        `❌ Failed to generate verification code for ${userId}:`,
        error
      );
      throw error;
    }
  }

  async verifyKey(peerId, receivedCode, receivedQrData = null) {
    try {
      const currentUserName = new URLSearchParams(window.location.search).get("name") || "unknown";
      console.log(
        `🔐 Verifying key for peer ${peerId} with code: ${receivedCode}. Current user: ${currentUserName}`
      );
      console.log(`🔐 Received QR data:`, receivedQrData);

      if (receivedQrData && receivedQrData.userId && receivedQrData.targetUserId) {
        // This block handles QR code based verification

        // Validate QR data context
        if (receivedQrData.userId !== peerId) {
          console.error(
            `❌ QR data generator (${receivedQrData.userId}) does not match peerId (${peerId}) being verified.`
          );
          this.verificationStatus.set(peerId, { verified: false, error: "QR data mismatch" });
          return false;
        }
        if (receivedQrData.targetUserId !== currentUserName) {
          console.error(
            `❌ QR code is not for the current user. Target: ${receivedQrData.targetUserId}, Current: ${currentUserName}`
          );
          this.verificationStatus.set(peerId, { verified: false, error: "QR target mismatch" });
          return false;
        }

        // Get the shared secret with the peer who generated the QR code (peerId)
        const sharedSecret = this.e2eeManager.sharedSecrets.get(peerId);
        if (!sharedSecret) {
          throw new Error(`No shared secret found for user ${peerId}`);
        }

        // Recreate the exact verification message that peerId would have generated
        const verificationMessage = `VERIFY-${receivedQrData.userId}-${receivedQrData.targetUserId}-${receivedQrData.timestamp}`;
        console.log(
          `🔐 Recreated verification message for QR: ${verificationMessage}`
        );

        // Create the same hash as the generator (peerId)
        const messageBuffer = new TextEncoder().encode(verificationMessage);
        const sharedSecretBuffer = new Uint8Array(sharedSecret);

        const combined = new Uint8Array(
          sharedSecretBuffer.length + messageBuffer.length
        );
        combined.set(sharedSecretBuffer, 0);
        combined.set(messageBuffer, sharedSecretBuffer.length);

        const hash = await window.crypto.subtle.digest("SHA-256", combined);
        const hashArray = new Uint8Array(hash);
        const hashBase64 = btoa(String.fromCharCode(...hashArray));
        const expectedCode = hashBase64.substring(0, 8).toUpperCase();

        console.log(
          `🔐 Expected code from ${peerId}: ${expectedCode}, Received code: ${receivedCode}`
        );

        const isMatch = expectedCode === receivedCode.toUpperCase();

        this.verificationStatus.set(peerId, {
          verified: isMatch,
          timestamp: Date.now(),
          method: "qr",
          receivedCode: receivedCode,
          expectedCode: expectedCode,
        });

        if (!isMatch) {
          console.error(
            `❌ Key verification failed for ${peerId}. Expected: ${expectedCode}, Got: ${receivedCode}`
          );
          alert(
            `Encryption keys do NOT match for ${peerId}. Please ensure both users have refreshed and rejoined the meeting, or try generating a new QR code.`
          );
        } else {
          console.log(`✅ Key verification successful for ${peerId} via QR.`);
        }
        return isMatch;

      } else {
        // This block handles manual code input (no QR data)
        // This path is inherently less reliable without the original message components (timestamp, generator, target)
        // from the peer who generated the 'receivedCode'.
        console.warn(
          `🔐 Attempting manual key verification for ${peerId}. This method is less reliable than QR.`
        );
        alert(
          "Manual key verification is less reliable. Please try using the QR code method if available."
        );
        console.error(
          "❌ Fallback manual key verification is unreliable and likely to fail due to timestamp differences. Use QR codes."
        );
        this.verificationStatus.set(peerId, {
          verified: false,
          timestamp: Date.now(),
          method: "manual_fallback_attempt",
          receivedCode: receivedCode,
          error: "Manual verification is unreliable",
        });
        return false; // Mark as failed due to unreliability
      }
    } catch (error) {
      alert(
        `Key verification failed for ${peerId}. Please try again or refresh the page.`
      );
      console.error(`❌ Key verification failed for ${peerId}:`, error);
      this.verificationStatus.set(peerId, {
          verified: false,
          timestamp: Date.now(),
          error: error.message,
        });
      return false;
    }
  }

  async verifyQRData(qrDataString) {
    try {
      const qrData = JSON.parse(qrDataString);

      if (qrData.type !== "e2ee-verification") {
        throw new Error("Invalid QR code type");
      }

      // Check if QR code is not too old (e.g., 5 minutes)
      const age = Date.now() - qrData.timestamp;
      if (age > 5 * 60 * 1000) { // 5 minutes validity
        console.warn("⚠️ QR code is too old:", new Date(qrData.timestamp));
        alert("This QR code has expired. Please generate a new one.");
        return false;
      }

      // Call verifyKey with:
      // 1. peerId: qrData.userId (the user who generated the QR code)
      // 2. receivedCode: qrData.code (the code from the QR)
      // 3. receivedQrData: the full qrData object
      return await this.verifyKey(qrData.userId, qrData.code, qrData);
    } catch (error) {
      console.error("❌ QR verification failed:", error);
      alert(`QR code verification failed: ${error.message}`);
      return false;
    }
  }

  getVerificationStatus(userId) {
    return this.verificationStatus.get(userId) || { verified: false };
  }

  setVerificationCallback(userId, callback) {
    this.verificationCallbacks.set(userId, callback);
  }

  removeVerificationCallback(userId) {
    this.verificationCallbacks.delete(userId);
  }

  // Generate QR code data for key verification
  async generateQRData(userId) {
    try {
      const verification = await this.generateVerificationCode(userId);
      const qrData = {
        type: "e2ee-verification",
        userId: verification.userId,
        targetUserId: verification.targetUserId,
        code: verification.code,
        timestamp: verification.timestamp,
      };

      return JSON.stringify(qrData);
    } catch (error) {
      console.error(`❌ Failed to generate QR data for ${userId}:`, error);
      throw error;
    }
  }

  // Verify QR code data
  async verifyQRData(qrDataString) {
    try {
      const qrData = JSON.parse(qrDataString);

      if (qrData.type !== "e2ee-verification") {
        throw new Error("Invalid QR code type");
      }

      // Check if QR code is not too old (5 minutes)
      const age = Date.now() - qrData.timestamp;
      if (age > 5 * 60 * 1000) {
        throw new Error("QR code is too old");
      }

      return await this.verifyKey(qrData.targetUserId, qrData.code, qrData);
    } catch (error) {
      console.error("❌ QR verification failed:", error);
      return false;
    }
  }

  // Get all verification statuses
  getAllVerificationStatuses() {
    const statuses = {};
    for (const [userId, status] of this.verificationStatus) {
      statuses[userId] = status;
    }
    return statuses;
  }

  // Check if all participants are verified
  areAllParticipantsVerified() {
    const participants = this.e2eeManager.participants;
    for (const userId of participants) {
      const status = this.getVerificationStatus(userId);
      if (!status.verified) {
        return false;
      }
    }
    return true;
  }

  // Clear verification status for a user
  clearVerification(userId) {
    this.verificationStatus.delete(userId);
    this.verificationCallbacks.delete(userId);
  }

  // Clear all verification statuses
  clearAllVerifications() {
    this.verificationStatus.clear();
    this.verificationCallbacks.clear();
  }
}
