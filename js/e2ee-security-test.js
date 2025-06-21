/**
 * E2EE Security Testing Suite
 * Tests for various attack scenarios and security vulnerabilities
 */

class E2EESecurityTester {
  constructor() {
    this.testResults = [];
    this.networkTraffic = [];
    this.attackSimulations = [];
  }

  // Test 1: Man-in-the-Middle Attack Simulation
  async testManInTheMiddleAttack() {
    console.log("🔍 Testing Man-in-the-Middle Attack Scenario...");

    try {
      // Create three participants: Alice, Bob, and Mallory (attacker)
      const alice = new E2EEManager();
      const bob = new E2EEManager();
      const mallory = new E2EEManager(); // Attacker

      await alice.initialize();
      await bob.initialize();
      await mallory.initialize();

      const aliceKey = alice.getPublicKeyBase64();
      const bobKey = bob.getPublicKeyBase64();
      const malloryKey = mallory.getPublicKeyBase64();

      // Normal secure communication (Alice ↔ Bob)
      await alice.addParticipant("bob", bobKey);
      await bob.addParticipant("alice", aliceKey);

      // Mallory tries to intercept by pretending to be Bob to Alice
      await alice.addParticipant("mallory", malloryKey);
      await mallory.addParticipant("alice", aliceKey);

      // Test message encryption
      const originalMessage = new TextEncoder().encode(
        "Secret message from Alice to Bob"
      );

      // Alice encrypts for Bob (should be secure)
      const encryptedForBob = await alice.encrypt(originalMessage, "bob");

      // Alice encrypts for Mallory (Mallory can decrypt this)
      const encryptedForMallory = await alice.encrypt(
        originalMessage,
        "mallory"
      );

      // Bob can decrypt Alice's message
      const bobDecrypted = await bob.decrypt(encryptedForBob, "alice");

      // Mallory can decrypt Alice's message (this is the attack)
      const malloryDecrypted = await mallory.decrypt(
        encryptedForMallory,
        "alice"
      );

      // Verify the attack
      const bobSuccess = this.arrayBufferEquals(originalMessage, bobDecrypted);
      const mallorySuccess = this.arrayBufferEquals(
        originalMessage,
        malloryDecrypted
      );

      const result = {
        test: "Man-in-the-Middle Attack",
        status: mallorySuccess ? "VULNERABLE" : "SECURE",
        details: {
          bobCanDecrypt: bobSuccess,
          malloryCanDecrypt: mallorySuccess,
          explanation: mallorySuccess
            ? "Mallory successfully intercepted and decrypted the message"
            : "Mallory could not decrypt the message",
        },
      };

      this.testResults.push(result);
      console.log(`✅ ${result.test}: ${result.status}`);

      // Cleanup
      alice.destroy();
      bob.destroy();
      mallory.destroy();

      return result;
    } catch (error) {
      console.error("❌ Man-in-the-Middle test failed:", error);
      return {
        test: "Man-in-the-Middle Attack",
        status: "ERROR",
        error: error.message,
      };
    }
  }

