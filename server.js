const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_NAME = '456a Remuera Road';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('railway.internal')
        ? { rejectUnauthorized: false }
        : false
});

// Email alerts (near miss / observation notifications)
// Recipients are hardcoded per site request. SMTP credentials still come from
// environment variables — see README notes for setup steps (SendGrid recommended).
const ALERT_RECIPIENTS = ['joshs@sansom.co.nz', 'shaun@sansom.co.nz'];

let mailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    mailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
} else {
    console.warn('SMTP not configured — near miss/observation email alerts are disabled. Set SMTP_HOST, SMTP_USER and SMTP_PASS to enable (see README).');
}

async function sendObservationAlert(obs) {
    if (!mailTransporter) return;

    const typeLabel = obs.type === 'near_miss' ? 'Near Miss' : 'Observation';

    try {
        await mailTransporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: ALERT_RECIPIENTS.join(', '),
            subject: `[${SITE_NAME}] New ${typeLabel} Reported`,
            text: [
                `A new ${typeLabel.toLowerCase()} has been reported on site (${SITE_NAME}).`,
                '',
                `Description: ${obs.description}`,
                `Location: ${obs.location || 'Not specified'}`,
                `Reported by: ${obs.reportedBy || 'Anonymous'}`,
                `Company: ${obs.company || 'Not provided'}`,
                `Contact: ${obs.contact || 'Not provided'}`,
                `Time: ${new Date(obs.reportedTime).toLocaleString()}`
            ].join('\n')
        });
    } catch (error) {
        console.error('Failed to send observation email alert:', error);
    }
}

// Make.com (or any other) webhook — POSTs the raw observation JSON.
// Set MAKE_WEBHOOK_URL to enable; independent of the email alert above.
if (!process.env.MAKE_WEBHOOK_URL) {
    console.warn('MAKE_WEBHOOK_URL not set — near miss/observation webhook notifications are disabled.');
}

async function sendObservationWebhook(obs) {
    if (!process.env.MAKE_WEBHOOK_URL) return;

    try {
        const response = await fetch(process.env.MAKE_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(obs)
        });
        if (!response.ok) {
            console.error(`Observation webhook responded with ${response.status}`);
        }
    } catch (error) {
        console.error('Failed to send observation webhook:', error);
    }
}

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

    await pool.query(`
        CREATE TABLE IF NOT EXISTS hazards (
            id BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            location TEXT,
            reported_by TEXT,
            severity TEXT NOT NULL,
            immediate_action TEXT,
            status TEXT NOT NULL DEFAULT 'Open',
            reported_time TIMESTAMPTZ NOT NULL,
            closed_action TEXT,
            closed_by TEXT,
            closed_time TIMESTAMPTZ
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS observations (
            id BIGINT PRIMARY KEY,
            type TEXT NOT NULL,
            description TEXT NOT NULL,
            location TEXT,
            reported_by TEXT,
            company TEXT,
            contact TEXT,
            reported_time TIMESTAMPTZ NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS hazard_acknowledgements (
            id BIGINT PRIMARY KEY,
            name TEXT NOT NULL,
            company TEXT,
            acknowledged_time TIMESTAMPTZ NOT NULL
        )
    `);
}

const SEVERITY_LABELS = {
    near_miss: 'Near Miss',
    minor: 'Minor Injury',
    injury: 'Injury',
    serious: 'Serious Injury',
    fatality: 'Fatality'
};

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
        console.error('Failed to read visitors:', error);
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
        console.error('Failed to add visitor:', error);
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
        console.error('Failed to sign out visitor:', error);
        res.status(500).json({ error: 'Failed to sign out visitor' });
    }
});

function toHazardJson(row) {
    return {
        id: Number(row.id),
        description: row.description,
        location: row.location,
        reportedBy: row.reported_by,
        severity: row.severity,
        severityLabel: SEVERITY_LABELS[row.severity] || row.severity,
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
        console.error('Failed to read hazards:', error);
        res.status(500).json({ error: 'Failed to read hazards' });
    }
});

// Report a new hazard
app.post('/api/hazards', async (req, res) => {
    try {
        const { description, location, reportedBy, severity, immediateAction } = req.body;

        if (!description || !severity || !SEVERITY_LABELS[severity]) {
            return res.status(400).json({ error: 'Description and a valid severity are required' });
        }

        const id = Date.now();
        const reportedTime = new Date().toISOString();

        const result = await pool.query(
            `INSERT INTO hazards (id, description, location, reported_by, severity, immediate_action, status, reported_time)
             VALUES ($1, $2, $3, $4, $5, $6, 'Open', $7)
             RETURNING *`,
            [id, description, location || null, reportedBy || null, severity, immediateAction || null, reportedTime]
        );

        res.json(toHazardJson(result.rows[0]));
    } catch (error) {
        console.error('Failed to report hazard:', error);
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
        console.error('Failed to close out hazard:', error);
        res.status(500).json({ error: 'Failed to close out hazard' });
    }
});

function toObservationJson(row) {
    return {
        id: Number(row.id),
        type: row.type,
        description: row.description,
        location: row.location,
        reportedBy: row.reported_by,
        company: row.company,
        contact: row.contact,
        reportedTime: row.reported_time
    };
}

// Get all near miss / observation reports
app.get('/api/observations', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM observations ORDER BY reported_time DESC');
        res.json(result.rows.map(toObservationJson));
    } catch (error) {
        console.error('Failed to read observations:', error);
        res.status(500).json({ error: 'Failed to read observations' });
    }
});

// Submit a near miss / observation report (contractors & visitors)
app.post('/api/observations', async (req, res) => {
    try {
        const { type, description, location, reportedBy, company, contact } = req.body;

        if (!description || !type || (type !== 'near_miss' && type !== 'observation')) {
            return res.status(400).json({ error: 'Description and a valid type are required' });
        }

        const id = Date.now();
        const reportedTime = new Date().toISOString();

        const result = await pool.query(
            `INSERT INTO observations (id, type, description, location, reported_by, company, contact, reported_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [id, type, description, location || null, reportedBy || null, company || null, contact || null, reportedTime]
        );

        const saved = toObservationJson(result.rows[0]);
        sendObservationAlert(saved); // fire-and-forget, doesn't block the response
        sendObservationWebhook({ ...saved, siteName: SITE_NAME }); // fire-and-forget, doesn't block the response

        res.json(saved);
    } catch (error) {
        console.error('Failed to submit report:', error);
        res.status(500).json({ error: 'Failed to submit report' });
    }
});

function toAckJson(row) {
    return {
        id: Number(row.id),
        name: row.name,
        company: row.company,
        acknowledgedTime: row.acknowledged_time
    };
}

// Get all hazard board acknowledgements (for audit/CSV export)
app.get('/api/hazard-board-ack', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM hazard_acknowledgements ORDER BY acknowledged_time DESC');
        res.json(result.rows.map(toAckJson));
    } catch (error) {
        console.error('Failed to read acknowledgements:', error);
        res.status(500).json({ error: 'Failed to read acknowledgements' });
    }
});

// Record a hazard board read & acknowledge (required before sign in)
app.post('/api/hazard-board-ack', async (req, res) => {
    try {
        const { name, company } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const id = Date.now();
        const acknowledgedTime = new Date().toISOString();

        const result = await pool.query(
            `INSERT INTO hazard_acknowledgements (id, name, company, acknowledged_time)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [id, name, company || null, acknowledgedTime]
        );

        res.json(toAckJson(result.rows[0]));
    } catch (error) {
        console.error('Failed to record acknowledgement:', error);
        res.status(500).json({ error: 'Failed to record acknowledgement' });
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
