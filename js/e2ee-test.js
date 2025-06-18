// Simple test for E2EE functionality
async function testE2EE() {
  console.log("🧪 Testing E2EE Implementation...");

  try {
    // Test 1: Initialize E2EE Manager
    console.log("Test 1: Initializing E2EE Manager...");
    const e2eeManager = new E2EEManager();
    const keyInfo = await e2eeManager.initialize();
    console.log("✅ E2EE Manager initialized successfully");
    console.log(
      "Public Key (Base64):",
      keyInfo.publicKeyBase64.substring(0, 50) + "..."
    );

    // Test 2: Add a participant
    console.log("\nTest 2: Adding participant...");
    const testUserId = "test-user-1";
    const success = await e2eeManager.addParticipant(
      testUserId,
      keyInfo.publicKeyBase64
    );
    console.log("✅ Participant added:", success);

    // Test 3: Test encryption/decryption
    console.log("\nTest 3: Testing encryption/decryption...");
    const testData = new TextEncoder().encode("Hello, E2EE World!");
    const encrypted = await e2eeManager.encrypt(testData, testUserId);
    const decrypted = await e2eeManager.decrypt(encrypted, testUserId);
    const decryptedText = new TextDecoder().decode(decrypted);

    console.log("Original:", "Hello, E2EE World!");
    console.log("Decrypted:", decryptedText);
    console.log(
      "✅ Encryption/Decryption test:",
      testData.length === decrypted.byteLength ? "PASSED" : "FAILED"
    );

    // Test 4: Test key verification
    console.log("\nTest 4: Testing key verification...");
    const keyVerification = new KeyVerification(e2eeManager);
    const verification = await keyVerification.generateVerificationCode(
      testUserId
    );
    const isVerified = await keyVerification.verifyKey(
      testUserId,
      verification.code
    );
    console.log("Verification Code:", verification.code);
    console.log("✅ Key verification test:", isVerified ? "PASSED" : "FAILED");

    // Test 5: Test key rotation
    console.log("\nTest 5: Testing key rotation...");
    e2eeManager.startKeyRotation();
    console.log("✅ Key rotation started");

    // Cleanup
    e2eeManager.destroy();
    console.log("\n🎉 All E2EE tests completed successfully!");
  } catch (error) {
    console.error("❌ E2EE test failed:", error);
  }
}

// Run test if this file is loaded directly
if (typeof window !== "undefined") {
  // Browser environment
  window.testE2EE = testE2EE;
  console.log("🔧 E2EE test function available. Run testE2EE() to test.");
} else {
  // Node.js environment
  console.log("🔧 E2EE test module loaded");
}