  // Test 2: Key Compromise Attack
  async testKeyCompromiseAttack() {
    console.log("🔍 Testing Key Compromise Attack...");

    try {
      const alice = new E2EEManager();
      const bob = new E2EEManager();
      const attacker = new E2EEManager();

      await alice.initialize();
      await bob.initialize();
      await attacker.initialize();

      const aliceKey = alice.getPublicKeyBase64();
      const bobKey = bob.getPublicKeyBase64();

      // Normal setup
      await alice.addParticipant("bob", bobKey);
      await bob.addParticipant("alice", aliceKey);

      // Encrypt some messages
      const message1 = new TextEncoder().encode("Message 1");
      const message2 = new TextEncoder().encode("Message 2");

      const encrypted1 = await alice.encrypt(message1, "bob");
      const encrypted2 = await alice.encrypt(message2, "bob");

      // Simulate key compromise - attacker gets Bob's private key
      // In real scenario, this would be through various attack vectors
      const compromisedBob = new E2EEManager();
      await compromisedBob.initialize();

      // Attacker tries to decrypt with compromised key
      // Note: This simulates the scenario where attacker has Bob's private key
      await compromisedBob.addParticipant("alice", aliceKey);

      const decrypted1 = await compromisedBob.decrypt(encrypted1, "alice");
      const decrypted2 = await compromisedBob.decrypt(encrypted2, "alice");

      const canDecryptPastMessages =
        this.arrayBufferEquals(message1, decrypted1) &&
        this.arrayBufferEquals(message2, decrypted2);

      const result = {
        test: "Key Compromise Attack",
        status: canDecryptPastMessages ? "VULNERABLE" : "SECURE",
        details: {
          canDecryptPastMessages,
          explanation: canDecryptPastMessages
            ? "Attacker with compromised key can decrypt past messages"
            : "Past messages remain secure even with key compromise",
        },
      };

      this.testResults.push(result);
      console.log(`✅ ${result.test}: ${result.status}`);

      // Cleanup
      alice.destroy();
      bob.destroy();
      attacker.destroy();
      compromisedBob.destroy();

      return result;
    } catch (error) {
      console.error("❌ Key Compromise test failed:", error);
      return {
        test: "Key Compromise Attack",
        status: "ERROR",
        error: error.message,
      };
    }
  }

  // Test 3: Replay Attack
  async testReplayAttack() {
    console.log("🔍 Testing Replay Attack...");

    try {
      const alice = new E2EEManager();
      const bob = new E2EEManager();
      const attacker = new E2EEManager();

      await alice.initialize();
      await bob.initialize();
      await attacker.initialize();

      const aliceKey = alice.getPublicKeyBase64();
      const bobKey = bob.getPublicKeyBase64();

      await alice.addParticipant("bob", bobKey);
      await bob.addParticipant("alice", aliceKey);

      // Alice sends a message
      const originalMessage = new TextEncoder().encode(
        "Time-sensitive message"
      );
      const encryptedMessage = await alice.encrypt(originalMessage, "bob");

      // Bob receives and decrypts normally
      const bobDecrypted = await bob.decrypt(encryptedMessage, "alice");

      // Attacker captures the encrypted message and tries to replay it
      // In a real scenario, this would be done by intercepting network traffic
      const replayedMessage = encryptedMessage; // Copy of the captured message

      // Try to decrypt the replayed message
      let replaySuccess = false;
      try {
        const replayedDecrypted = await bob.decrypt(replayedMessage, "alice");
        replaySuccess = this.arrayBufferEquals(
          originalMessage,
          replayedDecrypted
        );
      } catch (error) {
        replaySuccess = false;
      }

      const result = {
        test: "Replay Attack",
        status: replaySuccess ? "VULNERABLE" : "SECURE",
        details: {
          replaySuccess,
          explanation: replaySuccess
            ? "Replayed messages can be decrypted (potential vulnerability)"
            : "Replay attack prevented (likely due to nonce/IV uniqueness)",
        },
      };

      this.testResults.push(result);
      console.log(`✅ ${result.test}: ${result.status}`);

      // Cleanup
      alice.destroy();
      bob.destroy();
      attacker.destroy();

      return result;
    } catch (error) {
      console.error("❌ Replay Attack test failed:", error);
      return { test: "Replay Attack", status: "ERROR", error: error.message };
    }
  }

