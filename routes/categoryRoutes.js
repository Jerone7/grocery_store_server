const router = require("express").Router();
const Category = require("../models/Category");

router.get("/", async (req, res) => {
  try {
    const rows = await Category.find().lean();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "DB error" });
  }
});

module.exports = router;
