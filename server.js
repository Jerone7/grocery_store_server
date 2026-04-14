const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("./db/mongoose");
const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");
const fs = require("fs");
const adminAuthMiddleware = require("./middleware/adminAuthMiddleware");

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

console.log("------------------- REGISTERING /api/products -------------------");
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/banners", require("./routes/bannerRoutes"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/payment", require("./routes/paymentRoutes"));
app.use("/admin-api/auth", require("./routes/adminAuthRoutes"));
app.use("/admin-api/products", adminAuthMiddleware, require("./routes/adminProductRoutes"));
app.use("/admin-api/orders", adminAuthMiddleware, require("./routes/adminOrderRoutes"));
app.use("/admin-api/categories", adminAuthMiddleware, require("./routes/adminCategoryRoutes"));
app.use("/admin-api/banners", adminAuthMiddleware, require("./routes/adminBannerRoutes"));

const PORT = Number(process.env.PORT) || 5000;
const ENABLE_SELF_PING = process.env.ENABLE_SELF_PING === "true";
const SELF_PING_URL = process.env.SELF_PING_URL || "";
const DEFAULT_INTERVAL_MS = 14 * 60 * 1000;
const parsedInterval = Number(process.env.SELF_PING_INTERVAL_MS);
const SELF_PING_INTERVAL_MS =
  Number.isFinite(parsedInterval) && parsedInterval >= 60_000
    ? parsedInterval
    : DEFAULT_INTERVAL_MS;
const groceryClientDist = path.resolve(__dirname, "../client/dist");
const adminClientDist = path.resolve(__dirname, "../../react_admin/client/dist");

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

if (fs.existsSync(adminClientDist)) {
  app.use("/admin", express.static(adminClientDist));
}

if (fs.existsSync(groceryClientDist)) {
  app.use(express.static(groceryClientDist));
}

app.get(/^\/admin(?:\/.*)?$/, (_req, res, next) => {
  if (!fs.existsSync(path.join(adminClientDist, "index.html"))) {
    return next();
  }

  return res.sendFile(path.join(adminClientDist, "index.html"));
});

app.get(/^(?!\/api(?:\/|$)|\/admin-api(?:\/|$)|\/health$).*/, (_req, res, next) => {
  if (!fs.existsSync(path.join(groceryClientDist, "index.html"))) {
    return next();
  }

  return res.sendFile(path.join(groceryClientDist, "index.html"));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[SERVER ERROR] ${req.method} ${req.url}:`, err);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Store frontend: http://localhost:${PORT}/`);
  console.log(`Admin frontend: http://localhost:${PORT}/admin`);
  console.log(`Admin API: http://localhost:${PORT}/admin-api`);
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
