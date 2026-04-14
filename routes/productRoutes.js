const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

router.get("/", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    const excludeDescription = req.query.excludeDescription === "true";

    const filter = { is_enabled: 1, stock: { $gt: 0 } };

    let projection = null;
    if (excludeDescription) {
      projection = {
        _id: 0,
        product_id: 1,
        product_name: 1,
        price: 1,
        category_id: 1,
        image_url: 1,
        stock: 1,
        weight_quantity: 1,
        weight_unit: 1,
        is_featured: 1,
        is_enabled: 1,
      };
    }

    let query = Product.find(filter, projection);
    if (limit) {
      query = query.limit(limit);
    }

    const rows = await query.lean();

    // Map field names to match the existing API response
    const mapped = excludeDescription
      ? rows.map((r) => ({
          product_id: r.product_id,
          product_name: r.product_name,
          price: r.price,
          category_id: r.category_id,
          image_url: r.image_url,
          stock: r.stock,
          weight: r.weight_quantity,
          unit: r.weight_unit,
          is_featured: r.is_featured,
          is_enabled: r.is_enabled,
        }))
      : rows;

    res.json(mapped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/category/:id", async (req, res) => {
  try {
    const rows = await Product.find({
      category_id: Number(req.params.id),
      is_enabled: 1,
      stock: { $gt: 0 },
    }).lean();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/featured", async (req, res) => {
  try {
    const rows = await Product.find({
      is_featured: 1,
      is_enabled: 1,
      stock: { $gt: 0 },
    })
      .limit(8)
      .lean();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    const rows = await Product.find({
      is_enabled: 1,
      stock: { $gt: 0 },
      product_name: { $regex: q, $options: "i" },
    }).lean();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

module.exports = router;
