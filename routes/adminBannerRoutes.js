const express = require("express");
const multer = require("multer");

const Banner = require("../models/Banner");
const { getSupabase } = require("../config/supabase");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const BANNER_BUCKET = "banners";
const PUBLIC_BUCKET_MARKER = `/object/public/${BANNER_BUCKET}/`;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/webp",
  "image/jpeg",
  "image/jpg",
  "image/png",
]);

const ALLOWED_BANNER_TYPES = new Set([
  "main_banner",
  "main_section_banner",
  "sub_banner_1",
  "sub_banner_2",
  "sub_banner_3",
  "footer_banner",
]);

const BANNER_TYPE_LABELS = {
  main_banner: "Main Banner",
  main_section_banner: "Main Section Banner",
  sub_banner_1: "Sub Banner 1",
  sub_banner_2: "Sub Banner 2",
  sub_banner_3: "Sub Banner 3",
  footer_banner: "Footer Banner",
};

const BANNER_FOLDER_BY_TYPE = {
  main_banner: "main-banner",
  main_section_banner: "main-section-banner",
  sub_banner_1: "sub-banner",
  sub_banner_2: "sub-banner",
  sub_banner_3: "sub-banner",
  footer_banner: "footer-banner",
};

const normalizeBannerType = (value) => {
  const rawType = String(value || "").toLowerCase().trim();

  const mapping = {
    main: "main_banner",
    "main-banner": "main_banner",
    mainbanner: "main_banner",
    "main section banner": "main_section_banner",
    "main-section-banner": "main_section_banner",
    mainsectionbanner: "main_section_banner",
    sub: "sub_banner_1",
    sub1: "sub_banner_1",
    "sub-1": "sub_banner_1",
    "sub banner 1": "sub_banner_1",
    "sub-banner-1": "sub_banner_1",
    sub2: "sub_banner_2",
    "sub-2": "sub_banner_2",
    "sub banner 2": "sub_banner_2",
    "sub-banner-2": "sub_banner_2",
    sub3: "sub_banner_3",
    "sub-3": "sub_banner_3",
    "sub banner 3": "sub_banner_3",
    "sub-banner-3": "sub_banner_3",
    "footer banner": "footer_banner",
    "footer-banner": "footer_banner",
    footerbanner: "footer_banner",
  };

  return mapping[rawType] || rawType;
};

const normalizeResourceType = (value) => {
  const resourceType = String(value || "custom").toLowerCase().trim();
  const allowed = new Set(["custom", "shop", "product", "category"]);
  return allowed.has(resourceType) ? resourceType : "custom";
};

const parseEnabledValue = (value, fallback = 1) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return 1;
  }

  return 0;
};

const extractStoragePathFromUrl = (publicUrl) => {
  if (!publicUrl) {
    return null;
  }

  const markerIndex = publicUrl.indexOf(PUBLIC_BUCKET_MARKER);
  if (markerIndex === -1) {
    return null;
  }

  const path = publicUrl.slice(markerIndex + PUBLIC_BUCKET_MARKER.length);
  return decodeURIComponent(path);
};

const validateFile = (file) => {
  if (!file) {
    return "Image is required.";
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return "Only webp, jpg, jpeg, and png files are allowed.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "Image size must be 2 MB or less.";
  }

  return null;
};

