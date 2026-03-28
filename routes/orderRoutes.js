const express = require("express");
const router = express.Router();
const db = require("../db/db");
const { sendOrderPlacedNotification } = require("../config/orderNotifications");
const CANCEL_WINDOW_MS = 5 * 60 * 1000;
let hasCheckedOrderTables = false;

async function getTableColumns(connOrPool, tableName) {
    const [rows] = await connOrPool.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [tableName]
    );
    return new Set(rows.map((row) => row.COLUMN_NAME));
}

function resolveProductIdColumn(productColumns) {
    return productColumns.has("product_id") ? "product_id" : productColumns.has("id") ? "id" : null;
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

function resolveOrderIdColumn(orderColumns) {
    return orderColumns.has("id") ? "id" : orderColumns.has("order_id") ? "order_id" : null;
}

function resolveOrderDateColumn(orderColumns) {
    return orderColumns.has("created_at") ? "created_at" : orderColumns.has("order_date") ? "order_date" : null;
}

function decorateOrder(order, orderIdColumn, orderDateColumn) {
    const orderId = order[orderIdColumn];
    order.id = order.id || orderId;

    if (!order.created_at && orderDateColumn && order[orderDateColumn]) {
        order.created_at = order[orderDateColumn];
    }

    const createdAt = order.created_at ? new Date(order.created_at) : null;
    const remainingMs = createdAt && !Number.isNaN(createdAt.getTime())
        ? createdAt.getTime() + CANCEL_WINDOW_MS - Date.now()
        : 0;

    order.cancel_deadline_at = createdAt && !Number.isNaN(createdAt.getTime())
        ? new Date(createdAt.getTime() + CANCEL_WINDOW_MS).toISOString()
        : null;
    order.can_cancel = order.status === "pending" && remainingMs > 0;
}

async function ensureOrdersTables(connOrPool = db) {
    if (hasCheckedOrderTables) {
        return;
    }

    await connOrPool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_email VARCHAR(255) NOT NULL,
            payment_method VARCHAR(50) NOT NULL DEFAULT 'upi',
            payment_details VARCHAR(255) DEFAULT NULL,
            delivery_address TEXT,
            item_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
            delivery_charge DECIMAL(10, 2) NOT NULL DEFAULT 25,
            handling_charge DECIMAL(10, 2) NOT NULL DEFAULT 2,
            grand_total DECIMAL(10, 2) NOT NULL DEFAULT 0,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await connOrPool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            product_id INT NOT NULL,
            product_name VARCHAR(255) NOT NULL,
            image_url TEXT,
            price DECIMAL(10, 2) NOT NULL,
            amount DECIMAL(10, 2) DEFAULT NULL,
            quantity INT NOT NULL DEFAULT 1,
            order_date TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )
    `);

    const orderColumns = await getTableColumns(connOrPool, "orders");
    const orderColumnFixes = [
        ["payment_method", "ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50) NOT NULL DEFAULT 'upi' AFTER user_email"],
        ["payment_details", "ALTER TABLE orders ADD COLUMN payment_details VARCHAR(255) DEFAULT NULL AFTER payment_method"],
        ["delivery_address", "ALTER TABLE orders ADD COLUMN delivery_address TEXT AFTER payment_details"],
        ["item_total", "ALTER TABLE orders ADD COLUMN item_total DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER delivery_address"],
        ["delivery_charge", "ALTER TABLE orders ADD COLUMN delivery_charge DECIMAL(10, 2) NOT NULL DEFAULT 25 AFTER item_total"],
        ["handling_charge", "ALTER TABLE orders ADD COLUMN handling_charge DECIMAL(10, 2) NOT NULL DEFAULT 2 AFTER delivery_charge"],
        ["grand_total", "ALTER TABLE orders ADD COLUMN grand_total DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER handling_charge"],
        ["status", "ALTER TABLE orders ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending' AFTER grand_total"],
        ["created_at", "ALTER TABLE orders ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status"],
    ];

    for (const [columnName, alterSql] of orderColumnFixes) {
        if (!orderColumns.has(columnName)) {
            await connOrPool.query(alterSql);
        }
    }

    const itemColumns = await getTableColumns(connOrPool, "order_items");
    const itemColumnFixes = [
        ["order_id", "ALTER TABLE order_items ADD COLUMN order_id INT NOT NULL AFTER id"],
        ["product_id", "ALTER TABLE order_items ADD COLUMN product_id INT NOT NULL AFTER order_id"],
        ["product_name", "ALTER TABLE order_items ADD COLUMN product_name VARCHAR(255) NOT NULL DEFAULT '' AFTER product_id"],
        ["image_url", "ALTER TABLE order_items ADD COLUMN image_url TEXT AFTER product_name"],
        ["price", "ALTER TABLE order_items ADD COLUMN price DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER image_url"],
        ["amount", "ALTER TABLE order_items ADD COLUMN amount DECIMAL(10, 2) DEFAULT NULL AFTER price"],
        ["quantity", "ALTER TABLE order_items ADD COLUMN quantity INT NOT NULL DEFAULT 1 AFTER amount"],
        ["order_date", "ALTER TABLE order_items ADD COLUMN order_date TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER quantity"],
    ];

    for (const [columnName, alterSql] of itemColumnFixes) {
        if (!itemColumns.has(columnName)) {
            await connOrPool.query(alterSql);
        }
    }

    await connOrPool.query("ALTER TABLE orders MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending'");
    await connOrPool.query("ALTER TABLE order_items MODIFY COLUMN quantity INT NOT NULL DEFAULT 1");

    hasCheckedOrderTables = true;
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
    let transactionOpen = false;

    try {
        await ensureOrdersTables(conn);
        await conn.beginTransaction();
        transactionOpen = true;

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
                created_at: orderDate,
            },
            orderColumns
        );

        const [orderResult] = await conn.query(orderInsert.sql, orderInsert.values);
        const orderId = orderResult.insertId;

        const itemColumns = await getTableColumns(conn, "order_items");
        const productColumns = await getTableColumns(conn, "products");
        if (!itemColumns.has("order_id") || !itemColumns.has("product_id")) {
            throw new Error("order_items table must contain order_id and product_id columns");
        }
        const productIdColumn = resolveProductIdColumn(productColumns);
        if (!productIdColumn || !productColumns.has("stock")) {
            throw new Error("products table must contain a product id column and stock");
        }

        for (const item of items) {
            if (item.product_id == null) {
                throw new Error("Each order item must include product_id");
            }

            const quantity = Number(item.quantity) || 1;
            const price = Number(item.price) || 0;
            const lineAmount = Number((price * quantity).toFixed(2));
            const [products] = await conn.query(
                `SELECT ${productIdColumn} AS product_id, product_name, stock
                 FROM products
                 WHERE ${productIdColumn} = ?
                 LIMIT 1
                 FOR UPDATE`,
                [item.product_id]
            );

            if (products.length === 0) {
                throw new Error(`Product ${item.product_name || item.product_id} was not found`);
            }

            const product = products[0];
            const availableStock = Number(product.stock) || 0;

            if (availableStock < quantity) {
                throw new Error(
                    `${product.product_name || item.product_name || "Product"} has only ${availableStock} item(s) left in stock.`
                );
            }

            await conn.query(
                `UPDATE products
                 SET stock = stock - ?
                 WHERE ${productIdColumn} = ?`,
                [quantity, item.product_id]
            );

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
        transactionOpen = false;

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
        if (transactionOpen) {
            try {
                await conn.rollback();
            } catch (rollbackError) {
                console.error("Order rollback failed:", rollbackError);
            }
        }
        console.error("Order error:", err);
        const statusCode = /required|not found|stock/i.test(err.message) ? 400 : 500;
        return res.status(statusCode).json({
            error: statusCode === 400 ? err.message : "Failed to place order",
        });
    } finally {
        conn.release();
    }
});

// GET /api/orders?email=user@example.com - fetch orders for a user
router.get("/", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: "Email is required" });

    try {
        await ensureOrdersTables();
        const orderColumns = await getTableColumns(db, "orders");
        const itemColumns = await getTableColumns(db, "order_items");

        const orderIdColumn = resolveOrderIdColumn(orderColumns);
        const orderDateColumn = resolveOrderDateColumn(orderColumns);

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
            decorateOrder(order, orderIdColumn, orderDateColumn);
            if (order.status === "cancelled_by_customer") {
                order.status = "cancelled";
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

// PATCH /api/orders/:id/cancel - allow customers to cancel within 5 minutes
router.patch("/:id/cancel", async (req, res) => {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
        await ensureOrdersTables();
        const orderColumns = await getTableColumns(db, "orders");
        const orderIdColumn = resolveOrderIdColumn(orderColumns);
        const orderDateColumn = resolveOrderDateColumn(orderColumns);

        if (!orderIdColumn) {
            throw new Error("orders table must contain either id or order_id");
        }

        const [orders] = await db.query(
            `SELECT * FROM orders WHERE ${orderIdColumn} = ? AND user_email = ? LIMIT 1`,
            [id, email]
        );

        if (orders.length === 0) {
            return res.status(404).json({ error: "Order not found" });
        }

        const order = orders[0];
        decorateOrder(order, orderIdColumn, orderDateColumn);

        if (order.status === "cancelled" || order.status === "cancelled_by_customer") {
            return res.status(400).json({ error: "This order is already cancelled" });
        }

        if (order.status !== "pending") {
            return res.status(400).json({ error: "Unable to cancel your product" });
        }

        if (!order.can_cancel) {
            return res.status(400).json({ error: "Unable to cancel your product after 5 minutes" });
        }

        await db.query(
            `UPDATE orders SET status = ? WHERE ${orderIdColumn} = ? AND user_email = ?`,
            ["cancelled_by_customer", id, email]
        );

        return res.json({
            success: true,
            id: order.id,
            status: "cancelled_by_customer",
            can_cancel: false,
            message: "Order cancelled successfully",
        });
    } catch (err) {
        console.error("Cancel order error:", err);
        return res.status(500).json({ error: "Failed to cancel order" });
    }
});


// GET /api/orders/all - admin: fetch ALL orders with items and payment info
router.get("/all", async (req, res) => {
    try {
        await ensureOrdersTables();
        const orderColumns = await getTableColumns(db, "orders");
        const itemColumns = await getTableColumns(db, "order_items");

        const orderIdColumn = resolveOrderIdColumn(orderColumns);
        const orderDateColumn = resolveOrderDateColumn(orderColumns);
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
            decorateOrder(order, orderIdColumn, orderDateColumn);

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
