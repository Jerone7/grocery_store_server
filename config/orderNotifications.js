const db = require("../db/db");
const { sendPushToToken } = require("./firebaseAdmin");

const getStoreAppUrl = (req) =>
  process.env.STORE_APP_URL || req.get("origin") || `${req.protocol}://${req.get("host")}`;

const buildProfileUrl = (req) => new URL("/profile", getStoreAppUrl(req)).toString();

const normalizeStatus = (status) => String(status || "pending").trim().toLowerCase();

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
};

const clearInvalidToken = async (token) => {
  if (!token) {
    return;
  }

  try {
    await db.query(
      `UPDATE users
       SET fcm_token = NULL, notifications_enabled = 0, notification_token_updated_at = NULL
       WHERE fcm_token = ?`,
      [token]
    );
  } catch (error) {
    console.error("Failed to clear invalid push token:", error.message);
  }
};

const getUserPushToken = async (email) => {
  if (!email) {
    return null;
  }

  const [users] = await db.query(
    `SELECT fcm_token, notifications_enabled
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  );

  if (users.length === 0) {
    return null;
  }

  const user = users[0];
  if (!user.notifications_enabled || !user.fcm_token) {
    return null;
  }

  return user.fcm_token;
};

const sendNotificationToUser = async (req, email, message) => {
  try {
    const token = await getUserPushToken(email);

    if (!token) {
      return false;
    }

    await sendPushToToken({
      token,
      ...message,
    });

    return true;
  } catch (error) {
    if (
      error.code === "messaging/registration-token-not-registered" ||
      error.code === "messaging/invalid-registration-token"
    ) {
      const token = await getUserPushToken(email);
      await clearInvalidToken(token);
    }

    if (error.code !== "messaging/not-configured") {
      console.error("Push notification send failed:", error.message);
    }

    return false;
  }
};

const buildOrderPlacedMessage = (req, { orderId, grandTotal }) => {
  const profileUrl = buildProfileUrl(req);
  const title = "Order booked successfully";
  const body = `Order #${orderId} has been placed. Total Rs. ${formatCurrency(grandTotal)}.`;

  return {
    notification: { title, body },
    webpush: {
      notification: { title, body },
      fcmOptions: { link: profileUrl },
    },
    data: {
      type: "order_booked",
      orderId: String(orderId),
      status: "pending",
      url: profileUrl,
    },
  };
};

const buildOrderStatusMessage = (req, { orderId, status }) => {
  const profileUrl = buildProfileUrl(req);
  const normalizedStatus = normalizeStatus(status);

  const messageMap = {
    pending: {
      title: "Order confirmed",
      body: `Order #${orderId} has been confirmed and is being prepared.`,
    },
    shipped: {
      title: "Order is on the way",
      body: `Order #${orderId} is out for delivery.`,
    },
    completed: {
      title: "Order delivered",
      body: `Order #${orderId} has been delivered successfully.`,
    },
    delivered: {
      title: "Order delivered",
      body: `Order #${orderId} has been delivered successfully.`,
    },
    cancelled: {
      title: "Order update",
      body: `Order #${orderId} has been cancelled.`,
    },
    cancelled_by_customer: {
      title: "Order update",
      body: `Order #${orderId} has been cancelled.`,
    },
  };

  const { title, body } =
    messageMap[normalizedStatus] || {
      title: "Order status updated",
      body: `Order #${orderId} status is now ${normalizedStatus}.`,
    };

  return {
    notification: { title, body },
    webpush: {
      notification: { title, body },
      fcmOptions: { link: profileUrl },
    },
    data: {
      type: "order_status_updated",
      orderId: String(orderId),
      status: normalizedStatus,
      url: profileUrl,
    },
  };
};

const sendOrderPlacedNotification = async (req, order) =>
  sendNotificationToUser(req, order.userEmail, buildOrderPlacedMessage(req, order));

const sendOrderStatusNotification = async (req, order) =>
  sendNotificationToUser(req, order.userEmail, buildOrderStatusMessage(req, order));

module.exports = {
  normalizeStatus,
  sendOrderPlacedNotification,
  sendOrderStatusNotification,
};
