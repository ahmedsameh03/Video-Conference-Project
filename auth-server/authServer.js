const User = require('./models/users');

const express = require("express");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const mongoose = require("mongoose");

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ Connected to MongoDB Atlas"))
.catch((err) => console.error("❌ MongoDB connection error:", err));

const app = express();

app.use(cors({
  origin: "https://seenmeet.vercel.app",
  methods: ["GET", "POST"],
  credentials: true
}));

app.use(express.json());

let otpStorage = {}; // { email: otp }
let magicLinks = {}; // { token: { email, expiresAt } }

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("❌ Missing EMAIL_USER or EMAIL_PASS in environment variables.");
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    debug: true,
    logger: true
});

transporter.verify((error) => {
    if (error) {
        console.error("❌ Email config error:", error);
    } else {
        console.log("✅ Email server is ready to send messages.");
    }
});

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

app.post("/signup", async (req, res) => {
    const { email, password } = req.body;

    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "User already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ email, password: hashedPassword });
        await newUser.save();

        res.status(201).json({ message: "Signup successful!" });
    } catch (error) {
        console.error("❌ Signup Error:", error);
        res.status(500).json({ message: "Server error during signup." });
    }
});

app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ message: "Login successful!" });
});

app.post("/request-magic-link", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = crypto.randomBytes(32).toString("hex");

    magicLinks[token] = {
        email,
        expiresAt: Date.now() + 10 * 60 * 1000
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

app.get("/dashboard", (req, res) => {
    res.json({ message: "Welcome to the dashboard!" });
});

app.get("/", (req, res) => {
    res.send("🚀 Server is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
