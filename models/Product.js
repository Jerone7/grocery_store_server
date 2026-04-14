const mongoose = require("mongoose");
const { getNextSequence } = require("./Counter");

const productSchema = new mongoose.Schema(
  {
    product_id: { type: Number, unique: true },
    category_id: { type: Number, default: null },
    product_name: { type: String, required: true },
    description: { type: String, default: null },
    price: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    weight_quantity: { type: Number, default: null },
    weight_unit: { type: String, default: "kg" },
    image_url: { type: String, default: null },
    storage_path: { type: String, default: null },
    is_active: { type: Number, default: 1 },
    is_enabled: { type: Number, default: 1 },
    is_featured: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

productSchema.pre("save", async function (next) {
  if (this.isNew && !this.product_id) {
    this.product_id = await getNextSequence("product_id");
  }
  next();
});

module.exports = mongoose.model("Product", productSchema);
