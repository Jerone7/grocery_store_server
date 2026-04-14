const router = require("express").Router();
const Banner = require("../models/Banner");

router.get("/", async (_req, res) => {
  try {
    const rows = await Banner.find().sort({ id: 1 }).lean();
    res.json(rows);
  } catch (error) {
    console.error("Error fetching banners:", error);
    res.status(500).json({ message: "Failed to fetch banners" });
  }
});

router.get("/:type", async (req, res) => {
  const { type } = req.params;

  if (!["main", "sub"].includes(type)) {
    return res.status(400).json({ message: "Invalid banner type" });
  }

  try {
    const rows = await Banner.find({ type }).sort({ id: 1 }).lean();
    res.json(rows);
  } catch (error) {
    console.error(`Error fetching ${type} banners:`, error);
    res.status(500).json({ message: "Failed to fetch banners" });
  }
});

module.exports = router;
