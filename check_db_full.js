require('dotenv').config();
const mysql = require('mysql2/promise');

async function check() {
  console.log("Connecting to:", process.env.MYSQLHOST);
  const db = await mysql.createConnection({
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
  });

  try {
    const [tables] = await db.query("SHOW TABLES");
    console.log("Tables in database:", tables.map(t => Object.values(t)[0]));

    const [productsCount] = await db.query("SELECT COUNT(*) as count FROM products");
    console.log("Products count:", productsCount[0].count);

    const [enabledProductsCount] = await db.query("SELECT COUNT(*) as count FROM products WHERE is_enabled = 1");
    console.log("Enabled products count:", enabledProductsCount[0].count);

    const [categories] = await db.query("SELECT * FROM categories LIMIT 5");
    console.log("Categories sample:", categories);

  } catch (err) {
    console.error("Error during check:", err.message);
  } finally {
    await db.end();
  }
}

check();
