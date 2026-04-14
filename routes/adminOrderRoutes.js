const express = require("express");

const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const {
  normalizeStatus,
  sendOrderStatusNotification,
} = require("../config/orderNotifications");

const router = express.Router();

router.get("/", async (_req, res) => {
  try {
    const orders = await Order.find(
      {},
      {
        _id: 0,
        id: 1,
        user_email: 1,
        item_total: 1,
        delivery_charge: 1,
        handling_charge: 1,
        grand_total: 1,
        status: 1,
        created_at: 1,
        payment_method: 1,
        payment_details: 1,
        delivery_address: 1,
      }
    )
      .sort({ created_at: -1 })
      .lean();

    return res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const items = await OrderItem.find(
      { order_id: Number(id) },
      {
        _id: 0,
        id: 1,
        product_name: 1,
        image_url: 1,
        price: 1,
        quantity: 1,
        amount: 1,
      }
    ).lean();

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
    const normalizedNewStatus = normalizeStatus(status);

    const existingOrder = await Order.findOne({ id: Number(id) }).lean();

    if (!existingOrder) {
      return res.status(404).json({ error: "Order not found" });
    }

    const previousStatus = normalizeStatus(existingOrder.status);

    await Order.updateOne(
      { id: Number(id) },
      { $set: { status: normalizedNewStatus } }
    );

    if (previousStatus !== normalizedNewStatus) {
      await sendOrderStatusNotification(req, {
        orderId: existingOrder.id,
        userEmail: existingOrder.user_email,
        status: normalizedNewStatus,
      });
    }

    return res.json({ message: "Order status updated successfully", id, status: normalizedNewStatus });
  } catch (error) {
    console.error("Error updating order status:", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
