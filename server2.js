const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config(); // Load environment variables

const app = express(); // Initialize app first
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Middleware to parse JSON

let otpStorage = {}; // Temporary storage for OTPs

// ✅ Validate environment variables
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("❌ Missing EMAIL_USER or EMAIL_PASS in environment variables.");
    process.exit(1); // Exit process if config is incorrect
}

// ✅ Email Transporter Configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    debug: true, // Enable debug mode
    logger: true  // Log SMTP transactions
});

// ✅ Verify Email Transporter Configuration
transporter.verify((error, success) => {
    if (error) {
        console.error("❌ Email config error:", error);
    } else {
        console.log("✅ Email server is ready to send messages.");
    }
});


// ✅ API to Send OTP
app.post('/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        console.error("❌ Error: Email is required!");
        return res.status(400).json({ message: "Email is required" });
    }

    const otp = Math.floor(1000 + Math.random() * 9000); // Generate a 4-digit OTP
    otpStorage[email] = otp;

    console.log(`📩 Sending OTP ${otp} to ${email}...`);

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Your OTP Code',
        text: `Your OTP code is ${otp}. It is valid for 5 minutes.`
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ OTP sent successfully to ${email}`);
        console.log("📬 Message ID:", info.messageId);
        console.log("📜 Response:", info.response);
        res.json({ message: "OTP sent successfully!" });
    } catch (error) {
        console.error("❌ Failed to send OTP:", error);
        res.status(500).json({ message: "Failed to send OTP", error });
    }
});

// ✅ API to Verify OTP
app.post('/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    console.log(`🔍 Verifying OTP for ${email}...`);

    if (otpStorage[email] && otpStorage[email] == otp) {
        console.log(`✅ OTP verified for ${email}`);
        delete otpStorage[email]; // Remove OTP after successful verification
        res.json({ message: "OTP verified successfully!" });
    } else {
        console.error(`❌ Invalid OTP attempt for ${email}`);
        res.status(400).json({ message: "Invalid OTP" });
    }
});

app.get("/", (req, res) => {
    res.send("🚀 Server is running!");
});

// ✅ Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
