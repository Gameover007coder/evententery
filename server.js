require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const os = require('os');

const { initDb } = require('./models/db');
const visitorRoutes = require('./routes/visitors');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/visitors', visitorRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Helper to get local IPv4 network addresses
function getNetworkIps() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// Server info endpoint (used by front-end to build mobile link QR code)
app.get('/api/info', (req, res) => {
  const ips = getNetworkIps();
  const port = process.env.PORT || 4000;
  res.json({
    appName: process.env.EVENT_NAME || 'QR Event Pass App',
    port: Number(port),
    networkIps: ips,
    adminId: process.env.ADMIN_ID || 'admin',
    adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
    event: {
      name: process.env.EVENT_NAME || 'Grand Event 2026',
      date: process.env.EVENT_DATE || '2026-10-15',
      venue: process.env.EVENT_VENUE || 'Auditorium Hall A',
    },
  });
});

// Fallback to index.html for root or unknown static GET routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 4000;

async function start() {
  // Initialize database (Mongoose or auto-fallback JSON store)
  await initDb();

  app.listen(PORT, '0.0.0.0', () => {
    const ips = getNetworkIps();
    console.log('\n============================================================');
    console.log('   EVENT QR APP IS RUNNING!');
    console.log('============================================================');
    console.log(`💻 On your computer:  http://localhost:${PORT}`);
    if (ips.length > 0) {
      console.log(`📱 On your phone (Wi-Fi):`);
      ips.forEach((ip) => {
        console.log(`   👉 http://${ip}:${PORT}`);
        console.log(`   👉 http://${ip}:${PORT}/admin-login.html (Admin Login)`);
      });
    }
    console.log('------------------------------------------------------------');
    console.log(`🔑 Admin Login ID:       ${process.env.ADMIN_ID || 'admin'}`);
    console.log(`🔑 Admin Login Email:    ${process.env.ADMIN_EMAIL || 'admin@example.com'}`);
    console.log(`🔒 Admin Password:       ${process.env.ADMIN_PASSWORD || 'admin123'}`);
    console.log('============================================================\n');
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
});
