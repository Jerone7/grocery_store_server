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
        // Check users in the DB
        const [users] = await db.query('SELECT user_id, name, email, phone FROM users LIMIT 5');
        console.log('Current users:');
        users.forEach(u => console.log(' -', u.user_id, u.email, '| phone:', u.phone));

        // Try to update a phone number if there's a user
        if (users.length > 0) {
            const testEmail = users[0].email;
            const [result] = await db.query('UPDATE users SET phone = ? WHERE email = ?', ['9876543210', testEmail]);
            console.log('\nTest update result - affectedRows:', result.affectedRows);
            if (result.affectedRows > 0) {
                console.log('✅ Phone update works correctly!');
            } else {
                console.log('❌ Update affected 0 rows - email mismatch?');
            }
        }
    } catch (e) {
        console.error('❌ Error:', e.message);
    }

    await db.end();
})();
