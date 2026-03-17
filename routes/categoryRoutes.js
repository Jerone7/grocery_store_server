const router = require("express").Router();
const db = require("../db/db");

router.get("/", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM categories");
  res.json(rows);
});

module.exports = router;
