const mongoose = require("mongoose");
const { getNextSequence } = require("./Counter");

const userSchema = new mongoose.Schema(
  {
    user_id: { type: Number, unique: true },
    name: { type: String, default: "User" },
    email: { type: String, required: true, unique: true },
    password: { type: String, default: "" },
    phone: { type: String, default: null },
    address: { type: String, default: null },
    fcm_token: { type: String, default: null },
    notifications_enabled: { type: Number, default: 0 },
    notification_token_updated_at: { type: Date, default: null },
  },
  { timestamps: false }
);

userSchema.pre("save", async function (next) {
  if (this.isNew && !this.user_id) {
    this.user_id = await getNextSequence("user_id");
  }
  next();
});

module.exports = mongoose.model("User", userSchema);
