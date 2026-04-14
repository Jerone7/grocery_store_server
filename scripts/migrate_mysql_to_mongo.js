/**
 * Migration Script: MySQL → MongoDB
 * 
 * Transfers all data from your Railway MySQL database to MongoDB Atlas.
 * Run once: node scripts/migrate_mysql_to_mongo.js
 */

require("dotenv").config();
const mysql = require("mysql2/promise");
const mongoose = require("mongoose");

// Import all Mongoose models
const { Counter } = require("../models/Counter");
const Product = require("../models/Product");
const Category = require("../models/Category");
const User = require("../models/User");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const Banner = require("../models/Banner");
const AdminUser = require("../models/AdminUser");

// MySQL config — using your Railway credentials
const MYSQL_CONFIG = {
  host: "nozomi.proxy.rlwy.net",
  port: 14346,
  user: "root",
  password: "pqGTkuIrydptMlUmbUrAGquDUGCpAdCv",
  database: "railway",
};

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/grocery_store";

async function getRows(mysqlConn, table) {
  try {
    const [rows] = await mysqlConn.query(`SELECT * FROM ${table}`);
    return rows;
  } catch (err) {
    console.warn(`  ⚠  Table "${table}" not found or empty: ${err.message}`);
    return [];
  }
}

async function setCounter(name, maxId) {
  if (maxId > 0) {
    await Counter.findByIdAndUpdate(
      name,
      { seq: maxId },
      { upsert: true }
    );
    console.log(`  Counter "${name}" set to ${maxId}`);
  }
}

