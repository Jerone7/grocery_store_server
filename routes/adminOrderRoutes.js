const express = require("express");

const db = require("../db/db");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const [orders] = await db.query(`
      SELECT
        id,
        user_email,
        item_total,
        delivery_charge,
        handling_charge,
        grand_total,
        status,
        created_at,
        payment_method,
        payment_details,
        delivery_address
      FROM orders
      ORDER BY created_at DESC
    `);

    return res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [items] = await db.query(
      `
        SELECT
          id,
          product_name,
          image_url,
          price,
          quantity,
          amount
        FROM order_items
        WHERE order_id = ?
      `,
      [id]
    );

    return res.json(items);
  } catch (error) {
    console.error("Error fetching order items:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required" });
  }

  try {
    await db.query("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
    return res.json({ message: "Order status updated successfully", id, status });
  } catch (error) {
    console.error("Error updating order status:", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
