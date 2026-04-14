const mongoose = require("mongoose");
const { getNextSequence } = require("./Counter");

const bannerSchema = new mongoose.Schema(
  {
    id: { type: Number, unique: true },
    image: { type: String, default: null },
    type: { type: String, default: null },
    resource_type: { type: String, default: null },
    resource_value: { type: String, default: null },
    storage_path: { type: String, default: null },
    is_enabled: { type: Number, default: 1 },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

bannerSchema.pre("save", async function (next) {
  if (this.isNew && !this.id) {
    this.id = await getNextSequence("banner_id");
  }
  this.updated_at = new Date();
  next();
});

bannerSchema.pre("findOneAndUpdate", function (next) {
  this.set({ updated_at: new Date() });
  next();
});

module.exports = mongoose.model("Banner", bannerSchema);
