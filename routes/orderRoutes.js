const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const Product = require("../models/Product");
const { sendOrderPlacedNotification } = require("../config/orderNotifications");

const CANCEL_WINDOW_MS = 5 * 60 * 1000;

function decorateOrder(order) {
    const createdAt = order.created_at ? new Date(order.created_at) : null;
    const remainingMs = createdAt && !Number.isNaN(createdAt.getTime())
        ? createdAt.getTime() + CANCEL_WINDOW_MS - Date.now()
        : 0;

    order.cancel_deadline_at = createdAt && !Number.isNaN(createdAt.getTime())
        ? new Date(createdAt.getTime() + CANCEL_WINDOW_MS).toISOString()
        : null;
    order.can_cancel = order.status === "pending" && remainingMs > 0;
}

// POST /api/orders - place a new order
router.post("/", async (req, res) => {
    const {
        user_email,
        payment_method,
        delivery_address,
        items,
        item_total,
        delivery_charge,
        handling_charge,
        grand_total,
    } = req.body;

    if (!user_email || !items || items.length === 0) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const session = await mongoose.startSession();

    try {
        let orderId;

        await session.withTransaction(async () => {
            const orderDate = new Date();

            const order = await Order.create(
                [{
                    user_email,
                    payment_method: payment_method || "upi",
                    payment_details: req.body.payment_details || null,
                    delivery_address: delivery_address || "",
                    item_total: Number(item_total) || 0,
                    delivery_charge: Number(delivery_charge) || 0,
                    handling_charge: Number(handling_charge) || 0,
                    grand_total: Number(grand_total) || 0,
                    status: "pending",
                    created_at: orderDate,
                }],
                { session }
            );

            orderId = order[0].id;

            for (const item of items) {
                if (item.product_id == null) {
                    throw new Error("Each order item must include product_id");
                }

                const quantity = Number(item.quantity) || 1;
                const price = Number(item.price) || 0;
                const lineAmount = Number((price * quantity).toFixed(2));

                // Atomically decrement stock only if sufficient
                const product = await Product.findOneAndUpdate(
                    {
                        product_id: item.product_id,
                        stock: { $gte: quantity },
                    },
                    { $inc: { stock: -quantity } },
                    { new: true, session }
                );

                if (!product) {
                    // Check if the product exists at all to give better error
                    const exists = await Product.findOne({ product_id: item.product_id }).session(session);
                    if (!exists) {
                        throw new Error(`Product ${item.product_name || item.product_id} was not found`);
                    }
                    const availableStock = Number(exists.stock) || 0;
                    throw new Error(
                        `${exists.product_name || item.product_name || "Product"} has only ${availableStock} item(s) left in stock.`
                    );
                }

                await OrderItem.create(
                    [{
                        order_id: orderId,
                        product_id: item.product_id,
                        product_name: item.product_name || "",
                        image_url: item.image_url || "",
                        quantity,
                        price,
                        amount: lineAmount,
                        order_date: orderDate,
                    }],
                    { session }
                );
            }
        });

        res.status(201).json({ success: true, order_id: orderId });

        void sendOrderPlacedNotification(req, {
            orderId,
            userEmail: user_email,
            grandTotal: grand_total,
        }).catch((notificationError) => {
            console.error("Order notification failed:", notificationError);
        });

        return;
    } catch (err) {
        console.error("Order error:", err);
        const statusCode = /required|not found|stock/i.test(err.message) ? 400 : 500;
        return res.status(statusCode).json({
            error: statusCode === 400 ? err.message : "Failed to place order",
        });
    } finally {
        session.endSession();
    }
});

// GET /api/orders?email=user@example.com - fetch orders for a user
router.get("/", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        const orders = await Order.find({ user_email: email })
            .sort({ created_at: -1 })
            .lean();

        for (const order of orders) {
            decorateOrder(order);
            if (order.status === "cancelled_by_customer") {
                order.status = "cancelled";
            }

            const items = await OrderItem.find(
                { order_id: order.id },
                { _id: 0, id: 1, order_id: 1, product_id: 1, product_name: 1, image_url: 1, price: 1, quantity: 1 }
            ).lean();

            order.items = items;
        }

        return res.json(orders);
    } catch (err) {
        console.error("Fetch orders error:", err);
        return res.status(500).json({ error: "Failed to fetch orders" });
    }
});

// PATCH /api/orders/:id/cancel - allow customers to cancel within 5 minutes
router.patch("/:id/cancel", async (req, res) => {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
        const order = await Order.findOne({ id: Number(id), user_email: email }).lean();

        if (!order) {
            return res.status(404).json({ error: "Order not found" });
        }

        decorateOrder(order);

        if (order.status === "cancelled" || order.status === "cancelled_by_customer") {
            return res.status(400).json({ error: "This order is already cancelled" });
        }

        if (order.status !== "pending") {
            return res.status(400).json({ error: "Unable to cancel your product" });
        }

        if (!order.can_cancel) {
            return res.status(400).json({ error: "Unable to cancel your product after 5 minutes" });
        }

        const newStatus = order.payment_method === "razorpay" ? "cancel_requested" : "cancelled_by_customer";

        await Order.updateOne(
            { id: Number(id), user_email: email },
            { $set: { status: newStatus } }
        );

        return res.json({
            success: true,
            id: order.id,
            status: newStatus,
            can_cancel: false,
            message: newStatus === "cancel_requested"
                ? "Cancellation requested. Admin will process it soon."
                : "Order cancelled successfully",
        });
    } catch (err) {
        console.error("Cancel order error:", err);
        return res.status(500).json({ error: "Failed to cancel order" });
    }
});


// GET /api/orders/all - admin: fetch ALL orders with items and payment info
router.get("/all", async (req, res) => {
    try {
        const orders = await Order.find()
            .sort({ created_at: -1 })
            .lean();

        for (const order of orders) {
            decorateOrder(order);

            const items = await OrderItem.find(
                { order_id: order.id },
                { _id: 0, id: 1, order_id: 1, product_id: 1, product_name: 1, image_url: 1, price: 1, quantity: 1 }
            ).lean();

            order.items = items;
        }

        return res.json(orders);
    } catch (err) {
        console.error("Admin fetch all orders error:", err);
        return res.status(500).json({ error: "Failed to fetch all orders" });
    }
});

module.exports = router;
