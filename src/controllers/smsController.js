'use strict';
const axios = require('axios');

const truthy = (v) => ['1','true','yes','on'].includes(String(v||'').trim().toLowerCase());
const onlyDigits = (s) => String(s || '').replace(/\D+/g, '');

function normalizeMsisdn(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/[^\d+]/g, '');
  const cc = (process.env.DEFAULT_COUNTRY_CODE || '+255').replace('+', '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s[0] === '0') s = cc + s.slice(1);
  return onlyDigits(s);
}

function parseBody(b = {}) {
  const to = b.to || b.dest || b.msisdn || b.phone || b.number;
  const message = b.message || b.msg || b.text || b.body;
  const bodySender = b.senderId || b.sender || b.from;
  const allowBody = truthy(process.env.SMS_ALLOW_BODY_SENDERID);
  const senderId = allowBody && bodySender ? String(bodySender) : (process.env.SMSCO_SENDER_ID || 'MKOPOSUITE');
  return { to, message, senderId };
}

async function smscoSend(to, message, senderId) {
  const apiKey = process.env.SMSCO_API_KEY;
  if (!apiKey) {
    const err = new Error('SMS provider not configured (SMSCO_API_KEY missing)');
    err.status = 500;
    throw err;
  }

  const dest = normalizeMsisdn(to);
  if (!dest) {
    const err = new Error('Invalid destination number');
    err.status = 400;
    throw err;
  }
  if (!message || !String(message).trim()) {
    const err = new Error('Message text is required');
    err.status = 400;
    throw err;
  }

  const url = `https://www.sms.co.tz/api.php?do=sms&api_key=${apiKey}&senderid=${encodeURIComponent(senderId || '')}&dest=${dest}&msg=${encodeURIComponent(String(message))}`;

  const { data } = await axios.get(url, { timeout: 15000, responseType: 'text' });
  const str = String(data || '').trim();
  const parts = str.split(',');
  const status = (parts[0] || '').toUpperCase();

  if (status === 'OK') {
    return {
      ok: true,
      provider: 'smsco',
      detail: parts[1] || '',
      providerId: parts[2] || '',
      dest,
      senderId,
    };
  }

  const reason = (parts[1] || '').toUpperCase();
  const map = {
    INVALIDACCT: 'Invalid account or API key',
    INVALIDNUMBER: 'Invalid phone number',
    NOBALANCE: 'Insufficient SMS balance',
    CHECKINPUT: 'Invalid input (senderid/msg/dest)',
  };
  const err = new Error(map[reason] || reason || 'Unknown provider error');
  err.status = 400;
  err.providerResponse = str;
  throw err;
}

exports.send = async (req, res) => {
  try {
    const { to, message, senderId } = parseBody(req.body);
    const result = await smscoSend(to, message, senderId);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({
      error: e.message || 'SMS send failed',
      providerResponse: e.providerResponse || null,
    });
  }
};

exports.balance = async (_req, res) => {
  try {
    const apiKey = process.env.SMSCO_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing SMSCO_API_KEY' });
    const url = `https://www.sms.co.tz/api.php?do=balance&api_key=${apiKey}`;
    const { data } = await axios.get(url, { timeout: 10000, responseType: 'text' });
    res.json({ balance: String(data || '').trim() });
  } catch {
    res.status(502).json({ error: 'Failed to query balance' });
  }
};

exports.messages = async (_req, res) => res.json([]); // stub list
