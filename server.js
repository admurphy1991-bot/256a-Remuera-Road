const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('railway.internal')
        ? { rejectUnauthorized: false }
        : false
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS visitors (
            id BIGINT PRIMARY KEY,
            name TEXT NOT NULL,
            company TEXT,
            type TEXT,
            contact TEXT,
            site_safe_number TEXT,
            car_rego TEXT,
            sign_in_time TIMESTAMPTZ NOT NULL,
            sign_out_time TIMESTAMPTZ
        )
    `);
}

function toVisitorJson(row) {
    return {
        id: Number(row.id),
        name: row.name,
        company: row.company,
        type: row.type,
        contact: row.contact,
        siteSafeNumber: row.site_safe_number,
        carRego: row.car_rego,
        signInTime: row.sign_in_time,
        signOutTime: row.sign_out_time
    };
}

// Get all visitors
app.get('/api/visitors', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM visitors ORDER BY sign_in_time ASC');
        res.json(result.rows.map(toVisitorJson));
    } catch (error) {
        res.status(500).json({ error: 'Failed to read visitors' });
    }
});

// Add new visitor (sign in)
app.post('/api/visitors', async (req, res) => {
    try {
        const { name, company, type, contact, siteSafeNumber, carRego } = req.body;
        const id = Date.now();
        const signInTime = new Date().toISOString();

        const result = await pool.query(
            `INSERT INTO visitors (id, name, company, type, contact, site_safe_number, car_rego, sign_in_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [id, name, company, type, contact || null, siteSafeNumber || null, carRego || null, signInTime]
        );

        res.json(toVisitorJson(result.rows[0]));
    } catch (error) {
        res.status(500).json({ error: 'Failed to add visitor' });
    }
});

// Sign out visitor
app.put('/api/visitors/:id/signout', async (req, res) => {
    try {
        const signOutTime = new Date().toISOString();
        const result = await pool.query(
            'UPDATE visitors SET sign_out_time = $1 WHERE id = $2 RETURNING *',
            [signOutTime, req.params.id]
        );

        if (result.rows.length > 0) {
            res.json(toVisitorJson(result.rows[0]));
        } else {
            res.status(404).json({ error: 'Visitor not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to sign out visitor' });
    }
});

// Start server
initDb().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║   🏗️  Site Visitor Management Server                      ║
║                                                           ║
║   Server running on: http://localhost:${PORT}              ║
║                                                           ║
║   To access from other devices on your network:          ║
║   Find your computer's IP address and use:               ║
║   http://YOUR-IP-ADDRESS:${PORT}                          ║
║                                                           ║
║   Press Ctrl+C to stop the server                        ║
╚═══════════════════════════════════════════════════════════╝
        `);
    });
}).catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
});
