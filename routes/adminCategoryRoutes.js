const express = require("express");

const db = require("../db/db");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const [categories] = await db.query("SELECT * FROM categories");
    return res.json(categories);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req, res) => {
  const { name } = req.body;

  try {
    const [result] = await db.query("INSERT INTO categories (name) VALUES (?)", [name]);
    return res.status(201).json({ id: result.insertId, name });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    await db.query("UPDATE categories SET name = ? WHERE id = ?", [name, id]);
    return res.json({ message: "Category updated successfully" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await db.query("DELETE FROM categories WHERE id = ?", [id]);
    return res.json({ message: "Category deleted successfully" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
