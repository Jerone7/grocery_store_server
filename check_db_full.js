require("dotenv").config();
const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/grocery_store";

async function check() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("✅  Connected");

  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log("Collections:", collections.map((c) => c.name));

    const Product = require("./models/Product");
    const Category = require("./models/Category");

    const productsCount = await Product.countDocuments();
    console.log("Products count:", productsCount);

    const enabledProductsCount = await Product.countDocuments({ is_enabled: 1 });
    console.log("Enabled products count:", enabledProductsCount);

    const categories = await Category.find().limit(5).lean();
    console.log("Categories sample:", categories);
  } catch (err) {
    console.error("Error during check:", err.message);
  } finally {
    await mongoose.disconnect();
  }
}

check();
