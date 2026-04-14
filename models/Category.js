const mongoose = require("mongoose");
const { getNextSequence } = require("./Counter");

const categorySchema = new mongoose.Schema(
  {
    category_id: { type: Number, unique: true },
    category_name: { type: String, required: true },
  },
  { timestamps: false }
);

categorySchema.pre("save", async function (next) {
  if (this.isNew && !this.category_id) {
    this.category_id = await getNextSequence("category_id");
  }
  next();
});

module.exports = mongoose.model("Category", categorySchema);