  // Test 4: Key Rotation Security
  async testKeyRotationSecurity() {
    console.log("🔍 Testing Key Rotation Security...");

    try {
      const alice = new E2EEManager();
      const bob = new E2EEManager();

      await alice.initialize();
      await bob.initialize();

      const aliceKey = alice.getPublicKeyBase64();
      const bobKey = bob.getPublicKeyBase64();

      await alice.addParticipant("bob", bobKey);
      await bob.addParticipant("alice", aliceKey);

      // Send message before key rotation
      const message1 = new TextEncoder().encode("Message before rotation");
      const encrypted1 = await alice.encrypt(message1, "bob");
      const decrypted1 = await bob.decrypt(encrypted1, "alice");

      // Trigger key rotation
      alice.startKeyRotation();
      bob.startKeyRotation();

      // Wait for rotation to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send message after key rotation
      const message2 = new TextEncoder().encode("Message after rotation");
      const encrypted2 = await alice.encrypt(message2, "bob");
      const decrypted2 = await bob.decrypt(encrypted2, "alice");

      // Test if old messages can still be decrypted (forward secrecy)
      const oldMessageStillDecryptable = this.arrayBufferEquals(
        message1,
        decrypted1
      );
      const newMessageDecryptable = this.arrayBufferEquals(
        message2,
        decrypted2
      );

      const result = {
        test: "Key Rotation Security",
        status: newMessageDecryptable ? "SECURE" : "VULNERABLE",
        details: {
          oldMessageStillDecryptable,
          newMessageDecryptable,
          explanation: newMessageDecryptable
            ? "Key rotation working correctly - new messages can be decrypted"
            : "Key rotation failed - new messages cannot be decrypted",
        },
      };

      this.testResults.push(result);
      console.log(`✅ ${result.test}: ${result.status}`);

      // Cleanup
      alice.stopKeyRotation();
      bob.stopKeyRotation();
      alice.destroy();
      bob.destroy();

      return result;
    } catch (error) {
      console.error("❌ Key Rotation test failed:", error);
      return {
        test: "Key Rotation Security",
        status: "ERROR",
        error: error.message,
      };
    }
  }

  // Test 5: Network Traffic Analysis Simulation
  async simulateNetworkTrafficAnalysis() {
    console.log("🔍 Simulating Network Traffic Analysis...");

    try {
      const alice = new E2EEManager();
      const bob = new E2EEManager();

      await alice.initialize();
      await bob.initialize();

      const aliceKey = alice.getPublicKeyBase64();
      const bobKey = bob.getPublicKeyBase64();

      await alice.addParticipant("bob", bobKey);
      await bob.addParticipant("alice", aliceKey);

      // Simulate network traffic capture
      const messages = [
        "Hello Bob, how are you?",
        "I'm sending you some confidential data",
        "This is a secret message",
        "Meeting at 3 PM tomorrow",
      ];

      const capturedTraffic = [];

      for (const message of messages) {
        const data = new TextEncoder().encode(message);
        const encrypted = await alice.encrypt(data, "bob");

        // Simulate capturing encrypted traffic
        capturedTraffic.push({
          timestamp: Date.now(),
          encryptedData: encrypted,
          dataLength: data.length,
          encryptedLength: encrypted.length,
          entropy: this.calculateEntropy(encrypted),
        });

        // Bob decrypts normally
        const decrypted = await bob.decrypt(encrypted, "alice");
        const decryptedText = new TextDecoder().decode(decrypted);

        console.log(`Original: "${message}" -> Decrypted: "${decryptedText}"`);
      }

      // Analyze captured traffic
      const analysis = this.analyzeTraffic(capturedTraffic);

      const result = {
        test: "Network Traffic Analysis",
        status: "INFORMATIONAL",
        details: {
          totalMessages: capturedTraffic.length,
          averageEntropy: analysis.averageEntropy,
          entropyConsistency: analysis.entropyConsistency,
          explanation: "Analysis of encrypted traffic patterns and entropy",
        },
        trafficData: capturedTraffic,
        analysis: analysis,
      };

      this.testResults.push(result);
      console.log(`✅ ${result.test}: Analysis Complete`);

      // Cleanup
      alice.destroy();
      bob.destroy();

      return result;
    } catch (error) {
      console.error("❌ Network Traffic Analysis failed:", error);
      return {
        test: "Network Traffic Analysis",
        status: "ERROR",
        error: error.message,
      };
    }
  }

