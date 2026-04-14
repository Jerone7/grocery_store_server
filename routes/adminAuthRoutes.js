const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const AdminUser = require("../models/AdminUser");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change_this_in_production";

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Email and password are required." });
  }

  try {
    const admin = await AdminUser.findOne({ email });

    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials." });
    }

    let passwordMatch = false;

    try {
      passwordMatch = await bcrypt.compare(password, admin.password);
    } catch (_error) {
      passwordMatch = false;
    }

    if (!passwordMatch && password === admin.password) {
      passwordMatch = true;
    }

    if (!passwordMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials." });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name || admin.email,
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/verify", (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ valid: false });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({ valid: true, user: decoded });
  } catch (_error) {
    return res.status(401).json({ valid: false });
  }
});

module.exports = router;
