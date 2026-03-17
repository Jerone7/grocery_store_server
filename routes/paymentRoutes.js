const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const crypto = require("crypto");

// instantiate razorpay client once using environment credentials
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.warn(
        "[paymentRoutes] Razorpay keys missing; create-order requests will fail."
    );
}

// create-order endpoint will check credentials and return the server key
router.post("/create-order", async (req, res) => {
    // ensure keys exist before attempting order creation
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
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
            amount: Math.round(amount * 100), // convert to paisa
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
        };

        const order = await razorpay.orders.create(options);
        // include publishable key for frontend
        res.json({
            ...order,
            key_id: process.env.RAZORPAY_KEY_ID || "",
        });
    } catch (error) {
        console.error("Create Razorpay order error:", error);
        res.status(500).json({ error: "Failed to create payment order", details: error.message });
    }
});

const UPI_ID_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;

function normalizeUpiId(value) {
    return String(value || "").trim().toLowerCase();
}

router.post("/validate-upi", async (req, res) => {
    try {
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

// Verification route (kept from previous implementation for security)
router.post("/verify", async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, expected_method } = req.body;

    try {
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest("hex");

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ verified: false, error: "Invalid signature" });
        }

        if (expected_method) {
            const payment = await razorpay.payments.fetch(razorpay_payment_id);
            const actualMethod = payment?.method || "";

            if (actualMethod !== expected_method) {
                return res.status(400).json({
                    verified: false,
                    error: `Expected ${expected_method} payment, but got ${actualMethod || "unknown"}`,
                });
            }
        }

        return res.json({ verified: true });
    } catch (err) {
        console.error("Payment verify error:", err);
        return res.status(500).json({ verified: false, error: "Payment verification failed" });
    }
});

module.exports = router;
