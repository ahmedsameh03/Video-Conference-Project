class KeyVerification {
  constructor(e2eeManager) {
    this.e2eeManager = e2eeManager;
    this.verificationStatus = new Map(); // userId -> verification status
    this.verificationCallbacks = new Map(); // userId -> callback functions
  }

  async generateVerificationCode(userId) {
    try {
      const sessionKey = this.e2eeManager.sessionKeys.get(userId);
      if (!sessionKey) {
        throw new Error(`No session key found for user ${userId}`);
      }

      // Generate a random verification message
      const verificationMessage = `VERIFY-${userId}-${Date.now()}`;
      const messageBuffer = new TextEncoder().encode(verificationMessage);

      // Encrypt the message
      const encrypted = await this.e2eeManager.encrypt(messageBuffer, userId);

      // Create a hash of the encrypted data for verification
      const hash = await window.crypto.subtle.digest("SHA-256", encrypted);

      // Convert to base64 and take first 8 characters
      const hashArray = new Uint8Array(hash);
      const hashBase64 = btoa(String.fromCharCode(...hashArray));
      const verificationCode = hashBase64.substring(0, 8).toUpperCase();

      return {
        code: verificationCode,
        message: verificationMessage,
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error(
        `❌ Failed to generate verification code for ${userId}:`,
        error
      );
      throw error;
    }
  }

  async verifyKey(userId, verificationCode) {
    try {
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
        userId: userId,
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

      return await this.verifyKey(qrData.userId, qrData.code);
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
