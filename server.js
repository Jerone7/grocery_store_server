require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/banners", require("./routes/bannerRoutes"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/payment", require("./routes/paymentRoutes"));

const PORT = Number(process.env.PORT) || 5000;
const ENABLE_SELF_PING = process.env.ENABLE_SELF_PING === "true";
const SELF_PING_URL = process.env.SELF_PING_URL || "";
const DEFAULT_INTERVAL_MS = 14 * 60 * 1000;
const parsedInterval = Number(process.env.SELF_PING_INTERVAL_MS);
const SELF_PING_INTERVAL_MS =
  Number.isFinite(parsedInterval) && parsedInterval >= 60_000
    ? parsedInterval
    : DEFAULT_INTERVAL_MS;

const pingUrl = (url) =>
  new Promise((resolve, reject) => {
    const client = url.startsWith("https://") ? https : http;

    const request = client.get(url, (response) => {
      response.resume();
      resolve(response.statusCode);
    });

    request.on("error", reject);
    request.setTimeout(15_000, () => {
      request.destroy(new Error("Self-ping timed out"));
    });
  });

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`RAZORPAY_KEY_ID=${process.env.RAZORPAY_KEY_ID || "(not set)"}`);
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.error("ERROR: Razorpay credentials missing in environment! Payments will fail.");
  }

  if (ENABLE_SELF_PING && SELF_PING_URL) {
    console.log(
      `Self-ping enabled: ${SELF_PING_URL} every ${Math.round(
        SELF_PING_INTERVAL_MS / 1000
      )}s`
    );

    setInterval(async () => {
      try {
        const statusCode = await pingUrl(SELF_PING_URL);
        console.log(`[self-ping] ${statusCode} from ${SELF_PING_URL}`);
      } catch (error) {
        console.error(`[self-ping] failed: ${error.message}`);
      }
    }, SELF_PING_INTERVAL_MS);
  }
});
