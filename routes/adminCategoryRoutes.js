const express = require("express");

const Category = require("../models/Category");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const categories = await Category.find({}, { _id: 0, category_id: 1, category_name: 1 }).lean();
    return res.json(categories.map((c) => ({ id: c.category_id, name: c.category_name })));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req, res) => {
  const { name } = req.body;

  try {
    const category = await Category.create({ category_name: name });
    return res.status(201).json({ id: category.category_id, name });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    await Category.updateOne(
      { category_id: Number(id) },
      { $set: { category_name: name } }
    );
    return res.json({ message: "Category updated successfully" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await Category.deleteOne({ category_id: Number(id) });
    return res.json({ message: "Category deleted successfully" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