const mapBannerRow = (row) => {
  const normalizedType = normalizeBannerType(row.type);
  return {
    id: row.id,
    image_url: row.image,
    type: normalizedType,
    type_label: BANNER_TYPE_LABELS[normalizedType] || normalizedType,
    resource_type: normalizeResourceType(row.resource_type),
    resource_value: row.resource_value || "",
    storage_path: row.storage_path || null,
    is_enabled: row.is_enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

router.get("/", async (req, res) => {
  try {
    const filter = {};
    const requestedType = req.query.type ? normalizeBannerType(req.query.type) : null;

    if (requestedType && requestedType !== "all") {
      filter.type = requestedType;
    }

    if (String(req.query.enabled || "").toLowerCase() === "true") {
      filter.is_enabled = 1;
    }

    const rows = await Banner.find(filter)
      .sort({ updated_at: -1, id: -1 })
      .lean();

    return res.json({ banners: rows.map(mapBannerRow) });
  } catch (error) {
    console.error("Error fetching banners:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/enabled", async (_req, res) => {
  try {
    const rows = await Banner.find({ is_enabled: 1 })
      .sort({ updated_at: -1, id: -1 })
      .lean();

    return res.json({ banners: rows.map(mapBannerRow) });
  } catch (error) {
    console.error("Error fetching enabled banners:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", upload.array("images", 10), async (req, res) => {
  try {
    const bannerType = normalizeBannerType(req.body.type);
    const resourceType = normalizeResourceType(req.body.resource_type);
    const resourceValue = String(req.body.resource_value || "").trim();
    const isEnabled = parseEnabledValue(req.body.is_enabled, 1);
    const files = req.files || [];
    const supabase = getSupabase();

    if (!ALLOWED_BANNER_TYPES.has(bannerType)) {
      return res.status(400).json({ error: "Invalid banner type selected." });
    }

    if (files.length === 0) {
      return res.status(400).json({ error: "Please upload at least one banner image." });
    }

    for (const file of files) {
      const validationError = validateFile(file);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }
    }

    const createdBanners = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const safeFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const folderName = BANNER_FOLDER_BY_TYPE[bannerType];
      const storagePath = `${folderName}/${Date.now()}_${index}_${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(BANNER_BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage
        .from(BANNER_BUCKET)
        .getPublicUrl(storagePath);

      const banner = await Banner.create({
        image: publicUrlData.publicUrl,
        type: bannerType,
        resource_type: resourceType,
        resource_value: resourceValue,
        storage_path: storagePath,
        is_enabled: isEnabled,
      });

      createdBanners.push(banner);
    }

    return res.status(201).json({
      message: `${createdBanners.length} banner(s) added successfully.`,
      banners: createdBanners.map((b) => mapBannerRow(b.toObject())),
    });
  } catch (error) {
    console.error("Error creating banners:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid banner id." });
    }

    const existingBanner = await Banner.findOne({ id }).lean();
    if (!existingBanner) {
      return res.status(404).json({ error: "Banner not found." });
    }

    const requestedType = req.body.type
      ? normalizeBannerType(req.body.type)
      : normalizeBannerType(existingBanner.type);
    if (!ALLOWED_BANNER_TYPES.has(requestedType)) {
      return res.status(400).json({ error: "Invalid banner type selected." });
    }

    const resourceType = req.body.resource_type
      ? normalizeResourceType(req.body.resource_type)
      : normalizeResourceType(existingBanner.resource_type);
    const resourceValue =
      req.body.resource_value !== undefined
        ? String(req.body.resource_value || "").trim()
        : String(existingBanner.resource_value || "");
    const isEnabled =
      req.body.is_enabled !== undefined
        ? parseEnabledValue(req.body.is_enabled, existingBanner.is_enabled)
        : existingBanner.is_enabled;
    const supabase = req.file ? getSupabase() : null;

    let imageUrl = existingBanner.image;
    let storagePath = existingBanner.storage_path;

    if (req.file) {
      const validationError = validateFile(req.file);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const safeFileName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const folderName = BANNER_FOLDER_BY_TYPE[requestedType];
      const newStoragePath = `${folderName}/${Date.now()}_${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(BANNER_BUCKET)
        .upload(newStoragePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false,
        });
      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage
        .from(BANNER_BUCKET)
        .getPublicUrl(newStoragePath);
      imageUrl = publicUrlData.publicUrl;
      storagePath = newStoragePath;

      const previousStoragePath =
        existingBanner.storage_path || extractStoragePathFromUrl(existingBanner.image);
      if (previousStoragePath && previousStoragePath !== newStoragePath) {
        const { error: removeError } = await supabase.storage
          .from(BANNER_BUCKET)
          .remove([previousStoragePath]);
        if (removeError) {
          console.error("Failed to remove old banner image:", removeError);
        }
      }
    }

    await Banner.updateOne(
      { id },
      {
        $set: {
          image: imageUrl,
          type: requestedType,
          resource_type: resourceType,
          resource_value: resourceValue,
          storage_path: storagePath,
          is_enabled: isEnabled,
          updated_at: new Date(),
        },
      }
    );

    const updatedBanner = await Banner.findOne({ id }).lean();
    return res.json({
      message: "Banner updated successfully.",
      banner: mapBannerRow(updatedBanner),
    });
  } catch (error) {
    console.error("Error updating banner:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid banner id." });
    }

    const existingBanner = await Banner.findOne({ id }).lean();
    if (!existingBanner) {
      return res.status(404).json({ error: "Banner not found." });
    }

    const currentStatus = existingBanner.is_enabled;
    const isEnabled =
      req.body.is_enabled === undefined
        ? currentStatus === 1
          ? 0
          : 1
        : parseEnabledValue(req.body.is_enabled, currentStatus);

    await Banner.updateOne({ id }, { $set: { is_enabled: isEnabled, updated_at: new Date() } });
    const updatedBanner = await Banner.findOne({ id }).lean();

    return res.json({
      message: `Banner ${isEnabled === 1 ? "enabled" : "disabled"} successfully.`,
      banner: mapBannerRow(updatedBanner),
    });
  } catch (error) {
    console.error("Error toggling banner status:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid banner id." });
    }

    const existingBanner = await Banner.findOne({ id }).lean();
    if (!existingBanner) {
      return res.status(404).json({ error: "Banner not found." });
    }

    await Banner.deleteOne({ id });

    const storagePath =
      existingBanner.storage_path || extractStoragePathFromUrl(existingBanner.image);
    if (storagePath) {
      try {
        const supabase = getSupabase();
        const { error: removeError } = await supabase.storage
          .from(BANNER_BUCKET)
          .remove([storagePath]);
        if (removeError) {
          console.error("Failed to remove banner image from storage:", removeError);
        }
      } catch (storageErr) {
        console.error("Failed to remove banner image from storage:", storageErr);
      }
    }

    return res.json({ message: "Banner deleted successfully." });
  } catch (error) {
    console.error("Error deleting banner:", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
