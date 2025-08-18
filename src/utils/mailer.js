// backend/src/utils/mailer.js
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

const cfg = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 0),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM || '"MkopoSuite" <no-reply@localhost>',
};

function hasSmtpConfig() {
  // host+port are the minimum; auth is optional if your relay allows it
  return !!cfg.host && !!cfg.port;
}

let transporter = null;

function getTransporter() {
  if (!nodemailer || !hasSmtpConfig()) return null;
  if (!transporter) {
    const secure = cfg.port === 465; // common default
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure,
      auth: (cfg.user || cfg.pass) ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }
  return transporter;
}

/**
 * Send an email. If nodemailer or SMTP config is missing,
 * we do a DRY-RUN: log the mail and resolve successfully.
 */
async function sendMail({ to, subject, text, html, attachments } = {}) {
  const t = getTransporter();
  const payload = {
    from: cfg.from,
    to,
    subject,
    text,
    html,
    attachments,
  };

  if (!t) {
    // DRY RUN: don’t crash environments without SMTP
    console.log('[mail:dry-run]', {
      note: 'Install nodemailer and set SMTP_* env vars to enable real emails.',
      ...payload,
    });
    return { dryRun: true };
  }

  const info = await t.sendMail(payload);
  // Optional debug:
  // console.log('[mail:sent]', info.messageId);
  return info;
}

function isEmailEnabled() {
  return !!(nodemailer && hasSmtpConfig());
}

module.exports = {
  sendMail,
  isEmailEnabled,
};