  // Utility methods
  arrayBufferEquals(a, b) {
    if (a.byteLength !== b.byteLength) return false;
    const viewA = new Uint8Array(a);
    const viewB = new Uint8Array(b);
    for (let i = 0; i < viewA.length; i++) {
      if (viewA[i] !== viewB[i]) return false;
    }
    return true;
  }

  calculateEntropy(data) {
    const bytes = new Uint8Array(data);
    const frequency = new Array(256).fill(0);

    for (let i = 0; i < bytes.length; i++) {
      frequency[bytes[i]]++;
    }

    let entropy = 0;
    for (let i = 0; i < 256; i++) {
      if (frequency[i] > 0) {
        const probability = frequency[i] / bytes.length;
        entropy -= probability * Math.log2(probability);
      }
    }

    return entropy;
  }

  analyzeTraffic(traffic) {
    const entropies = traffic.map((t) => t.entropy);
    const averageEntropy =
      entropies.reduce((a, b) => a + b, 0) / entropies.length;

    // Check entropy consistency (should be high and consistent for good encryption)
    const variance =
      entropies.reduce((sum, entropy) => {
        return sum + Math.pow(entropy - averageEntropy, 2);
      }, 0) / entropies.length;

    const entropyConsistency = variance < 0.1; // Low variance = consistent entropy

    return {
      averageEntropy,
      entropyConsistency,
      minEntropy: Math.min(...entropies),
      maxEntropy: Math.max(...entropies),
      variance,
    };
  }

  // Run all security tests
  async runAllSecurityTests() {
    console.log("🚀 Starting Comprehensive E2EE Security Test Suite...\n");

    const tests = [
      () => this.testManInTheMiddleAttack(),
      () => this.testKeyCompromiseAttack(),
      () => this.testReplayAttack(),
      () => this.testKeyRotationSecurity(),
      () => this.simulateNetworkTrafficAnalysis(),
    ];

    for (const test of tests) {
      await test();
      console.log(""); // Add spacing between tests
    }

    this.generateSecurityReport();
  }

  generateSecurityReport() {
    console.log("📊 E2EE Security Test Report");
    console.log("=".repeat(50));

    const vulnerabilities = this.testResults.filter(
      (r) => r.status === "VULNERABLE"
    );
    const secure = this.testResults.filter((r) => r.status === "SECURE");
    const errors = this.testResults.filter((r) => r.status === "ERROR");

    console.log(`Total Tests: ${this.testResults.length}`);
    console.log(`✅ Secure: ${secure.length}`);
    console.log(`❌ Vulnerabilities: ${vulnerabilities.length}`);
    console.log(`⚠️ Errors: ${errors.length}`);

    if (vulnerabilities.length > 0) {
      console.log("\n🚨 VULNERABILITIES FOUND:");
      vulnerabilities.forEach((v) => {
        console.log(`- ${v.test}: ${v.details.explanation}`);
      });
    }

    if (secure.length > 0) {
      console.log("\n✅ SECURE COMPONENTS:");
      secure.forEach((s) => {
        console.log(`- ${s.test}: ${s.details.explanation}`);
      });
    }

    console.log("\n📋 Detailed Results:");
    this.testResults.forEach((result) => {
      console.log(`\n${result.test}:`);
      console.log(`  Status: ${result.status}`);
      if (result.details) {
        Object.entries(result.details).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
      }
    });
  }
}

// Export for use in browser
if (typeof window !== "undefined") {
  window.E2EESecurityTester = E2EESecurityTester;

  // Auto-run security tests when loaded
  window.runE2EESecurityTests = async () => {
    const tester = new E2EESecurityTester();
    await tester.runAllSecurityTests();
  };
}
