# QR Event Entry Pass App

A minimal, working starter for: visitors register → get an emailed QR pass →
admin scans it at the door to check them in.

## Stack
- **Backend**: Node.js + Express + MongoDB (Mongoose)
- **Frontend**: Plain HTML/CSS/JS (no build step) using [html5-qrcode](https://github.com/mebjas/html5-qrcode) via CDN for camera scanning
- **Email**: Nodemailer (SMTP)
- **QR generation**: `qrcode` npm package

## Project structure
```
qr-event-app/
├── server.js               # Express app entry point
├── models/
│   └── Visitor.js          # Mongoose schema
├── routes/
│   ├── visitors.js         # POST /api/visitors/register (public)
│   └── admin.js            # login, checkin, visitor list (admin-only)
├── utils/
│   ├── mailer.js           # generates QR + sends the pass email
│   └── authMiddleware.js   # protects admin routes with a JWT cookie
├── public/
│   ├── register.html       # visitor registration form
│   ├── admin-login.html    # admin login
│   └── scanner.html        # admin QR scanner (camera-based)
└── .env.example
```

## Setup

1. **Install dependencies**
   ```bash
   cd qr-event-app
   npm install
   ```

2. **Set up MongoDB**
   - Easiest: create a free cluster on [MongoDB Atlas](https://www.mongodb.com/atlas) and copy its connection string, OR
   - Run MongoDB locally (`mongod`) and use `mongodb://localhost:27017/qr-event-app`

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env`:
   - `MONGO_URI` — your MongoDB connection string
   - `JWT_SECRET` — any long random string
   - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — credentials for the admin scanner login
   - `SMTP_*` — your email provider's SMTP credentials (see note below)
   - `EVENT_NAME`, `EVENT_DATE`, `EVENT_VENUE` — shown in the pass email

   **SMTP note:** For Gmail, you need to create an "App Password" (not your
   regular password) under Google Account → Security → 2-Step Verification →
   App Passwords. For production events, a transactional email service like
   SendGrid or Mailgun is more reliable than Gmail SMTP.

4. **Run the server**
   ```bash
   npm start
   # or, for auto-restart on changes:
   npm run dev
   ```

5. **Open the pages**
   - Visitor registration: `http://localhost:4000/register.html`
   - Admin login: `http://localhost:4000/admin-login.html`
   - Admin scanner: `http://localhost:4000/scanner.html` (redirects to login if not authenticated)

   On the scanner page, your browser will ask for camera permission — allow
   it. On a phone, use the rear camera for the best scan distance.

## How it works

1. A visitor fills out `register.html` → backend generates a random UUID
   (`qrToken`), saves it against their record, encodes **only that token**
   into a QR image, and emails it to them.
2. Admin logs in at `admin-login.html`, which sets an httpOnly JWT cookie.
3. Admin opens `scanner.html`. The page uses the device camera to decode QR
   codes in real time and POSTs the decoded token to `/api/admin/checkin`.
4. The backend does an **atomic** MongoDB update
   (`findOneAndUpdate({ qrToken, status: 'pending' }, ...)`), so if two admins
   scan the same pass at the same instant, only one can succeed — the other
   gets "already used."

## Security notes for going to production

- The QR code only contains a random token, never personal data — so it's
  safe if someone reads/copies the code image.
- Admin auth here is a single hardcoded email/password for simplicity. For
  more than one admin, add an `Admins` collection with bcrypt-hashed
  passwords (bcryptjs is already included as a dependency for this).
- Enable `secure: true` on the cookie once you're serving over HTTPS.
- Consider rate-limiting `/api/visitors/register` to prevent spam
  registrations.
- Add HTTPS in production — camera access in browsers requires a secure
  context (HTTPS or localhost).

## Extending it

- **Dashboard**: `/api/admin/visitors` already returns all visitors + status —
  build a simple table page in `public/` to show live check-in counts.
- **Multiple events**: add an `eventId` field to the Visitor schema and filter
  by it throughout.
- **Resend pass**: add an endpoint that looks up a visitor by email and
  re-sends their existing QR (don't regenerate the token, or their old pass
  breaks).
