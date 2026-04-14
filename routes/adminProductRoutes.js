const express = require("express");
const multer = require("multer");

const Product = require("../models/Product");
const { getSupabase, isSupabaseConfigured } = require("../config/supabase");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const PRODUCT_BUCKET_CANDIDATES = ["product-images", "products"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/webp",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const validateFile = (file) => {
  if (!file) {
    return null;
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return "Only webp, jpg, jpeg, and png files are allowed.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "Image size must be 5 MB or less.";
  }

  return null;
};

const uploadProductImage = async (file) => {
  const supabase = getSupabase();
  const safeFileName = String(file.originalname || "product-image")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `items/${Date.now()}_${safeFileName}`;
  const uploadErrors = [];

  for (const bucketName of PRODUCT_BUCKET_CANDIDATES) {
    const { error } = await supabase.storage.from(bucketName).upload(fileName, file.buffer, {
      contentType: file.mimetype,
    });

    if (error) {
      uploadErrors.push(`${bucketName}: ${error.message}`);
      continue;
    }

    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    return {
      imageUrl: publicUrlData.publicUrl,
      storagePath: fileName,
    };
  }

  throw new Error(uploadErrors.join(" | ") || "Image upload failed");
};

router.get("/", async (req, res) => {
  try {
    const includeDisabled =
      String(req.query.include_disabled || "").toLowerCase() === "true";

    const filter = includeDisabled ? {} : { is_enabled: 1 };

    const products = await Product.find(filter, {
      _id: 0,
      product_id: 1,
      product_name: 1,
      description: 1,
      price: 1,
      category_id: 1,
      stock: 1,
      weight_quantity: 1,
      weight_unit: 1,
      image_url: 1,
      storage_path: 1,
      is_enabled: 1,
      is_featured: 1,
    }).lean();

    return res.json(
      products.map((product) => ({
        id: product.product_id,
        name: product.product_name,
        description: product.description,
        price: product.price,
        category_id: product.category_id,
        stock_quantity: product.stock,
        weight_quantity: product.weight_quantity,
        weight_unit: product.weight_unit,
        image_url: product.image_url,
        storage_path: product.storage_path,
        is_enabled: product.is_enabled,
        is_featured: product.is_featured,
      }))
    );
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", upload.single("image"), async (req, res) => {
  const {
    name,
    description,
    price,
    category_id,
    stock_quantity,
    weight_quantity,
    weight_unit,
  } = req.body;
  const isEnabled = req.body.is_enabled === undefined ? 1 : Number(req.body.is_enabled) === 1 ? 1 : 0;
  const isFeatured = Number(req.body.is_featured) === 1 ? 1 : 0;
  const file = req.file;
  let imageUrl = null;
  let storagePath = null;

  try {
    console.log(`[ADMIN] Adding product: ${name}`);

    const validationError = validateFile(file);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (file) {
      if (!isSupabaseConfigured()) {
        console.warn("[ADMIN] Image provided but Supabase is not configured. Product will be saved without image.");
      } else {
        const uploadResult = await uploadProductImage(file);
        imageUrl = uploadResult.imageUrl;
        storagePath = uploadResult.storagePath;
      }
    }

    const product = await Product.create({
      product_name: name,
      description,
      price,
      category_id,
      stock: stock_quantity,
      weight_quantity: weight_quantity || null,
      weight_unit,
      image_url: imageUrl,
      storage_path: storagePath,
      is_enabled: isEnabled,
      is_featured: isFeatured,
    });

    return res.status(201).json({
      id: product.product_id,
      name,
      imageUrl,
      is_enabled: isEnabled,
      is_featured: isFeatured,
      message: "Product created successfully",
    });
  } catch (error) {
    console.error("[ADMIN] Product add error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", upload.single("image"), async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    price,
    category_id,
    stock_quantity,
    weight_quantity,
    weight_unit,
    is_featured,
    is_enabled,
  } = req.body;

  try {
    console.log(`[ADMIN] Updating product ${id}:`, req.body);

    const file = req.file;
    let imageUrl = req.body.image_url;
    let storagePath = req.body.storage_path;

    const validationError = validateFile(file);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (file) {
      console.log(`[ADMIN] Uploading new image for product ${id}`);
      if (!isSupabaseConfigured()) {
        console.warn("[ADMIN] Image provided but Supabase is not configured. Keeping existing image.");
      } else {
        const uploadResult = await uploadProductImage(file);
        imageUrl = uploadResult.imageUrl;
        storagePath = uploadResult.storagePath;
      }
    }

    const updateFields = {};
    if (name !== undefined) updateFields.product_name = name;
    if (description !== undefined) updateFields.description = description;
    if (price !== undefined) updateFields.price = price;
    if (category_id !== undefined) updateFields.category_id = category_id;
    if (stock_quantity !== undefined) updateFields.stock = stock_quantity;
    if (weight_quantity !== undefined) updateFields.weight_quantity = weight_quantity || null;
    if (weight_unit !== undefined) updateFields.weight_unit = weight_unit;
    if (is_featured !== undefined) updateFields.is_featured = Number(is_featured) === 1 ? 1 : 0;
    if (is_enabled !== undefined) updateFields.is_enabled = Number(is_enabled) === 1 ? 1 : 0;
    if (imageUrl !== undefined) updateFields.image_url = imageUrl;
    if (storagePath !== undefined) updateFields.storage_path = storagePath || null;

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    await Product.updateOne(
      { product_id: Number(id) },
      { $set: updateFields }
    );

    return res.json({ message: "Product updated successfully", imageUrl });
  } catch (error) {
    console.error("[ADMIN] Product update error:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { is_enabled } = req.body;

  if (typeof is_enabled === "undefined") {
    return res.status(400).json({ error: "is_enabled is required" });
  }

  const normalizedStatus = Number(is_enabled) === 1 ? 1 : 0;

  try {
    const result = await Product.updateOne(
      { product_id: Number(id) },
      { $set: { is_enabled: normalizedStatus } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    return res.json({
      message: `Product ${normalizedStatus === 1 ? "enabled" : "disabled"} successfully`,
      id: Number(id),
      is_enabled: normalizedStatus,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await Product.deleteOne({ product_id: Number(id) });
    return res.json({ message: "Product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put("/toggle/:id", async (req, res) => {
  try {
    const product = await Product.findOne({ product_id: Number(req.params.id) });
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    product.is_enabled = product.is_enabled === 1 ? 0 : 1;
    await product.save();
    return res.json({ message: "Product status updated" });
  } catch (error) {
    return res.status(500).json(error);
  }
});

module.exports = router;
