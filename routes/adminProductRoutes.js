const express = require("express");
const multer = require("multer");

const db = require("../db/db");
const { getSupabase, isSupabaseConfigured } = require("../config/supabase");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

let hasCheckedIsEnabledColumn = false;
let hasCheckedIsFeaturedColumn = false;
let hasCheckedStoragePathColumn = false;

const PRODUCT_BUCKET_CANDIDATES = ["product-images", "products"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/webp",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const normalizeDbBooleanValue = (value) => {
  if (Buffer.isBuffer(value)) {
    return value[0] === 1 ? 1 : 0;
  }

  if (value && typeof value === "object" && Array.isArray(value.data)) {
    return value.data[0] === 1 ? 1 : 0;
  }

  return Number(value) === 1 ? 1 : 0;
};

const ensureColumn = async (columnName, addSql, cacheFlag) => {
  if (cacheFlag.value) {
    return;
  }

  const [columns] = await db.query(
    `
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [columnName]
  );

  if (columns.length === 0) {
    await db.query(addSql);
  }

  cacheFlag.value = true;
};

const ensureIsEnabledColumn = () =>
  ensureColumn(
    "is_enabled",
    "ALTER TABLE products ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1",
    { get value() { return hasCheckedIsEnabledColumn; }, set value(v) { hasCheckedIsEnabledColumn = v; } }
  );

const ensureIsFeaturedColumn = () =>
  ensureColumn(
    "is_featured",
    "ALTER TABLE products ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0",
    { get value() { return hasCheckedIsFeaturedColumn; }, set value(v) { hasCheckedIsFeaturedColumn = v; } }
  );

const ensureStoragePathColumn = () =>
  ensureColumn(
    "storage_path",
    "ALTER TABLE products ADD COLUMN storage_path VARCHAR(255) NULL AFTER image_url",
    { get value() { return hasCheckedStoragePathColumn; }, set value(v) { hasCheckedStoragePathColumn = v; } }
  );

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

const ensureColumns = async () => {
    try {
        await Promise.all([
          ensureIsEnabledColumn(),
          ensureIsFeaturedColumn(),
          ensureStoragePathColumn(),
        ]);
    } catch (err) {
        console.error("Failed to ensure database columns:", err.message);
        // Do not block the request if this fails, as columns might already exist
    }
};

router.get("/", async (req, res) => {
  try {
    await ensureColumns();

    const includeDisabled =
      String(req.query.include_disabled || "").toLowerCase() === "true";

    const baseQuery = `
      SELECT
        product_id AS id,
        product_name AS name,
        description,
        price,
        category_id,
        stock AS stock_quantity,
        weight_quantity,
        weight_unit,
        image_url,
        storage_path,
        is_enabled,
        is_featured
      FROM products
    `;
    const query = includeDisabled ? baseQuery : `${baseQuery} WHERE is_enabled = 1`;
    const [products] = await db.query(query);

    return res.json(
      products.map((product) => ({
        ...product,
        is_enabled: normalizeDbBooleanValue(product.is_enabled),
        is_featured: normalizeDbBooleanValue(product.is_featured),
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
    await ensureColumns();
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

    const [result] = await db.query(
      `
        INSERT INTO products (
          product_name,
          description,
          price,
          category_id,
          stock,
          weight_quantity,
          weight_unit,
          image_url,
          storage_path,
          is_enabled,
          is_featured
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        name,
        description,
        price,
        category_id,
        stock_quantity,
        weight_quantity || null,
        weight_unit,
        imageUrl,
        storagePath,
        isEnabled,
        isFeatured,
      ]
    );

    return res.status(201).json({
      id: result.insertId,
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
    await ensureColumns();
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

    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) { updateFields.push("product_name = ?"); updateValues.push(name); }
    if (description !== undefined) { updateFields.push("description = ?"); updateValues.push(description); }
    if (price !== undefined) { updateFields.push("price = ?"); updateValues.push(price); }
    if (category_id !== undefined) { updateFields.push("category_id = ?"); updateValues.push(category_id); }
    if (stock_quantity !== undefined) { updateFields.push("stock = ?"); updateValues.push(stock_quantity); }
    if (weight_quantity !== undefined) { updateFields.push("weight_quantity = ?"); updateValues.push(weight_quantity || null); }
    if (weight_unit !== undefined) { updateFields.push("weight_unit = ?"); updateValues.push(weight_unit); }
    if (is_featured !== undefined) { updateFields.push("is_featured = ?"); updateValues.push(Number(is_featured) === 1 ? 1 : 0); }
    if (is_enabled !== undefined) { updateFields.push("is_enabled = ?"); updateValues.push(Number(is_enabled) === 1 ? 1 : 0); }
    if (imageUrl !== undefined) { updateFields.push("image_url = ?"); updateValues.push(imageUrl); }
    if (storagePath !== undefined) { updateFields.push("storage_path = ?"); updateValues.push(storagePath || null); }

    if (updateFields.length === 0) {
      return res.status(400).json({ message: "No fields to update" });
    }

    await db.query(
      `UPDATE products SET ${updateFields.join(", ")} WHERE product_id = ?`,
      [...updateValues, id]
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
    await ensureIsEnabledColumn();
    const [result] = await db.query(
      "UPDATE products SET is_enabled = ? WHERE product_id = ?",
      [normalizedStatus, id]
    );

    if (result.affectedRows === 0) {
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
    await db.query("DELETE FROM products WHERE product_id = ?", [id]);
    return res.json({ message: "Product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put("/toggle/:id", async (req, res) => {
  try {
    await ensureIsEnabledColumn();
    await db.query("UPDATE products SET is_enabled = NOT is_enabled WHERE product_id = ?", [
      req.params.id,
    ]);
    return res.json({ message: "Product status updated" });
  } catch (error) {
    return res.status(500).json(error);
  }
});

module.exports = router;
