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
            sign_out_time TIMESTAMPTZ,
            hazards_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
            hazards_acknowledged_time TIMESTAMPTZ
        )
    `);

    await pool.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS hazards_acknowledged BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS hazards_acknowledged_time TIMESTAMPTZ`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS hazards (
            id BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            location TEXT,
            reported_by TEXT,
            likelihood INTEGER NOT NULL,
            consequence INTEGER NOT NULL,
            risk_score INTEGER NOT NULL,
            risk_band TEXT NOT NULL,
            immediate_action TEXT,
            status TEXT NOT NULL DEFAULT 'Open',
            reported_time TIMESTAMPTZ NOT NULL,
            closed_action TEXT,
            closed_by TEXT,
            closed_time TIMESTAMPTZ
        )
    `);
}

// Sansom risk matrix bands: Critical 15-25, High 8-12, Moderate 4-6, Low 1-3
function riskBand(score) {
    if (score >= 15) return 'Critical';
    if (score >= 8) return 'High';
    if (score >= 4) return 'Moderate';
    return 'Low';
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
        signOutTime: row.sign_out_time,
        hazardsAcknowledged: row.hazards_acknowledged,
        hazardsAcknowledgedTime: row.hazards_acknowledged_time
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
        const { name, company, type, contact, siteSafeNumber, carRego, hazardsAcknowledged } = req.body;

        if (!hazardsAcknowledged) {
            return res.status(400).json({ error: 'You must acknowledge the site hazard board before signing in' });
        }

        const id = Date.now();
        const signInTime = new Date().toISOString();

        const result = await pool.query(
            `INSERT INTO visitors (id, name, company, type, contact, site_safe_number, car_rego, sign_in_time, hazards_acknowledged, hazards_acknowledged_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $8)
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

function toHazardJson(row) {
    return {
        id: Number(row.id),
        description: row.description,
        location: row.location,
        reportedBy: row.reported_by,
        likelihood: row.likelihood,
        consequence: row.consequence,
        riskScore: row.risk_score,
        riskBand: row.risk_band,
        immediateAction: row.immediate_action,
        status: row.status,
        reportedTime: row.reported_time,
        closedAction: row.closed_action,
        closedBy: row.closed_by,
        closedTime: row.closed_time
    };
}

// Get all hazards
app.get('/api/hazards', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hazards ORDER BY reported_time DESC');
        res.json(result.rows.map(toHazardJson));
    } catch (error) {
        res.status(500).json({ error: 'Failed to read hazards' });
    }
});

// Report a new hazard
app.post('/api/hazards', async (req, res) => {
    try {
        const { description, location, reportedBy, likelihood, consequence, immediateAction } = req.body;

        if (!description || !likelihood || !consequence) {
            return res.status(400).json({ error: 'Description, likelihood and consequence are required' });
        }

        const l = Number(likelihood);
        const c = Number(consequence);
        const score = l * c;
        const band = riskBand(score);
        const id = Date.now();
        const reportedTime = new Date().toISOString();

        const result = await pool.query(
            `INSERT INTO hazards (id, description, location, reported_by, likelihood, consequence, risk_score, risk_band, immediate_action, status, reported_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Open', $10)
             RETURNING *`,
            [id, description, location || null, reportedBy || null, l, c, score, band, immediateAction || null, reportedTime]
        );

        res.json(toHazardJson(result.rows[0]));
    } catch (error) {
        res.status(500).json({ error: 'Failed to report hazard' });
    }
});

// Close out a hazard
app.put('/api/hazards/:id/close', async (req, res) => {
    try {
        const { closedAction, closedBy } = req.body;
        const closedTime = new Date().toISOString();

        const result = await pool.query(
            `UPDATE hazards
             SET status = 'Closed', closed_action = $1, closed_by = $2, closed_time = $3
             WHERE id = $4
             RETURNING *`,
            [closedAction || null, closedBy || null, closedTime, req.params.id]
        );

        if (result.rows.length > 0) {
            res.json(toHazardJson(result.rows[0]));
        } else {
            res.status(404).json({ error: 'Hazard not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to close out hazard' });
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
