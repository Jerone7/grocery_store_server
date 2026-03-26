const admin = require("firebase-admin");

let firebaseAdminApp = null;

const normalizePrivateKey = (privateKey) =>
  typeof privateKey === "string" ? privateKey.replace(/\\n/g, "\n") : "";

const getServiceAccount = () => {
  if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON);
    if (parsed.private_key) {
      parsed.private_key = normalizePrivateKey(parsed.private_key);
    }
    return parsed;
  }

  if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
    };
  }

  return null;
};

const firebaseAdminCredentials = getServiceAccount();

const isFirebaseAdminConfigured = Boolean(
  firebaseAdminCredentials?.projectId &&
    firebaseAdminCredentials?.clientEmail &&
    firebaseAdminCredentials?.privateKey
);

const getFirebaseAdminApp = () => {
  if (!isFirebaseAdminConfigured) {
    return null;
  }

  if (firebaseAdminApp) {
    return firebaseAdminApp;
  }

  firebaseAdminApp =
    admin.apps[0] ||
    admin.initializeApp({
      credential: admin.credential.cert(firebaseAdminCredentials),
    });

  return firebaseAdminApp;
};

const sendPushToToken = async (message) => {
  const app = getFirebaseAdminApp();

  if (!app) {
    const error = new Error(
      "Firebase Admin push is not configured. Add FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY to server/.env."
    );
    error.code = "messaging/not-configured";
    throw error;
  }

  return admin.messaging(app).send(message);
};

module.exports = {
  isFirebaseAdminConfigured,
  sendPushToToken,
};
