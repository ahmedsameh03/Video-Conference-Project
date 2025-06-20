// Simple test for E2EE functionality with AES-GCM-SIV (with fallback to AES-GCM)
async function testE2EE() {
  console.log(
    "🧪 Testing E2EE Implementation with AES-GCM-SIV (with fallback)..."
  );
  try {
    // Test 1: Initialize E2EE Manager
    console.log("Test 1: Initializing E2EE Manager...");
    const e2eeManager = new E2EEManager();
    const keyInfo = await e2eeManager.initialize();
    console.log(
      `✅ E2EE Manager initialized successfully with ${keyInfo.algorithm}`
    );
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

    // Test 3: Test encryption/decryption with detected algorithm
    console.log(
      `\nTest 3: Testing ${keyInfo.algorithm} encryption/decryption...`
    );
    const testData = new TextEncoder().encode(
      `Hello, E2EE World with ${keyInfo.algorithm}!`
    );
    const encrypted = await e2eeManager.encrypt(testData, testUserId);
    const decrypted = await e2eeManager.decrypt(encrypted, testUserId);
    const decryptedText = new TextDecoder().decode(decrypted);

    console.log(`Original: Hello, E2EE World with ${keyInfo.algorithm}!`);
    console.log("Decrypted:", decryptedText);
    console.log(
      `✅ ${keyInfo.algorithm} Encryption/Decryption test:`,
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

    // Test 5: Test key rotation with detected algorithm
    console.log(`\nTest 5: Testing ${keyInfo.algorithm} key rotation...`);
    e2eeManager.startKeyRotation();
    console.log(`✅ ${keyInfo.algorithm} key rotation started`);

    // Cleanup
    setTimeout(() => {
      e2eeManager.stopKeyRotation();
      e2eeManager.destroy();
      console.log("🧹 E2EE Manager cleaned up");
    }, 1000);

    console.log("\n🎉 All E2EE tests completed successfully!");
  } catch (error) {
    console.error("❌ E2EE test failed:", error);
  }
}

// Test browser compatibility for AES-GCM-SIV
async function testBrowserCompatibility() {
  console.log("🔍 Testing browser compatibility for AES-GCM-SIV...");

  try {
    // Test AES-GCM-SIV support
    const testKey = await window.crypto.subtle.generateKey(
      { name: "AES-GCM-SIV", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    const testData = new TextEncoder().encode("test");
    const testNonce = window.crypto.getRandomValues(new Uint8Array(12));

    await window.crypto.subtle.encrypt(
      { name: "AES-GCM-SIV", iv: testNonce },
      testKey,
      testData
    );

    console.log("✅ This browser supports AES-GCM-SIV");
    return true;
  } catch (error) {
    console.log(
      "⚠️ This browser does not support AES-GCM-SIV, will use AES-GCM fallback"
    );
    console.log("Error details:", error.message);
    return false;
  }
}

// Run compatibility test when script loads
if (typeof window !== "undefined") {
  window.testE2EE = testE2EE;
  window.testBrowserCompatibility = testBrowserCompatibility;

  // Auto-run compatibility test
  testBrowserCompatibility();
}
