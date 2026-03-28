const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../db/db");
const {
    isFirebaseAdminConfigured,
    sendPushToToken,
} = require("../config/firebaseAdmin");
const router = require("express").Router();

const SECRET_KEY = process.env.JWT_SECRET || "change_this_in_production";

let ensureNotificationColumnsPromise = null;
let ensureProfileColumnsPromise = null;

const getUsersTableColumns = async () => {
    const [rows] = await db.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    return new Set(rows.map((row) => row.COLUMN_NAME));
};

const ensureProfileColumns = async () => {
    if (!ensureProfileColumnsPromise) {
        ensureProfileColumnsPromise = (async () => {
            const columns = await getUsersTableColumns();
            const statements = [
                ["phone", "ALTER TABLE users ADD COLUMN phone VARCHAR(15) DEFAULT NULL"],
                ["address", "ALTER TABLE users ADD COLUMN address TEXT DEFAULT NULL"],
            ];

            for (const [columnName, statement] of statements) {
                if (columns.has(columnName)) {
                    continue;
                }

                await db.query(statement);
            }
        })().catch((error) => {
            ensureProfileColumnsPromise = null;
            throw error;
        });
    }

    return ensureProfileColumnsPromise;
};

const ensureNotificationColumns = async () => {
    if (!ensureNotificationColumnsPromise) {
        ensureNotificationColumnsPromise = (async () => {
            await ensureProfileColumns();
            const columns = await getUsersTableColumns();
            const statements = [
                ["fcm_token", "ALTER TABLE users ADD COLUMN fcm_token TEXT DEFAULT NULL"],
                ["notifications_enabled", "ALTER TABLE users ADD COLUMN notifications_enabled TINYINT(1) NOT NULL DEFAULT 0"],
                ["notification_token_updated_at", "ALTER TABLE users ADD COLUMN notification_token_updated_at TIMESTAMP NULL DEFAULT NULL"],
            ];

            for (const [columnName, statement] of statements) {
                if (columns.has(columnName)) {
                    continue;
                }

                await db.query(statement);
            }
        })().catch((error) => {
            ensureNotificationColumnsPromise = null;
            throw error;
        });
    }

    return ensureNotificationColumnsPromise;
};

const ensureUserRow = async (email) => {
    await db.query(
        "INSERT INTO users (name, email, password) VALUES (?, ?, '') ON DUPLICATE KEY UPDATE email=email",
        [email.split("@")[0], email]
    );
};

const getStoreAppUrl = (req) =>
    process.env.STORE_APP_URL || req.get("origin") || `${req.protocol}://${req.get("host")}`;

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
        await ensureProfileColumns();
        // Upsert: create user row if Firebase user doesn't exist in MySQL yet
        await ensureUserRow(email);
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
        await ensureProfileColumns();
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
        await ensureProfileColumns();
        // Upsert: create user row if Firebase user doesn't exist in MySQL yet
        await ensureUserRow(email);
        await db.query("UPDATE users SET address = ? WHERE email = ?", [address, email]);
        res.json({ success: true, address });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get("/notifications/status", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        await ensureNotificationColumns();

        const [users] = await db.query(
            "SELECT notifications_enabled, fcm_token, notification_token_updated_at FROM users WHERE email = ?",
            [email]
        );

        if (users.length === 0) {
            return res.json({
                enabled: false,
                hasToken: false,
                canSendPush: isFirebaseAdminConfigured,
                tokenUpdatedAt: null,
            });
        }

        const user = users[0];
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
        await ensureNotificationColumns();
        await ensureUserRow(email);
        await db.query(
            `UPDATE users
             SET fcm_token = NULL, notifications_enabled = 0, notification_token_updated_at = NULL
             WHERE fcm_token = ? AND email <> ?`,
            [token, email]
        );
        await db.query(
            `UPDATE users
             SET fcm_token = ?, notifications_enabled = 1, notification_token_updated_at = CURRENT_TIMESTAMP
             WHERE email = ?`,
            [token, email]
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
        await ensureNotificationColumns();
        await ensureUserRow(email);
        await db.query(
            `UPDATE users
             SET fcm_token = NULL, notifications_enabled = 0, notification_token_updated_at = NULL
             WHERE email = ?`,
            [email]
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
        await ensureNotificationColumns();

        const [users] = await db.query(
            "SELECT fcm_token, notifications_enabled FROM users WHERE email = ?",
            [email]
        );

        if (users.length === 0 || !users[0].fcm_token || !users[0].notifications_enabled) {
            return res.status(400).json({ error: "Enable notifications for this browser first." });
        }

        const profileUrl = new URL("/profile", getStoreAppUrl(req)).toString();

        const messageId = await sendPushToToken({
            token: users[0].fcm_token,
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
