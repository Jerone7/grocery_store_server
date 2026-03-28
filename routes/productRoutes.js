const express = require("express");
const router = express.Router();
const db = require("../db/db");

router.get("/", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const excludeDescription = req.query.excludeDescription === "true";

    let selectFields = "*";
    if (excludeDescription) {
      selectFields = "product_id, product_name, price, category_id, image_url, stock, weight_quantity AS weight, weight_unit AS unit, is_featured, is_enabled";
    }

    let query = `SELECT ${selectFields} FROM products WHERE is_enabled = 1 AND stock > 0`;
    const params = [];

    if (limit) {
      query += " LIMIT ?";
      params.push(limit);
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/category/:id", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM products WHERE category_id = ? AND is_enabled = 1 AND stock > 0",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/featured", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM products WHERE is_featured = 1 AND is_enabled = 1 AND stock > 0 LIMIT 8");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    const [rows] = await db.query(
      "SELECT * FROM products WHERE is_enabled = 1 AND stock > 0 AND product_name LIKE ?",
      [`%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

module.exports = router;
