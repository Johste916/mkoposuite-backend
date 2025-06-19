// backend/src/utils/emailService.js
require('dotenv').config();
const nodemailer = require('nodemailer');

const {
  MAIL_HOST,
  MAIL_PORT,
  MAIL_USER,
  MAIL_PASS,
  JWT_SECRET,  // you already have this in .env
} = process.env;

// 1) Create a transporter
const transporter = nodemailer.createTransport({
  host: MAIL_HOST,
  port: parseInt(MAIL_PORT, 10),
  secure: MAIL_PORT === '465', // true for 465, false for other ports
  auth: {
    user: MAIL_USER,
    pass: MAIL_PASS,
  },
});

// 2) sendMail helper
async function sendMail(to, subject, html) {
  const info = await transporter.sendMail({
    from: `"Johsta MFC" <${MAIL_USER}>`,
    to,
    subject,
    html,
  });
  console.log(`✉️  Email sent to ${to}: ${info.messageId}`);
  return info;
}

module.exports = { sendMail };
