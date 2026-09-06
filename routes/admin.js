const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Visitor = require('../models/Visitor');
const { requireAdmin } = require('../utils/authMiddleware');
const { generateQrDataUrl } = require('../utils/mailer');

const router = express.Router();

// Helper to verify admin credentials
function isValidAdmin(identifier, password) {
  const adminId = (process.env.ADMIN_ID || 'admin').trim().toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

  const inputId = (identifier || '').trim().toLowerCase();
  const isMatchId = inputId === adminId || inputId === adminEmail;
  const isMatchPass = password === adminPass;

  return isMatchId && isMatchPass;
}

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { id, email, username, idOrEmail, password } = req.body;
  const identifier = idOrEmail || id || username || email;

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Please enter both Admin ID and Password.' });
  }

  if (!isValidAdmin(identifier, password)) {
    return res.status(401).json({ error: 'Invalid Admin ID or Password.' });
  }

  const tokenPayload = {
    id: process.env.ADMIN_ID || 'admin',
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
  };

  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });

  res.cookie('adminToken', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    success: true,
    token,
    admin: tokenPayload,
  });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/admin/me
router.get('/me', requireAdmin, (req, res) => {
  res.json({
    success: true,
    admin: req.admin,
    event: {
      name: process.env.EVENT_NAME || 'Grand Event 2026',
      date: process.env.EVENT_DATE || '',
      venue: process.env.EVENT_VENUE || '',
    },
  });
});

// POST /api/admin/checkin
router.post('/checkin', requireAdmin, async (req, res) => {
  try {
    const { token, visitorId } = req.body;
    if (!token && !visitorId) {
      return res.status(400).json({ error: 'No QR pass token or visitor ID provided.' });
    }

    const query = token ? { qrToken: token.trim() } : { _id: visitorId };
    const existing = await Visitor.findOne(query);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Invalid pass — Record not found.' });
    }

    if (existing.status === 'checked_in') {
      return res.status(409).json({
        success: false,
        error: 'Pass already used!',
        visitor: existing,
      });
    }

    const checkedInVisitor = await Visitor.findOneAndUpdate(
      query,
      {
        status: 'checked_in',
        checkedInAt: new Date().toISOString(),
        checkedInBy: req.admin.id || req.admin.email || 'admin',
      },
      { new: true }
    );

    return res.json({
      success: true,
      status: 'checked_in',
      visitor: checkedInVisitor,
    });
  } catch (err) {
    console.error('Checkin error:', err);
    res.status(500).json({ error: 'Check-in processing error' });
  }
});

// POST /api/admin/reset-checkin - Reset status back to pending (for re-testing)
router.post('/reset-checkin', requireAdmin, async (req, res) => {
  try {
    const { token, visitorId } = req.body;
    const query = token ? { qrToken: token.trim() } : { _id: visitorId };

    const resetVisitor = await Visitor.findOneAndUpdate(
      query,
      {
        status: 'pending',
        checkedInAt: null,
        checkedInBy: null,
      },
      { new: true }
    );

    if (!resetVisitor) {
      return res.status(404).json({ error: 'Visitor not found' });
    }

    res.json({ success: true, visitor: resetVisitor });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// GET /api/admin/visitors - List all visitors + summary counts
router.get('/visitors', requireAdmin, async (req, res) => {
  try {
    const visitors = await Visitor.find().sort({ createdAt: -1 });
    const total = visitors.length;
    const checkedIn = visitors.filter((v) => v.status === 'checked_in').length;
    const pending = total - checkedIn;

    res.json({
      success: true,
      stats: { total, checkedIn, pending },
      visitors,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve visitors' });
  }
});

// POST /api/admin/add-visitor - Admin creates a visitor directly
router.post('/add-visitor', requireAdmin, async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await Visitor.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({ error: 'Visitor with this email already exists' });
    }

    const qrToken = 'pass_' + uuidv4().substring(0, 8) + '_' + Date.now().toString(36);
    const visitor = await Visitor.create({
      name: name.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      qrToken,
    });

    const qrCodeDataUrl = await generateQrDataUrl(qrToken);

    res.status(201).json({
      success: true,
      visitor,
      qrCodeDataUrl,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add visitor' });
  }
});

// DELETE /api/admin/visitor/:id
router.delete('/visitor/:id', requireAdmin, async (req, res) => {
  try {
    await Visitor.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: 'Visitor deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete visitor' });
  }
});

module.exports = router;
