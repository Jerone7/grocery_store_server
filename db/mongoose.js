const mongoose = require("mongoose");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/grocery_store";

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅  MongoDB connected"))
  .catch((err) => {
    console.error("❌  MongoDB connection error:", err.message);
    process.exit(1);
  });

module.exports = mongoose;
