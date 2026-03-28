const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");

const router = express.Router();

const RAZORPAY_PAYMENTS_BASE_URL = "https://api.razorpay.com/v1/payments";
const RAZORPAY_ROUTE_ACCOUNTS_BASE_URL = "https://api.razorpay.com/v2/accounts";
const VALID_PAYMENT_STATUSES = new Set(["authorized", "captured"]);

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
function hasRazorpayCredentials() {
    return Boolean(razorpayKeyId && razorpayKeySecret);
}

const razorpay = hasRazorpayCredentials()
    ? new Razorpay({
        key_id: razorpayKeyId,
        key_secret: razorpayKeySecret,
    })
    : null;

if (!razorpayKeyId || !razorpayKeySecret) {
    console.warn(
        "[paymentRoutes] Razorpay keys missing; live payment requests will fail."
    );
}

const getRazorpayAuthHeader = () =>
    `Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64")}`;

const buildRazorpayUrl = (baseUrl, pathSegments = [], query = {}) => {
    const url = new URL(baseUrl);
    const sanitizedPath = pathSegments
        .filter((segment) => segment !== undefined && segment !== null && String(segment).trim() !== "")
        .map((segment) => encodeURIComponent(String(segment).trim()))
        .join("/");

    if (sanitizedPath) {
        url.pathname = `${url.pathname.replace(/\/$/, "")}/${sanitizedPath}`;
    }

    Object.entries(query || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((entry) => {
                if (entry !== undefined && entry !== null && entry !== "") {
                    url.searchParams.append(key, String(entry));
                }
            });
            return;
        }

        url.searchParams.append(key, String(value));
    });

    return url.toString();
};

