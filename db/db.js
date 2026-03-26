const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: process.env.MYSQLHOST || "localhost",
  port: process.env.MYSQLPORT || 3306,
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "Abcd123@#$",
  database: process.env.MYSQLDATABASE || "grocery_store",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+00:00"
});

module.exports = db;