const mongoose = require("mongoose");
const { getNextSequence } = require("./Counter");

const orderItemSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true },
    order_id: { type: Number, required: true },
    product_id: { type: Number, required: true },
    product_name: { type: String, default: "" },
    image_url: { type: String, default: "" },
    price: { type: Number, default: 0 },
    amount: { type: Number, default: null },
    quantity: { type: Number, default: 1 },
    order_date: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

orderItemSchema.pre("save", async function (next) {
  if (this.isNew && !this.id) {
    this.id = await getNextSequence("order_item_id");
  }
  next();
});

module.exports = mongoose.model("OrderItem", orderItemSchema);
