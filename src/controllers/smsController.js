'use strict';
const svc = require('../services/sms');

let db; try { db = require('../models'); } catch { try { db = require('../../models'); } catch {} }

const norm = (v) => String(v || '').trim();
const toE164 = (raw) => {
  let t = norm(raw).replace(/[^\d+]/g, '');
  if (t.startsWith('+')) return t;
  const cc = String(process.env.DEFAULT_COUNTRY_CODE || '+255');
  if (/^0\d{8,}$/.test(t)) return cc + t.slice(1);
  if (/^\d{8,13}$/.test(t)) return cc + t;
  return t;
};

// tiny helper to detect model column by either name or mapped field
const hasCol = (model, col) =>
  !!(model?.rawAttributes &&
     (model.rawAttributes[col] ||
      Object.values(model.rawAttributes).some(a => a.field === col)));

async function resolveSenderId(req) {
  // Allow explicit override from body only if env flag is on (optional)
  const allowBody = /^(1|true|yes|on)$/i.test(String(process.env.SMS_ALLOW_BODY_SENDERID || ''));
  if (allowBody) {
    const b = norm(req.body.senderId || req.body.senderid);
    if (b) return b;
  }

  const tid = req.headers['x-tenant-id'] || req.user?.tenantId || req.query.tenantId;
  if (tid && db?.Tenant) {
    const t = await db.Tenant.findByPk(tid).catch(() => null);
    if (t) {
      // probe a few common column names without breaking if absent
      const fields = ['sms_sender_id','sms_senderid','smsSenderId','sender_id','sms_sender'];
      for (const f of fields) {
        if (hasCol(db.Tenant, f) && (t.get?.(f) ?? t[f])) {
          const val = String(t.get?.(f) ?? t[f] ?? '').trim();
          if (val) return val;
        }
      }
    }
  }
  return process.env.SMSCO_SENDER_ID || process.env.SMS_DEFAULT_SENDER_ID || 'MKOPOSUITE';
}

exports.send = async (req, res) => {
  try {
    const to = toE164(req.body.to || req.body.phone || req.body.msisdn);
    const text = norm(req.body.text || req.body.message);
    if (!to || !/^\+\d{8,15}$/.test(to)) return res.status(400).json({ error: 'Invalid phone (use E.164 or local 0…)' });
    if (!text) return res.status(400).json({ error: 'Message is required' });

    const senderId = await resolveSenderId(req);
    const r = await svc.send({ to, text, senderId });

    try {
      if (db?.SmsMessage) {
        await db.SmsMessage.create({
          to, body: text, provider: r.provider, provider_id: r.id || null, status: r.status || 'queued',
        });
      }
    } catch {}

    return res.json({ ok: true, to, senderId, result: r });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'SMS send failed' });
  }
};

exports.balance = async (_req, res) => {
  try {
    const b = await svc.balance();
    return res.json({ provider: (process.env.SMS_PROVIDER || 'smsco'), ...b });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Balance failed' });
  }
};

exports.messages = async (_req, res) => {
  try {
    if (db?.SmsMessage) {
      const list = await db.SmsMessage.findAll({ order: [['createdAt', 'DESC']], limit: 50 });
      return res.json(list);
    }
    return res.json([]);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'List failed' });
  }
};