const makeRazorpayRequest = async ({ url, method = "GET", body }) => {
    if (!hasRazorpayCredentials()) {
        const error = new Error("Razorpay keys are not configured on the server");
        error.status = 500;
        throw error;
    }

    const headers = {
        Authorization: getRazorpayAuthHeader(),
    };

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message =
            payload?.error?.description ||
            payload?.error?.reason ||
            payload?.error ||
            `Razorpay request failed with status ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.details = payload;
        throw error;
    }

    return payload;
};

const fetchPaymentResource = (paymentId) =>
    makeRazorpayRequest({
        url: buildRazorpayUrl(RAZORPAY_PAYMENTS_BASE_URL, [paymentId]),
    });

const listPaymentResources = (query) =>
    makeRazorpayRequest({
        url: buildRazorpayUrl(RAZORPAY_PAYMENTS_BASE_URL, [], query),
    });

const listLinkedAccounts = (query) =>
    makeRazorpayRequest({
        url: buildRazorpayUrl(RAZORPAY_ROUTE_ACCOUNTS_BASE_URL, [], query),
    });

const fetchLinkedAccount = (accountId) =>
    makeRazorpayRequest({
        url: buildRazorpayUrl(RAZORPAY_ROUTE_ACCOUNTS_BASE_URL, [accountId]),
    });

router.get("/config", (_req, res) => {
    const razorpayEnabled = hasRazorpayCredentials();
    const razorpayMode = razorpayKeyId.startsWith("rzp_live_") ? "live" : "test";

    return res.json({
        razorpay_enabled: razorpayEnabled,
        razorpay_mode: razorpayEnabled ? razorpayMode : "unconfigured",
        payments_api_url: RAZORPAY_PAYMENTS_BASE_URL,
        route_accounts_api_url: RAZORPAY_ROUTE_ACCOUNTS_BASE_URL,
    });
});

router.post("/create-order", async (req, res) => {
    if (!hasRazorpayCredentials()) {
        console.error("/create-order called without Razorpay credentials");
        return res
            .status(500)
            .json({ error: "Razorpay keys are not configured on the server" });
    }

    try {
        const amount = Number(req.body.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
        }

        const options = {
            amount: Math.round(amount * 100),
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);
        return res.json({
            ...order,
            key_id: razorpayKeyId,
        });
    } catch (error) {
        console.error("Create Razorpay order error:", error);
        return res
            .status(500)
            .json({ error: "Failed to create payment order", details: error.message });
    }
});

const UPI_ID_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

function normalizeUpiId(value) {
    return String(value || "").trim().toLowerCase();
}

router.post("/validate-upi", async (req, res) => {
    try {
        if (!razorpay) {
            return res.status(500).json({
                valid: false,
                error: "Razorpay keys are not configured on the server",
            });
        }

        const upiId = normalizeUpiId(req.body.upi_id);

        if (!upiId) {
            return res.status(400).json({ valid: false, error: "UPI ID is required" });
        }

        if (!UPI_ID_REGEX.test(upiId)) {
            return res.status(400).json({
                valid: false,
                error: "Invalid UPI ID format (example: name@bank)",
            });
        }

        const result = await razorpay.payments.validateVpa({ vpa: upiId });
        if (!result?.success) {
            return res.status(400).json({
                valid: false,
                error: "UPI ID could not be validated. Check and try again.",
            });
        }

        return res.json({
            valid: true,
            upi_id: result.vpa || upiId,
            customer_name: result.customer_name || null,
        });
    } catch (error) {
        console.error("Validate UPI error:", error);
        return res.status(502).json({
            valid: false,
            error: "UPI validation service is unavailable. Please try again.",
        });
    }
});

router.get("/payments", adminAuthMiddleware, async (req, res) => {
    try {
        const payments = await listPaymentResources(req.query);
        return res.json(payments);
    } catch (error) {
        console.error("List Razorpay payments error:", error);
        return res.status(error.status || 502).json({
            error: "Failed to fetch Razorpay payments",
            details: error.message,
        });
    }
});

router.get("/payments/:paymentId", adminAuthMiddleware, async (req, res) => {
    try {
        const payment = await fetchPaymentResource(req.params.paymentId);
        return res.json(payment);
    } catch (error) {
        console.error("Fetch Razorpay payment error:", error);
        return res.status(error.status || 502).json({
            error: "Failed to fetch Razorpay payment",
            details: error.message,
        });
    }
});

router.get("/route/accounts", adminAuthMiddleware, async (req, res) => {
    try {
        const accounts = await listLinkedAccounts(req.query);
        return res.json(accounts);
    } catch (error) {
        console.error("List linked accounts error:", error);
        return res.status(error.status || 502).json({
            error: "Failed to fetch linked accounts",
            details: error.message,
        });
    }
});

router.get("/route/accounts/:accountId", adminAuthMiddleware, async (req, res) => {
    try {
        const account = await fetchLinkedAccount(req.params.accountId);
        return res.json(account);
    } catch (error) {
        console.error("Fetch linked account error:", error);
        return res.status(error.status || 502).json({
            error: "Failed to fetch linked account",
            details: error.message,
        });
    }
});

router.post("/verify", async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, expected_method } = req.body;

    if (!hasRazorpayCredentials()) {
        return res.status(500).json({
            verified: false,
            error: "Razorpay keys are not configured on the server",
        });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({
            verified: false,
            error: "Payment verification payload is incomplete",
        });
    }

    try {
        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSignature = crypto
            .createHmac("sha256", razorpayKeySecret)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ verified: false, error: "Invalid signature" });
        }

        const payment = await fetchPaymentResource(razorpay_payment_id);

        if (payment?.order_id !== razorpay_order_id) {
            return res.status(400).json({
                verified: false,
                error: "Payment does not belong to the supplied order",
            });
        }

        if (!VALID_PAYMENT_STATUSES.has(String(payment?.status || "").toLowerCase())) {
            return res.status(400).json({
                verified: false,
                error: `Payment status is ${payment?.status || "unknown"}`,
            });
        }

        if (expected_method) {
            const actualMethod = payment?.method || "";

            if (actualMethod !== expected_method) {
                return res.status(400).json({
                    verified: false,
                    error: `Expected ${expected_method} payment, but got ${actualMethod || "unknown"}`,
                });
            }
        }

        return res.json({
            verified: true,
            payment: {
                id: payment.id,
                order_id: payment.order_id,
                status: payment.status,
                method: payment.method,
                amount: payment.amount,
                currency: payment.currency,
            },
        });
    } catch (err) {
        console.error("Payment verify error:", err);
        return res.status(err.status || 500).json({
            verified: false,
            error: "Payment verification failed",
            details: err.message,
        });
    }
});

module.exports = router;