async function migrate() {
  console.log("🔄  Connecting to MySQL...");
  const mysqlConn = await mysql.createConnection(MYSQL_CONFIG);
  console.log("✅  MySQL connected");

  console.log("🔄  Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅  MongoDB connected");

  try {
    // ─── Categories ────────────────────────────
    console.log("\n📂  Migrating categories...");
    const categories = await getRows(mysqlConn, "categories");
    if (categories.length > 0) {
      await Category.deleteMany({});
      const docs = categories.map((c) => ({
        category_id: c.category_id,
        category_name: c.category_name,
      }));
      await Category.insertMany(docs);
      const maxCatId = Math.max(...categories.map((c) => c.category_id));
      await setCounter("category_id", maxCatId);
      console.log(`  ✅  ${categories.length} categories migrated`);
    } else {
      console.log("  ⏭  No categories to migrate");
    }

    // ─── Products ──────────────────────────────
    console.log("\n📦  Migrating products...");
    const products = await getRows(mysqlConn, "products");
    if (products.length > 0) {
      await Product.deleteMany({});
      const docs = products.map((p) => ({
        product_id: p.product_id,
        category_id: p.category_id,
        product_name: p.product_name,
        description: p.description,
        price: Number(p.price),
        stock: p.stock || 0,
        weight_quantity: p.weight_quantity ? Number(p.weight_quantity) : null,
        weight_unit: p.weight_unit || "kg",
        image_url: p.image_url,
        storage_path: p.storage_path || null,
        is_active: p.is_active != null ? Number(p.is_active) : 1,
        is_enabled: p.is_enabled != null ? Number(p.is_enabled) : 1,
        is_featured: p.is_featured != null ? Number(p.is_featured) : 0,
        created_at: p.created_at || new Date(),
      }));
      await Product.insertMany(docs);
      const maxProdId = Math.max(...products.map((p) => p.product_id));
      await setCounter("product_id", maxProdId);
      console.log(`  ✅  ${products.length} products migrated`);
    } else {
      console.log("  ⏭  No products to migrate");
    }

    // ─── Users ─────────────────────────────────
    console.log("\n👤  Migrating users...");
    const users = await getRows(mysqlConn, "users");
    if (users.length > 0) {
      await User.deleteMany({});
      const docs = users.map((u) => ({
        user_id: u.user_id,
        name: u.name || "User",
        email: u.email,
        password: u.password || "",
        phone: u.phone || null,
        address: u.address || null,
        fcm_token: u.fcm_token || null,
        notifications_enabled: u.notifications_enabled ? Number(u.notifications_enabled) : 0,
        notification_token_updated_at: u.notification_token_updated_at || null,
      }));
      await User.insertMany(docs);
      const maxUserId = Math.max(...users.map((u) => u.user_id));
      await setCounter("user_id", maxUserId);
      console.log(`  ✅  ${users.length} users migrated`);
    } else {
      console.log("  ⏭  No users to migrate");
    }

    // ─── Admin Users ───────────────────────────
    console.log("\n🔐  Migrating admin users...");
    const adminUsers = await getRows(mysqlConn, "admin_users");
    if (adminUsers.length > 0) {
      await AdminUser.deleteMany({});
      const docs = adminUsers.map((a) => ({
        id: a.id,
        name: a.name || "",
        email: a.email,
        password: a.password,
      }));
      await AdminUser.insertMany(docs);
      const maxAdminId = Math.max(...adminUsers.map((a) => a.id));
      await setCounter("admin_user_id", maxAdminId);
      console.log(`  ✅  ${adminUsers.length} admin users migrated`);
    } else {
      console.log("  ⏭  No admin users to migrate");
    }

    // ─── Orders ────────────────────────────────
    console.log("\n🧾  Migrating orders...");
    const orders = await getRows(mysqlConn, "orders");
    if (orders.length > 0) {
      await Order.deleteMany({});
      const docs = orders.map((o) => ({
        id: o.id || o.order_id,
        user_email: o.user_email,
        payment_method: o.payment_method || "upi",
        payment_details: o.payment_details || null,
        delivery_address: o.delivery_address || "",
        item_total: Number(o.item_total) || 0,
        delivery_charge: Number(o.delivery_charge) || 0,
        handling_charge: Number(o.handling_charge) || 0,
        grand_total: Number(o.grand_total) || 0,
        status: o.status || "pending",
        created_at: o.created_at || o.order_date || new Date(),
      }));
      await Order.insertMany(docs);
      const maxOrderId = Math.max(...orders.map((o) => o.id || o.order_id));
      await setCounter("order_id", maxOrderId);
      console.log(`  ✅  ${orders.length} orders migrated`);
    } else {
      console.log("  ⏭  No orders to migrate");
    }

    // ─── Order Items ───────────────────────────
    console.log("\n📋  Migrating order items...");
    const orderItems = await getRows(mysqlConn, "order_items");
    if (orderItems.length > 0) {
      await OrderItem.deleteMany({});
      const docs = orderItems.map((oi) => ({
        id: oi.id || oi.order_item_id,
        order_id: oi.order_id,
        product_id: oi.product_id,
        product_name: oi.product_name || "",
        image_url: oi.image_url || "",
        price: Number(oi.price) || 0,
        amount: oi.amount ? Number(oi.amount) : null,
        quantity: oi.quantity || 1,
        order_date: oi.order_date || new Date(),
      }));
      await OrderItem.insertMany(docs);
      const maxItemId = Math.max(...orderItems.map((oi) => oi.id || oi.order_item_id));
      await setCounter("order_item_id", maxItemId);
      console.log(`  ✅  ${orderItems.length} order items migrated`);
    } else {
      console.log("  ⏭  No order items to migrate");
    }

    // ─── Banners ───────────────────────────────
    console.log("\n🖼️   Migrating banners...");
    const banners = await getRows(mysqlConn, "banners");
    if (banners.length > 0) {
      await Banner.deleteMany({});
      const docs = banners.map((b) => ({
        id: b.id,
        image: b.image,
        type: b.type,
        resource_type: b.resource_type || null,
        resource_value: b.resource_value || null,
        storage_path: b.storage_path || null,
        is_enabled: b.is_enabled != null ? Number(b.is_enabled) : 1,
        created_at: b.created_at || new Date(),
        updated_at: b.updated_at || new Date(),
      }));
      await Banner.insertMany(docs);
      const maxBannerId = Math.max(...banners.map((b) => b.id));
      await setCounter("banner_id", maxBannerId);
      console.log(`  ✅  ${banners.length} banners migrated`);
    } else {
      console.log("  ⏭  No banners to migrate");
    }

    console.log("\n🎉  Migration complete!");
    console.log("─────────────────────────────────────");
    console.log("Summary:");
    console.log(`  Categories:   ${categories.length}`);
    console.log(`  Products:     ${products.length}`);
    console.log(`  Users:        ${users.length}`);
    console.log(`  Admin Users:  ${adminUsers.length}`);
    console.log(`  Orders:       ${orders.length}`);
    console.log(`  Order Items:  ${orderItems.length}`);
    console.log(`  Banners:      ${banners.length}`);

  } catch (err) {
    console.error("\n❌  Migration failed:", err);
  } finally {
    await mysqlConn.end();
    await mongoose.disconnect();
    console.log("\n🔌  Connections closed.");
  }
}

migrate();
