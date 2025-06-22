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

  async verifyKey(userId, verificationCode, qrData = null) {
    try {
      console.log(
        `🔐 Verifying key for ${userId} with code: ${verificationCode}`
      );
      console.log(`🔐 QR data:`, qrData);

      // If we have QR data, use it for verification
      if (qrData && qrData.userId && qrData.targetUserId) {
        // Verify that the QR code is for the correct user
        if (qrData.targetUserId !== userId) {
          console.error(
            `❌ QR code target user (${qrData.targetUserId}) doesn't match expected user (${userId})`
          );
          return false;
        }

        // Get the shared secret for this user
        const sharedSecret = this.e2eeManager.sharedSecrets.get(userId);
        if (!sharedSecret) {
          throw new Error(`No shared secret found for user ${userId}`);
        }

        // Recreate the verification message from QR data
        const verificationMessage = `VERIFY-${qrData.userId}-${qrData.targetUserId}-${qrData.timestamp}`;
        console.log(
          `🔐 Recreated verification message: ${verificationMessage}`
        );

        // Create the same hash as the generator
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
        const expectedCode = hashBase64.substring(0, 8).toUpperCase();

        console.log(
          `🔐 Expected code: ${expectedCode}, Received code: ${verificationCode}`
        );

        const isMatch = expectedCode === verificationCode.toUpperCase();

        this.verificationStatus.set(userId, {
          verified: isMatch,
          timestamp: Date.now(),
          code: verificationCode,
          qrData: qrData,
        });

        if (!isMatch) {
          console.error(
            `❌ Key verification failed for ${userId}. Expected: ${expectedCode}, Got: ${verificationCode}`
          );
          alert(
            `Encryption keys do not match for ${userId}. Please ensure both users have refreshed and rejoined the meeting.`
          );
        } else {
          console.log(`✅ Key verification successful for ${userId}`);
        }

        return isMatch;
      } else {
        // Fallback to old method for backward compatibility
        console.log(`🔐 Using fallback verification method for ${userId}`);
        const generated = await this.generateVerificationCode(userId);
        const isMatch = generated.code === verificationCode.toUpperCase();
        this.verificationStatus.set(userId, {
          verified: isMatch,
          timestamp: Date.now(),
          code: verificationCode,
        });
        if (!isMatch) {
          alert(
            `Encryption keys do not match for ${userId}. Please ensure both users have refreshed and rejoined the meeting.`
          );
        }
        return isMatch;
      }
    } catch (error) {
      alert(
        `Key verification failed for ${userId}. Please try again or refresh the page.`
      );
      console.error(`❌ Key verification failed for ${userId}:`, error);
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
