const express = require('express');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'visitors.json');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize data file if it doesn't exist
async function initDataFile() {
    try {
        await fs.access(DATA_FILE);
    } catch {
        await fs.writeFile(DATA_FILE, JSON.stringify([]));
    }
}

// Get all visitors
app.get('/api/visitors', async (req, res) => {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).json({ error: 'Failed to read visitors' });
    }
});

// Add new visitor (sign in)
app.post('/api/visitors', async (req, res) => {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const visitors = JSON.parse(data);
        
        const newVisitor = {
            id: Date.now(),
            ...req.body,
            signInTime: new Date().toISOString(),
            signOutTime: null
        };
        
        visitors.push(newVisitor);
        await fs.writeFile(DATA_FILE, JSON.stringify(visitors, null, 2));
        
        res.json(newVisitor);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add visitor' });
    }
});

// Sign out visitor
app.put('/api/visitors/:id/signout', async (req, res) => {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        const visitors = JSON.parse(data);
        
        const visitor = visitors.find(v => v.id === parseInt(req.params.id));
        if (visitor) {
            visitor.signOutTime = new Date().toISOString();
            await fs.writeFile(DATA_FILE, JSON.stringify(visitors, null, 2));
            res.json(visitor);
        } else {
            res.status(404).json({ error: 'Visitor not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to sign out visitor' });
    }
});

// Start server
initDataFile().then(() => {
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
});
