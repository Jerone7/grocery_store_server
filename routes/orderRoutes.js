const express = require("express");
const router = express.Router();
const db = require("../db/db");

async function getTableColumns(connOrPool, tableName) {
    const [rows] = await connOrPool.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return new Set(rows.map((row) => row.COLUMN_NAME));
}

function buildInsert(tableName, data, availableColumns) {
    const entries = Object.entries(data).filter(([key, value]) => availableColumns.has(key) && value !== undefined);

    if (entries.length === 0) {
        throw new Error(`No compatible columns found for ${tableName}`);
    }

    return {
        sql: `INSERT INTO ${tableName} (${entries.map(([key]) => key).join(", ")})
              VALUES (${entries.map(() => "?").join(", ")})`,
        values: entries.map(([, value]) => value),
    };
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

    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const orderColumns = await getTableColumns(conn, "orders");
        if (!orderColumns.has("user_email")) {
            throw new Error("orders.user_email column is required");
        }

        const orderDate = new Date();
        const orderInsert = buildInsert(
            "orders",
            {
                user_email,
                payment_method: payment_method || "upi",
                payment_details: req.body.payment_details || null,
                delivery_address: delivery_address || "",
                item_total: Number(item_total) || 0,
                delivery_charge: Number(delivery_charge) || 0,
                handling_charge: Number(handling_charge) || 0,
                grand_total: Number(grand_total) || 0,
                status: "pending",
                order_date: orderDate,
            },
            orderColumns
        );

        const [orderResult] = await conn.query(orderInsert.sql, orderInsert.values);
        const orderId = orderResult.insertId;

        const itemColumns = await getTableColumns(conn, "order_items");
        if (!itemColumns.has("order_id") || !itemColumns.has("product_id")) {
            throw new Error("order_items table must contain order_id and product_id columns");
        }

        for (const item of items) {
            if (item.product_id == null) {
                throw new Error("Each order item must include product_id");
            }

            const quantity = Number(item.quantity) || 1;
            const price = Number(item.price) || 0;
            const lineAmount = Number((price * quantity).toFixed(2));

            const itemInsert = buildInsert(
                "order_items",
                {
                    order_id: orderId,
                    product_id: item.product_id,
                    product_name: item.product_name || "",
                    image_url: item.image_url || "",
                    quantity,
                    price,
                    amount: lineAmount,
                    order_date: orderDate,
                },
                itemColumns
            );

            await conn.query(itemInsert.sql, itemInsert.values);
        }

        await conn.commit();
        return res.status(201).json({ success: true, order_id: orderId });
    } catch (err) {
        await conn.rollback();
        console.error("Order error:", err);
        return res.status(500).json({ error: "Failed to place order" });
    } finally {
        conn.release();
    }
});

// GET /api/orders?email=user@example.com - fetch orders for a user
router.get("/", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        const orderColumns = await getTableColumns(db, "orders");
        const itemColumns = await getTableColumns(db, "order_items");

        const orderIdColumn = orderColumns.has("id") ? "id" : orderColumns.has("order_id") ? "order_id" : null;
        const orderDateColumn = orderColumns.has("created_at") ? "created_at" : orderColumns.has("order_date") ? "order_date" : null;

        if (!orderIdColumn) {
            throw new Error("orders table must contain either id or order_id");
        }

        const orderByColumn = orderDateColumn || orderIdColumn;
        const [orders] = await db.query(
            `SELECT * FROM orders WHERE user_email = ? ORDER BY ${orderByColumn} DESC`,
            [email]
        );

        const itemIdExpr = itemColumns.has("id")
            ? "oi.id"
            : itemColumns.has("order_item_id")
                ? "oi.order_item_id"
                : "NULL";
        const itemNameExpr = itemColumns.has("product_name") ? "oi.product_name" : "p.product_name";
        const itemImageExpr = itemColumns.has("image_url") ? "oi.image_url" : "p.image_url";
        const itemPriceExpr = itemColumns.has("price")
            ? "oi.price"
            : itemColumns.has("amount")
                ? "oi.amount"
                : itemColumns.has("line_total")
                    ? "oi.line_total"
                    : "0";
        const itemQtyExpr = itemColumns.has("quantity") ? "oi.quantity" : "1";
        const needsProductJoin = !itemColumns.has("product_name") || !itemColumns.has("image_url");

        for (const order of orders) {
            const orderId = order[orderIdColumn];
            order.id = order.id || orderId;

            if (!order.created_at && orderDateColumn && order[orderDateColumn]) {
                order.created_at = order[orderDateColumn];
            }

            const [items] = await db.query(
                `SELECT
                    ${itemIdExpr} AS id,
                    oi.order_id,
                    oi.product_id,
                    ${itemNameExpr} AS product_name,
                    ${itemImageExpr} AS image_url,
                    ${itemPriceExpr} AS price,
                    ${itemQtyExpr} AS quantity
                 FROM order_items oi
                 ${needsProductJoin ? "LEFT JOIN products p ON p.product_id = oi.product_id" : ""}
                 WHERE oi.order_id = ?`,
                [orderId]
            );

            order.items = items;
        }

        return res.json(orders);
    } catch (err) {
        console.error("Fetch orders error:", err);
        return res.status(500).json({ error: "Failed to fetch orders" });
    }
});


// GET /api/orders/all - admin: fetch ALL orders with items and payment info
router.get("/all", async (req, res) => {
    try {
        const orderColumns = await getTableColumns(db, "orders");
        const itemColumns = await getTableColumns(db, "order_items");

        const orderIdColumn = orderColumns.has("id") ? "id" : "order_id";
        const orderDateColumn = orderColumns.has("created_at") ? "created_at" : orderColumns.has("order_date") ? "order_date" : null;
        const orderByColumn = orderDateColumn || orderIdColumn;

        const [orders] = await db.query(
            `SELECT * FROM orders ORDER BY ${orderByColumn} DESC`
        );

        const itemIdExpr = itemColumns.has("id") ? "oi.id" : itemColumns.has("order_item_id") ? "oi.order_item_id" : "NULL";
        const itemNameExpr = itemColumns.has("product_name") ? "oi.product_name" : "p.product_name";
        const itemImageExpr = itemColumns.has("image_url") ? "oi.image_url" : "p.image_url";
        const itemPriceExpr = itemColumns.has("price")
            ? "oi.price"
            : itemColumns.has("amount") ? "oi.amount"
                : itemColumns.has("line_total") ? "oi.line_total"
                    : "0";
        const itemQtyExpr = itemColumns.has("quantity") ? "oi.quantity" : "1";
        const needsProductJoin = !itemColumns.has("product_name") || !itemColumns.has("image_url");

        for (const order of orders) {
            const orderId = order[orderIdColumn];
            order.id = order.id || orderId;
            if (!order.created_at && orderDateColumn && order[orderDateColumn]) {
                order.created_at = order[orderDateColumn];
            }

            const [items] = await db.query(
                `SELECT
                    ${itemIdExpr}    AS id,
                    oi.order_id,
                    oi.product_id,
                    ${itemNameExpr}  AS product_name,
                    ${itemImageExpr} AS image_url,
                    ${itemPriceExpr} AS price,
                    ${itemQtyExpr}   AS quantity
                 FROM order_items oi
                 ${needsProductJoin ? "LEFT JOIN products p ON p.product_id = oi.product_id" : ""}
                 WHERE oi.order_id = ?`,
                [orderId]
            );
            order.items = items;
        }

        return res.json(orders);
    } catch (err) {
        console.error("Admin fetch all orders error:", err);
        return res.status(500).json({ error: "Failed to fetch all orders" });
    }
});

module.exports = router;

