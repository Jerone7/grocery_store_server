require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const db = await mysql.createConnection({
        host: process.env.MYSQLHOST,
        port: Number(process.env.MYSQLPORT),
        user: process.env.MYSQLUSER,
        password: process.env.MYSQLPASSWORD,
        database: process.env.MYSQLDATABASE
    });

    try {
        // Check if phone column exists
        const [rows] = await db.query('SHOW COLUMNS FROM users LIKE "phone"');
        if (rows.length > 0) {
            console.log('✅ phone column already exists. No migration needed.');
        } else {
            await db.query('ALTER TABLE users ADD COLUMN phone VARCHAR(15) DEFAULT NULL');
            console.log('✅ phone column added successfully!');
        }

        // Also show current users table structure
        const [cols] = await db.query('SHOW COLUMNS FROM users');
        console.log('\nCurrent users table columns:');
        cols.forEach(c => console.log(' -', c.Field, c.Type));
    } catch (e) {
        console.error('❌ Error:', e.message);
    }

    await db.end();
})();
