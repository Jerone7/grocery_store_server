const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../db/db");
const router = require("express").Router();

const SECRET_KEY = process.env.JWT_SECRET || "change_this_in_production";

router.post("/signup", async (req, res) => {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing fields" });

    try {
        const [existing] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
        if (existing.length > 0) return res.status(400).json({ error: "Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await db.query("INSERT INTO users (name, email, password) VALUES (?, ?, ?)", [name || "User", email, hashedPassword]);

        res.json({ message: "User created" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await db.query("SELECT * FROM users WHERE email = ?", [email]);
        if (users.length === 0) return res.status(400).json({ error: "User not found" });

        const user = users[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: "Invalid password" });

        const token = jwt.sign({ id: user.user_id, name: user.name }, SECRET_KEY, { expiresIn: "1h" });
        res.json({ token, user: { id: user.user_id, name: user.name, email: user.email, phone: user.phone || null } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/auth/phone - save or update phone number
router.put("/phone", async (req, res) => {
    const { email, phone } = req.body;
    if (!email || !phone) return res.status(400).json({ error: "Email and phone are required" });

    try {
        // Upsert: create user row if Firebase user doesn't exist in MySQL yet
        await db.query(
            "INSERT INTO users (name, email, password) VALUES (?, ?, '') ON DUPLICATE KEY UPDATE email=email",
            [email.split('@')[0], email]
        );
        await db.query("UPDATE users SET phone = ? WHERE email = ?", [phone, email]);
        res.json({ success: true, phone });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/auth/phone - get phone number for a user
router.get("/phone", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        const [users] = await db.query("SELECT phone, address FROM users WHERE email = ?", [email]);
        // Return nulls if Firebase user not yet in MySQL (no error)
        if (users.length === 0) return res.json({ phone: null, address: null });
        res.json({ phone: users[0].phone || null, address: users[0].address || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/auth/address - save or update delivery address
router.put("/address", async (req, res) => {
    const { email, address } = req.body;
    if (!email || !address) return res.status(400).json({ error: "Email and address are required" });

    try {
        // Upsert: create user row if Firebase user doesn't exist in MySQL yet
        await db.query(
            "INSERT INTO users (name, email, password) VALUES (?, ?, '') ON DUPLICATE KEY UPDATE email=email",
            [email.split('@')[0], email]
        );
        await db.query("UPDATE users SET address = ? WHERE email = ?", [address, email]);
        res.json({ success: true, address });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
