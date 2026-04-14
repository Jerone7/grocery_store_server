const mongoose = require("mongoose");
const { getNextSequence } = require("./Counter");

const adminUserSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true },
    name: { type: String, default: "" },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
  },
  { timestamps: false }
);

adminUserSchema.pre("save", async function (next) {
  if (this.isNew && !this.id) {
    this.id = await getNextSequence("admin_user_id");
  }
  next();
});

module.exports = mongoose.model("AdminUser", adminUserSchema);
