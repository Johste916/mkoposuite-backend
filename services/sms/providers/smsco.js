'use strict';
const axios = require('axios');

const getKey = () => {
  const k = process.env.SMSCO_API_KEY || process.env.SMSCO_KEY || process.env.SMS_API_KEY;
  if (!k) throw new Error('SMSCO_API_KEY is not set');
  return k;
};

/** Convert to SMS.co.tz expected dest: digits only, country code prefix (no +) */
const toSmsCoDest = (raw) => {
  const cc = String(process.env.DEFAULT_COUNTRY_CODE || '+255');
  const ccDigits = cc.replace(/\D/g, ''); // "+255" -> "255"
  let t = String(raw || '').trim();
  t = t.replace(/[^\d+]/g, ''); // keep digits and + for detection
  if (t.startsWith('+')) t = t.slice(1);     // "+2557..." -> "2557..."
  if (/^0\d{8,}$/.test(t)) return ccDigits + t.slice(1); // "07..." -> "2557..."
  if (/^\d{8,13}$/.test(t) && !t.startsWith(ccDigits)) return ccDigits + t; // "769..." -> "255769..."
  return t.replace(/[^\d]/g, '');
};

exports.send = async ({ to, text, senderId }) => {
  const api_key = getKey();
  const dest = toSmsCoDest(to);
  const senderid = encodeURIComponent(senderId || process.env.SMSCO_SENDER_ID || 'MKOPOSUITE');
  const msg = encodeURIComponent(String(text || ''));

  const url = `https://www.sms.co.tz/api.php?do=sms&api_key=${encodeURIComponent(api_key)}&senderid=${senderid}&dest=${dest}&msg=${msg}`;
  const { data } = await axios.get(url, { timeout: 15000 });

  // Expected: "OK,<detail>,<id>" or "ERR,INVALIDNUMBER" etc.
  const parts = String(data || '').split(',');
  const status = parts[0];
  const detail = parts[1] || '';
  const id = parts[2] || null;

  if (status !== 'OK') {
    const err = detail || 'SEND_FAILED';
    const e = new Error(`SMS.co.tz error: ${err}`);
    e.code = 'SMSCO_ERR';
    e.detail = detail;
    throw e;
  }
  return { id, provider: 'smsco.tz', status: 'queued', detail };
};

// Try balance; if provider doesn’t expose it for your account, return nulls gracefully
exports.balance = async () => {
  try {
    const api_key = getKey();
    const { data } = await axios.get(
      `https://www.sms.co.tz/api.php?do=balance&api_key=${encodeURIComponent(api_key)}`,
      { timeout: 15000 }
    );
    // Try to parse "TZS,1234.56" or similar; fall through on unknown format
    const parts = String(data || '').split(',');
    const currency = (parts[0] || 'TZS').trim();
    const amount = Number((parts[1] || '').replace(/,/g, ''));
    return Number.isFinite(amount) ? { amount, currency } : { amount: null, currency: 'TZS' };
  } catch {
    return { amount: null, currency: 'TZS' };
  }
};
