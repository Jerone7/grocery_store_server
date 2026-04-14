const mongoose = require("mongoose");
const { getNextSequence } = require("./Counter");

const orderSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true },
    user_email: { type: String, required: true },
    payment_method: { type: String, default: "upi" },
    payment_details: { type: String, default: null },
    delivery_address: { type: String, default: "" },
    item_total: { type: Number, default: 0 },
    delivery_charge: { type: Number, default: 25 },
    handling_charge: { type: Number, default: 2 },
    grand_total: { type: Number, default: 0 },
    status: { type: String, default: "pending" },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

orderSchema.pre("save", async function (next) {
  if (this.isNew && !this.id) {
    this.id = await getNextSequence("order_id");
  }
  next();
});

module.exports = mongoose.model("Order", orderSchema);
