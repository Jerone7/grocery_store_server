const db = require('../db/db');

async function check() {
    try {
        const [rows] = await db.query("SHOW TABLES LIKE 'users'");
        if (rows.length === 0) {
            console.log("Users table does not exist.");
            // Create it
            await db.query(`
        CREATE TABLE users (
          user_id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
            console.log("Users table created.");
        } else {
            console.log("Users table exists.");
            const [cols] = await db.query("DESCRIBE users");
            console.log(cols);
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
