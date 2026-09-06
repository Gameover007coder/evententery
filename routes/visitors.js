const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Visitor = require('../models/Visitor');
const { sendEntryPassEmail, generateQrDataUrl } = require('../utils/mailer');

const router = express.Router();

// POST /api/visitors/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await Visitor.findOne({ email: cleanEmail });
    if (existing) {
      const qrCodeDataUrl = await generateQrDataUrl(existing.qrToken);
      return res.status(200).json({
        success: true,
        alreadyRegistered: true,
        message: 'You are already registered! Here is your pass.',
        visitor: existing,
        qrCodeDataUrl,
      });
    }

    const qrToken = 'pass_' + uuidv4().substring(0, 8) + '_' + Date.now().toString(36);
    const visitor = await Visitor.create({
      name: name.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      qrToken,
    });

    // Send email asynchronously in background
    sendEntryPassEmail(visitor);

    // Generate immediate QR code data URL for instant screen presentation
    const qrCodeDataUrl = await generateQrDataUrl(qrToken);

    res.status(201).json({
      success: true,
      message: 'Registration successful!',
      visitor,
      qrCodeDataUrl,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// GET /api/visitors/pass/:token - Get pass details & QR for a specific token
router.get('/pass/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const visitor = await Visitor.findOne({ qrToken: token });
    if (!visitor) {
      return res.status(404).json({ error: 'Pass not found' });
    }

    const qrCodeDataUrl = await generateQrDataUrl(visitor.qrToken);
    res.json({
      success: true,
      visitor,
      qrCodeDataUrl,
      event: {
        name: process.env.EVENT_NAME || 'Event',
        date: process.env.EVENT_DATE || '',
        venue: process.env.EVENT_VENUE || '',
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pass' });
  }
});

module.exports = router;
