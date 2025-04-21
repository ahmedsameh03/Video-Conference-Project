const express = require("express");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const cors = require("cors");
require("dotenv").config();

const app = express();

// ✅ Allow your frontend origin
app.use(cors({
  origin: "https://seenmeet.vercel.app",  // 🔓 allow Vercel frontend
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

let otpStorage = {}; // Temporary storage for OTPs
let users = [];      // Temporary storage for user credentials

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

    // Hash password before saving
    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ email, password: hashedPassword });

    res.json({ message: "User registered successfully!" });
});

// ✅ SIGN IN: Authenticate user
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    // Find user in the list
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

// ✅ PROTECTED ROUTE (Without JWT for now)
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
