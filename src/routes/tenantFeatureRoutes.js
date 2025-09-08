// routes/tenantFeatureRoutes.js
'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });

// Fallback stores when no DB/services exist
const mem = {
  tickets: new Map(), // id -> ticket
  nextId: 1,
  smsLogs: [],
};

function hasModels(req) {
  const m = req.app.get('models');
  return m && typeof m === 'object' ? m : null;
}

/* ------------------------------- Tickets ---------------------------------- */
// List tenant tickets
router.get('/:tenantId/tickets', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const models = hasModels(req);
  try {
    if (models?.SupportTicket) {
      const items = await models.SupportTicket.findAll({
        where: { tenantId }, order: [['updatedAt', 'DESC']], limit: 100,
      });
      return res.ok(items);
    }
    const items = Array.from(mem.tickets.values()).filter(t => t.tenantId === tenantId);
    res.setHeader('X-Total-Count', String(items.length));
    return res.ok(items);
  } catch (e) { return res.fail(500, e.message); }
});

// Create ticket
router.post('/:tenantId/tickets', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const b = req.body || {};
  const models = hasModels(req);
  try {
    if (models?.SupportTicket) {
      const created = await models.SupportTicket.create({
        tenantId, subject: b.subject || 'Support ticket', status: 'open',
        body: b.body || null,
      });
      return res.status(201).json(created);
    }
    const id = String(mem.nextId++);
    const now = new Date().toISOString();
    const t = { id, tenantId, subject: b.subject || 'Support ticket', status: 'open', messages: b.body ? [{ from: 'requester', body: String(b.body), at: now }] : [], createdAt: now, updatedAt: now };
    mem.tickets.set(id, t);
    return res.status(201).json(t);
  } catch (e) { return res.fail(500, e.message); }
});

// Add message
router.post('/:tenantId/tickets/:id/messages', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const id = String(req.params.id);
  const b = req.body || {};
  const models = hasModels(req);
  try {
    if (models?.SupportMessage && models?.SupportTicket) {
      const ticket = await models.SupportTicket.findOne({ where: { id, tenantId } });
      if (!ticket) return res.fail(404, 'Ticket not found');
      await models.SupportMessage.create({ ticketId: ticket.id, from: b.from || 'support', body: String(b.body || '') });
      await ticket.update({ updatedAt: new Date() });
      const reload = await models.SupportTicket.findByPk(ticket.id, { include: [{ model: models.SupportMessage, as: 'messages', order: [['createdAt', 'ASC']] }] });
      return res.ok(reload);
    }
    const t = mem.tickets.get(id);
    if (!t || t.tenantId !== tenantId) return res.fail(404, 'Ticket not found');
    t.messages.push({ from: b.from || 'support', body: String(b.body || ''), at: new Date().toISOString() });
    t.updatedAt = new Date().toISOString();
    return res.ok(t);
  } catch (e) { return res.fail(500, e.message); }
});

// Change status
router.patch('/:tenantId/tickets/:id', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const id = String(req.params.id);
  const status = req.body?.status ? String(req.body.status).toLowerCase() : null;
  if (!status || !['open', 'resolved', 'canceled'].includes(status)) return res.fail(400, 'Invalid status');
  const models = hasModels(req);
  try {
    if (models?.SupportTicket) {
      const t = await models.SupportTicket.findOne({ where: { id, tenantId } });
      if (!t) return res.fail(404, 'Ticket not found');
      await t.update({ status });
      return res.ok(t);
    }
    const t = mem.tickets.get(id);
    if (!t || t.tenantId !== tenantId) return res.fail(404, 'Ticket not found');
    t.status = status; t.updatedAt = new Date().toISOString(); return res.ok(t);
  } catch (e) { return res.fail(500, e.message); }
});

for (const toStatus of ['resolve', 'cancel', 'reopen']) {
  router.post(`/:tenantId/tickets/:id/${toStatus}`, async (req, res) => {
    const map = { resolve: 'resolved', cancel: 'canceled', reopen: 'open' };
    req.body = { status: map[toStatus] };
    return router.handle(req, res);
  });
}

/* --------------------------------- SMS ------------------------------------ */
router.post('/:tenantId/sms/send', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const { to, message, from } = req.body || {};
  if (!to || !message) return res.fail(400, 'to and message are required');
  const models = hasModels(req);
  try {
    // If you have an SMS adapter, plug it here
    if (models?.SmsLog) {
      const created = await models.SmsLog.create({ tenantId, to, message, from: from || 'MkopoSuite', status: 'queued' });
      return res.ok({ ok: true, messageId: created.id, status: created.status });
    }
    const item = { id: Date.now(), tenantId, to: String(to), from: from || 'MkopoSuite', message: String(message), at: new Date().toISOString(), status: 'queued' };
    mem.smsLogs.push(item);
    return res.ok({ ok: true, messageId: item.id, status: item.status });
  } catch (e) { return res.fail(500, e.message); }
});

router.get('/:tenantId/sms/logs', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const models = hasModels(req);
  try {
    if (models?.SmsLog) {
      const items = await models.SmsLog.findAll({ where: { tenantId }, limit: 100, order: [['createdAt', 'DESC']] });
      return res.ok({ items });
    }
    const items = mem.smsLogs.filter(x => x.tenantId === tenantId).slice(-100);
    return res.ok({ items });
  } catch (e) { return res.fail(500, e.message); }
});

/* --------------------------- Billing by phone ------------------------------ */
router.get('/:tenantId/billing/phone/lookup', async (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!phone) return res.fail(400, 'phone query is required');
  // Hook: use billing provider if available
  return res.ok({
    tenantId: String(req.params.tenantId),
    phone,
    customerId: `CUS-${phone.slice(-6) || '000000'}`,
    name: 'Demo Customer',
    balance: 0,
    invoicesCount: 0,
    lastInvoiceAt: null,
  });
});

/* ------------------------------- Enrichment -------------------------------- */
router.get('/:tenantId/enrich/phone', (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!phone) return res.fail(400, 'phone query is required');
  return res.ok({
    tenantId: String(req.params.tenantId),
    phone,
    e164: phone.startsWith('+') ? phone : `+${phone}`,
    countryHint: 'TZ',
    carrierHint: 'Vodacom',
    lineType: 'mobile',
    risk: { disposable: false, recentPort: false, score: 0.1 },
  });
});

router.get('/:tenantId/enrich/email', (req, res) => {
  const email = String(req.query.email || '').trim();
  if (!email) return res.fail(400, 'email query is required');
  const domain = email.includes('@') ? email.split('@')[1] : '';
  return res.ok({
    tenantId: String(req.params.tenantId),
    email,
    domain,
    deliverability: 'unknown',
    mxPresent: true,
    disposable: false,
  });
});

router.get('/:tenantId/enrich/org', (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.fail(400, 'name query is required');
  return res.ok({
    tenantId: String(req.params.tenantId),
    name,
    industry: 'Microfinance',
    size: '11-50',
    website: null,
    location: null,
  });
});

module.exports = router;
