const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

function getTransporter() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Generates a QR code data URL (base64 PNG) for display in web apps
 */
async function generateQrDataUrl(token) {
  return QRCode.toDataURL(token, {
    errorCorrectionLevel: 'H',
    width: 360,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

/**
 * Emails entry pass to visitor if SMTP is configured.
 * Does not throw so registration continues gracefully.
 */
async function sendEntryPassEmail(visitor) {
  try {
    const transporter = getTransporter();
    if (!transporter) {
      console.log(`ℹ️  SMTP not configured. Skipped email for: ${visitor.email}. Pass is displayed on-screen.`);
      return false;
    }

    const qrBuffer = await QRCode.toBuffer(visitor.qrToken, {
      errorCorrectionLevel: 'H',
      width: 400,
    });

    const eventName = process.env.EVENT_NAME || 'Event';
    const eventDate = process.env.EVENT_DATE || 'Upcoming';
    const eventVenue = process.env.EVENT_VENUE || 'Main Hall';

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <h2 style="color: #0f172a; margin-top: 0;">You're confirmed for ${eventName}!</h2>
        <p style="color: #334155; font-size: 15px;">Hi <strong>${visitor.name}</strong>,</p>
        <p style="color: #334155; font-size: 14px;">Here is your official entry pass. Show this QR code at the entrance for verification.</p>
        <div style="text-align:center; margin: 24px 0; padding: 16px; background: #f8fafc; border-radius: 8px;">
          <img src="cid:qrpass" alt="Entry QR Pass" style="width:220px; height:220px; border-radius: 6px;" />
          <div style="margin-top: 8px; font-family: monospace; font-size: 13px; color: #64748b;">${visitor.qrToken}</div>
        </div>
        <table style="width:100%; border-collapse: collapse; font-size: 14px; color: #334155;">
          <tr><td style="padding:6px 0;"><strong>Event:</strong></td><td>${eventName}</td></tr>
          <tr><td style="padding:6px 0;"><strong>Date:</strong></td><td>${eventDate}</td></tr>
          <tr><td style="padding:6px 0;"><strong>Venue:</strong></td><td>${eventVenue}</td></tr>
        </table>
        <p style="margin-top:20px; color:#64748b; font-size:12px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
          This pass is unique to you and can only be scanned once for entry.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || `Event Team <${process.env.SMTP_USER}>`,
      to: visitor.email,
      subject: `Your Entry Pass for ${eventName}`,
      html,
      attachments: [
        {
          filename: 'entry-pass-qr.png',
          content: qrBuffer,
          cid: 'qrpass',
        },
      ],
    });
    console.log(`✉️  Entry pass emailed successfully to ${visitor.email}`);
    return true;
  } catch (err) {
    console.warn(`⚠️ Could not send pass email to ${visitor.email}:`, err.message);
    return false;
  }
}

module.exports = {
  sendEntryPassEmail,
  generateQrDataUrl,
};
