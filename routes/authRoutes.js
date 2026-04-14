const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const {
    isFirebaseAdminConfigured,
    sendPushToToken,
} = require("../config/firebaseAdmin");
const router = require("express").Router();

const SECRET_KEY = process.env.JWT_SECRET || "change_this_in_production";

const getStoreAppUrl = (req) =>
    process.env.STORE_APP_URL || req.get("origin") || `${req.protocol}://${req.get("host")}`;

router.post("/signup", async (req, res) => {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Missing fields" });

    try {
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: "Email already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ name: name || "User", email, password: hashedPassword });

        res.json({ message: "User created" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: "User not found" });

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
        await User.findOneAndUpdate(
            { email },
            { $setOnInsert: { name: email.split("@")[0], password: "" }, $set: { phone } },
            { upsert: true }
        );
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
        const user = await User.findOne({ email }, { phone: 1, address: 1 });
        if (!user) return res.json({ phone: null, address: null });
        res.json({ phone: user.phone || null, address: user.address || null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/auth/address - save or update delivery address
router.put("/address", async (req, res) => {
    const { email, address } = req.body;
    if (!email || !address) return res.status(400).json({ error: "Email and address are required" });

    try {
        await User.findOneAndUpdate(
            { email },
            { $setOnInsert: { name: email.split("@")[0], password: "" }, $set: { address } },
            { upsert: true }
        );
        res.json({ success: true, address });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get("/notifications/status", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        const user = await User.findOne({ email }, {
            notifications_enabled: 1,
            fcm_token: 1,
            notification_token_updated_at: 1,
        });

        if (!user) {
            return res.json({
                enabled: false,
                hasToken: false,
                canSendPush: isFirebaseAdminConfigured,
                tokenUpdatedAt: null,
            });
        }

        res.json({
            enabled: Boolean(user.notifications_enabled),
            hasToken: Boolean(user.fcm_token),
            canSendPush: isFirebaseAdminConfigured,
            tokenUpdatedAt: user.notification_token_updated_at || null,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put("/notifications/token", async (req, res) => {
    const { email, token } = req.body;
    if (!email || !token) {
        return res.status(400).json({ error: "Email and notification token are required" });
    }

    try {
        // Clear this token from any other user
        await User.updateMany(
            { fcm_token: token, email: { $ne: email } },
            { $set: { fcm_token: null, notifications_enabled: 0, notification_token_updated_at: null } }
        );

        // Ensure user row exists
        await User.findOneAndUpdate(
            { email },
            { $setOnInsert: { name: email.split("@")[0], password: "" } },
            { upsert: true }
        );

        // Set the token
        await User.updateOne(
            { email },
            { $set: { fcm_token: token, notifications_enabled: 1, notification_token_updated_at: new Date() } }
        );

        res.json({
            success: true,
            enabled: true,
            hasToken: true,
            message: "Push notifications enabled for this browser.",
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete("/notifications/token", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        await User.updateOne(
            { email },
            { $set: { fcm_token: null, notifications_enabled: 0, notification_token_updated_at: null } }
        );

        res.json({
            success: true,
            enabled: false,
            hasToken: false,
            message: "Push notifications disabled for this browser.",
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/notifications/test", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        const user = await User.findOne({ email }, { fcm_token: 1, notifications_enabled: 1 });

        if (!user || !user.fcm_token || !user.notifications_enabled) {
            return res.status(400).json({ error: "Enable notifications for this browser first." });
        }

        const profileUrl = new URL("/profile", getStoreAppUrl(req)).toString();

        const messageId = await sendPushToToken({
            token: user.fcm_token,
            notification: {
                title: "NM Store notifications enabled",
                body: "You will now receive order, delivery, and account updates here.",
            },
            webpush: {
                notification: {
                    title: "NM Store notifications enabled",
                    body: "You will now receive order, delivery, and account updates here.",
                },
                fcmOptions: {
                    link: profileUrl,
                },
            },
            data: {
                url: profileUrl,
                type: "test_notification",
            },
        });

        res.json({
            success: true,
            messageId,
            message: "Test notification sent.",
        });
    } catch (err) {
        const statusCode = err.code === "messaging/not-configured" ? 503 : 500;
        res.status(statusCode).json({ error: err.message });
    }
});

module.exports = router;
