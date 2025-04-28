const express = require("express");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const cors = require("cors");
const crypto = require("crypto"); // ✅ Added for secure magic tokens
require("dotenv").config();

const app = express();

// ✅ Allow your frontend origin
app.use(cors({
  origin: "https://seenmeet.vercel.app",
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

// ✅ Temporary in-memory storage
let otpStorage = {}; // { email: otp }
let users = [];      // { email, password }
let magicLinks = {}; // { token: { email, expiresAt } }

// ✅ Validate environment variables
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("❌ Missing EMAIL_USER or EMAIL_PASS in environment variables.");
    process.exit(1);
}

// ✅ Email Transporter Configuration
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    debug: true,
    logger: true
});

// ✅ Verify Email Transporter Configuration
transporter.verify((error) => {
    if (error) {
        console.error("❌ Email config error:", error);
    } else {
        console.log("✅ Email server is ready to send messages.");
    }
});

// ✅ API to Send OTP
app.post("/send-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }

    const otp = Math.floor(1000 + Math.random() * 9000);
    otpStorage[email] = otp;
    console.log("✅ Generated OTP:", otp, "for:", email);

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Your OTP Code",
        text: `Your OTP code is ${otp}. It is valid for 5 minutes.`
    };

    try {
        await transporter.sendMail(mailOptions);
        res.json({ message: "OTP sent successfully!" });
    } catch (error) {
        res.status(500).json({ message: "Failed to send OTP", error });
    }
});

// ✅ API to Verify OTP
app.post("/verify-otp", (req, res) => {
    const { email, otp } = req.body;
    console.log("🔍 Verifying OTP for:", email);
    console.log("🧠 OTP stored:", otpStorage[email]);
    console.log("🧾 OTP entered:", otp);

    if (otpStorage[email] && otpStorage[email] == otp) {
        delete otpStorage[email];
        res.json({ message: "OTP verified successfully!" });
    } else {
        res.status(400).json({ message: "Invalid OTP" });
    }
});

// ✅ SIGN UP: Register a new user
app.post("/signup", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    // Check if user already exists
    if (users.some(user => user.email === email)) {
        return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ email, password: hashedPassword });

    res.json({ message: "User registered successfully!" });
});

// ✅ OLD LOGIN (optional: not used after magic link)
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    const user = users.find(user => user.email === email);
    if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ message: "Login successful!" });
});

// ✅ NEW LOGIN: Request Magic Link
app.post("/request-magic-link", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    const user = users.find(user => user.email === email);
    if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");

    // Save token with expiration
    magicLinks[token] = {
        email,
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    };

    const magicLinkUrl = `https://seenmeet.vercel.app/verify.html?token=${token}`;

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: "SEEN Login - Magic Link",
        text: `Click this link to complete your login: ${magicLinkUrl}\n\nThis link will expire in 10 minutes.`
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Magic link sent to ${email}`);
        res.json({ message: "Magic link sent successfully to your email." });
    } catch (error) {
        console.error("❌ Error sending magic link email:", error);
        res.status(500).json({ message: "Failed to send magic link." });
    }
});

// ✅ VERIFY Magic Link
app.post("/verify-magic-link", (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: "Token is required" });
    }

    const tokenData = magicLinks[token];
    if (!tokenData) {
        return res.status(400).json({ error: "Invalid or expired token" });
    }

    if (tokenData.expiresAt < Date.now()) {
        delete magicLinks[token];
        return res.status(400).json({ error: "Token expired" });
    }

    delete magicLinks[token];
    console.log(`✅ Magic link verified for ${tokenData.email}`);
    res.json({ message: "Magic link verified successfully!" });
});

// ✅ Protected Route (for future)
app.get("/dashboard", (req, res) => {
    res.json({ message: "Welcome to the dashboard!" });
});

// ✅ Default Route
app.get("/", (req, res) => {
    res.send("🚀 Server is running!");
});

// ✅ Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
