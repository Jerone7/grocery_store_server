const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

let firebaseAdminApp = null;

const normalizePrivateKey = (privateKey) =>
  typeof privateKey === "string" ? privateKey.replace(/\\n/g, "\n") : "";

const normalizeServiceAccount = (credentials) => {
  if (!credentials || typeof credentials !== "object") {
    return null;
  }

  const projectId = credentials.projectId || credentials.project_id || "";
  const clientEmail = credentials.clientEmail || credentials.client_email || "";
  const privateKey = normalizePrivateKey(
    credentials.privateKey || credentials.private_key || ""
  );

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    ...credentials,
    projectId,
    clientEmail,
    privateKey,
  };
};

const loadServiceAccountFromFile = (filePath) => {
  if (!filePath) {
    return null;
  }

  const resolvedPath = path.resolve(filePath);
  const fileContents = fs.readFileSync(resolvedPath, "utf8");
  return normalizeServiceAccount(JSON.parse(fileContents));
};

const getServiceAccount = () => {
  if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON) {
    return normalizeServiceAccount(
      JSON.parse(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON)
    );
  }

  if (process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_FILE) {
    return loadServiceAccountFromFile(process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_FILE);
  }

  if (
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  ) {
    return normalizeServiceAccount({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
    });
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
      "Firebase Admin push is not configured. Add FIREBASE_ADMIN_SERVICE_ACCOUNT_FILE or FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY to server/.env."
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
