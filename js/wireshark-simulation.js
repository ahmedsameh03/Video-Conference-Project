/**
 * Wireshark-like Network Traffic Analysis Tool
 * Simulates capturing and analyzing encrypted WebRTC traffic
 */

class WiresharkSimulator {
  constructor() {
    this.capturedPackets = [];
    this.analysisResults = {};
    this.trafficPatterns = {};
    this.suspiciousActivities = [];
  }

  // Simulate packet capture
  capturePacket(packet) {
    const capturedPacket = {
      timestamp: Date.now(),
      source: packet.source,
      destination: packet.destination,
      protocol: packet.protocol || "WebRTC",
      dataLength: packet.data ? packet.data.length : 0,
      encryptedData: packet.encryptedData,
      packetType: packet.type || "data",
      sequenceNumber: this.capturedPackets.length + 1,
      metadata: packet.metadata || {},
    };

    this.capturedPackets.push(capturedPacket);
    return capturedPacket;
  }

  // Simulate capturing E2EE traffic
  async captureE2EETraffic(e2eeManager, participants, duration = 10000) {
    console.log("📡 Starting E2EE traffic capture simulation...");

    const startTime = Date.now();
    const messages = [
      "Hello, this is a test message",
      "Sending confidential data",
      "Meeting details for tomorrow",
      "Password: secret123",
      "Credit card: 1234-5678-9012-3456",
      "SSN: 123-45-6789",
      "API Key: sk-1234567890abcdef",
      "Database connection string",
      "User credentials",
      "Financial information",
    ];

    const captureInterval = setInterval(async () => {
      if (Date.now() - startTime > duration) {
        clearInterval(captureInterval);
        this.analyzeCapturedTraffic();
        return;
      }

      // Simulate random message sending
      const sender =
        participants[Math.floor(Math.random() * participants.length)];
      const receiver =
        participants[Math.floor(Math.random() * participants.length)];

      if (sender !== receiver) {
        const message = messages[Math.floor(Math.random() * messages.length)];
        const data = new TextEncoder().encode(message);

        try {
          const encryptedData = await e2eeManager.encrypt(data, receiver);

          // Capture the packet
          const packet = {
            source: sender,
            destination: receiver,
            protocol: "WebRTC-E2EE",
            data: data,
            encryptedData: encryptedData,
            type: "encrypted_message",
            metadata: {
              originalLength: data.length,
              encryptedLength: encryptedData.length,
              compressionRatio: encryptedData.length / data.length,
              entropy: this.calculateEntropy(encryptedData),
            },
          };

          this.capturePacket(packet);

          // Simulate network delay
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * 100)
          );
        } catch (error) {
          console.error(
            `Failed to encrypt message from ${sender} to ${receiver}:`,
            error
          );
        }
      }
    }, 500); // Capture every 500ms
  }

  // Analyze captured traffic for security insights
  analyzeCapturedTraffic() {
    console.log("🔍 Analyzing captured E2EE traffic...");

    if (this.capturedPackets.length === 0) {
      console.log("No packets captured for analysis");
      return;
    }

    // Basic statistics
    this.analysisResults.basicStats = {
      totalPackets: this.capturedPackets.length,
      totalDataSize: this.capturedPackets.reduce(
        (sum, p) => sum + p.dataLength,
        0
      ),
      totalEncryptedSize: this.capturedPackets.reduce(
        (sum, p) => sum + (p.encryptedData ? p.encryptedData.length : 0),
        0
      ),
      averagePacketSize:
        this.capturedPackets.reduce((sum, p) => sum + p.dataLength, 0) /
        this.capturedPackets.length,
      captureDuration:
        this.capturedPackets[this.capturedPackets.length - 1].timestamp -
        this.capturedPackets[0].timestamp,
    };

    // Entropy analysis
    const entropies = this.capturedPackets
      .filter((p) => p.encryptedData)
      .map((p) => p.metadata.entropy);

    this.analysisResults.entropyAnalysis = {
      averageEntropy: entropies.reduce((a, b) => a + b, 0) / entropies.length,
      minEntropy: Math.min(...entropies),
      maxEntropy: Math.max(...entropies),
      entropyVariance: this.calculateVariance(entropies),
      isRandom: this.analysisResults.basicStats.averageEntropy > 7.5, // Good encryption should have high entropy
    };

    // Traffic patterns
    this.analyzeTrafficPatterns();

    // Security analysis
    this.performSecurityAnalysis();

    // Generate Wireshark-like report
    this.generateWiresharkReport();
  }

  // Analyze traffic patterns
  analyzeTrafficPatterns() {
    const patterns = {};

    // Analyze by source/destination
    this.capturedPackets.forEach((packet) => {
      const key = `${packet.source}->${packet.destination}`;
      if (!patterns[key]) {
        patterns[key] = {
          count: 0,
          totalSize: 0,
          averageSize: 0,
          timestamps: [],
        };
      }

      patterns[key].count++;
      patterns[key].totalSize += packet.dataLength;
      patterns[key].timestamps.push(packet.timestamp);
    });

    // Calculate averages and intervals
    Object.keys(patterns).forEach((key) => {
      patterns[key].averageSize = patterns[key].totalSize / patterns[key].count;

      // Calculate time intervals between packets
      const intervals = [];
      for (let i = 1; i < patterns[key].timestamps.length; i++) {
        intervals.push(
          patterns[key].timestamps[i] - patterns[key].timestamps[i - 1]
        );
      }
      patterns[key].averageInterval =
        intervals.length > 0
          ? intervals.reduce((a, b) => a + b, 0) / intervals.length
          : 0;
    });

    this.trafficPatterns = patterns;
  }

  // Perform security analysis
  performSecurityAnalysis() {
    const securityIssues = [];

    // Check for suspicious patterns
    Object.entries(this.trafficPatterns).forEach(([connection, pattern]) => {
      // Check for unusually large packets
      if (pattern.averageSize > 10000) {
        securityIssues.push({
          type: "LARGE_PACKETS",
          connection: connection,
          description: `Unusually large average packet size: ${pattern.averageSize} bytes`,
          severity: "MEDIUM",
        });
      }

      // Check for rapid-fire communication
      if (pattern.averageInterval < 50) {
        securityIssues.push({
          type: "RAPID_COMMUNICATION",
          connection: connection,
          description: `Very rapid communication: ${pattern.averageInterval}ms intervals`,
          severity: "LOW",
        });
      }
    });

    // Check for entropy anomalies
    const lowEntropyPackets = this.capturedPackets.filter(
      (p) => p.metadata.entropy && p.metadata.entropy < 6.0
    );

    if (lowEntropyPackets.length > 0) {
      securityIssues.push({
        type: "LOW_ENTROPY",
        count: lowEntropyPackets.length,
        description: `${lowEntropyPackets.length} packets with suspiciously low entropy`,
        severity: "HIGH",
      });
    }

    // Check for repeated patterns
    const packetSizes = this.capturedPackets.map((p) => p.dataLength);
    const sizeFrequency = {};
    packetSizes.forEach((size) => {
      sizeFrequency[size] = (sizeFrequency[size] || 0) + 1;
    });

    const repeatedSizes = Object.entries(sizeFrequency)
      .filter(([size, count]) => count > 3)
      .map(([size, count]) => ({ size: parseInt(size), count }));

    if (repeatedSizes.length > 0) {
      securityIssues.push({
        type: "REPEATED_PATTERNS",
        patterns: repeatedSizes,
        description:
          "Repeated packet sizes detected (potential pattern leakage)",
        severity: "MEDIUM",
      });
    }

    this.suspiciousActivities = securityIssues;
  }

  // Generate Wireshark-like report
  generateWiresharkReport() {
    console.log("\n📊 Wireshark-like E2EE Traffic Analysis Report");
    console.log("=".repeat(60));

    // Summary
    console.log("\n📈 TRAFFIC SUMMARY:");
    console.log(
      `Total Packets Captured: ${this.analysisResults.basicStats.totalPackets}`
    );
    console.log(
      `Capture Duration: ${this.analysisResults.basicStats.captureDuration}ms`
    );
    console.log(
      `Total Data Size: ${this.analysisResults.basicStats.totalDataSize} bytes`
    );
    console.log(
      `Total Encrypted Size: ${this.analysisResults.basicStats.totalEncryptedSize} bytes`
    );
    console.log(
      `Average Packet Size: ${this.analysisResults.basicStats.averagePacketSize.toFixed(
        2
      )} bytes`
    );

    // Entropy Analysis
    console.log("\n🔐 ENCRYPTION QUALITY:");
    console.log(
      `Average Entropy: ${this.analysisResults.entropyAnalysis.averageEntropy.toFixed(
        2
      )} bits`
    );
    console.log(
      `Entropy Range: ${this.analysisResults.entropyAnalysis.minEntropy.toFixed(
        2
      )} - ${this.analysisResults.entropyAnalysis.maxEntropy.toFixed(2)} bits`
    );
    console.log(
      `Entropy Variance: ${this.analysisResults.entropyAnalysis.entropyVariance.toFixed(
        4
      )}`
    );
    console.log(
      `Randomness Quality: ${
        this.analysisResults.entropyAnalysis.isRandom
          ? "✅ GOOD"
          : "⚠️ SUSPICIOUS"
      }`
    );

    // Traffic Patterns
    console.log("\n🌐 TRAFFIC PATTERNS:");
    Object.entries(this.trafficPatterns).forEach(([connection, pattern]) => {
      console.log(`${connection}:`);
      console.log(`  Packets: ${pattern.count}`);
      console.log(`  Total Size: ${pattern.totalSize} bytes`);
      console.log(`  Average Size: ${pattern.averageSize.toFixed(2)} bytes`);
      console.log(
        `  Average Interval: ${pattern.averageInterval.toFixed(2)}ms`
      );
    });

    // Security Issues
    if (this.suspiciousActivities.length > 0) {
      console.log("\n🚨 SECURITY ALERTS:");
      this.suspiciousActivities.forEach((issue) => {
        const severityIcon = {
          HIGH: "🔴",
          MEDIUM: "🟡",
          LOW: "🟢",
        };
        console.log(
          `${severityIcon[issue.severity]} ${issue.type}: ${issue.description}`
        );
      });
    } else {
      console.log("\n✅ No security issues detected");
    }

    // Packet Details (first 10 packets)
    console.log("\n📦 PACKET DETAILS (First 10):");
    this.capturedPackets.slice(0, 10).forEach((packet) => {
      console.log(
        `#${packet.sequenceNumber} ${packet.timestamp} ${packet.source} -> ${packet.destination}`
      );
      console.log(`  Protocol: ${packet.protocol}`);
      console.log(`  Size: ${packet.dataLength} bytes`);
      console.log(
        `  Encrypted: ${
          packet.encryptedData ? packet.encryptedData.length : 0
        } bytes`
      );
      if (packet.metadata.entropy) {
        console.log(`  Entropy: ${packet.metadata.entropy.toFixed(2)} bits`);
      }
    });
  }

  // Export captured data for external analysis
  exportCaptureData() {
    return {
      packets: this.capturedPackets,
      analysis: this.analysisResults,
      patterns: this.trafficPatterns,
      securityIssues: this.suspiciousActivities,
      exportTime: Date.now(),
    };
  }

  // Utility methods
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

  calculateVariance(values) {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return (
      values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
      values.length
    );
  }

  // Clear captured data
  clearCapture() {
    this.capturedPackets = [];
    this.analysisResults = {};
    this.trafficPatterns = {};
    this.suspiciousActivities = [];
    console.log("🧹 Captured data cleared");
  }
}

// Export for use in browser
if (typeof window !== "undefined") {
  window.WiresharkSimulator = WiresharkSimulator;

  // Helper function to run Wireshark simulation
  window.runWiresharkSimulation = async (
    e2eeManager,
    participants,
    duration = 10000
  ) => {
    const wireshark = new WiresharkSimulator();
    await wireshark.captureE2EETraffic(e2eeManager, participants, duration);
    return wireshark;
  };
}
