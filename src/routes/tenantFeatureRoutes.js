// routes/tenantFeatureRoutes.js
'use strict';
const express = require('express');
const router = express.Router({ mergeParams: true });

/* -------------------------- Safe helpers (no-op if app already adds) -------------------------- */
router.use((req, res, next) => {
  if (!res.ok)   res.ok   = (data, extra = {}) => {
    if (typeof extra.total === 'number') res.setHeader('X-Total-Count', String(extra.total));
    if (extra.filename) res.setHeader('Content-Disposition', `attachment; filename="${extra.filename}"`);
    return res.json(data);
  };
  if (!res.fail) res.fail = (status, message, extra = {}) => res.status(status).json({ error: message, ...extra });
  next();
});

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const qInt  = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const getModels = (req) => {
  const m = req.app.get('models');
  return m && typeof m === 'object' ? m : null;
};

/* ------------------------------ In-memory fallback stores ------------------------------ */
const mem = {
  tickets: new Map(), // id -> ticket
  nextId: 1,
  smsLogs: [],
};

/* ==================================== Tickets ==================================== */

/** GET /:tenantId/tickets  (supports ?status=&q=&limit=&offset=) */
router.get('/:tenantId/tickets', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const status = req.query.status ? String(req.query.status).toLowerCase() : null;
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const limit = clamp(qInt(req.query.limit, 50), 1, 200);
  const offset = clamp(qInt(req.query.offset, 0), 0, 50_000);

  const models = getModels(req);
  try {
    if (models?.SupportTicket) {
      const where = { tenantId };
      if (status && ['open', 'resolved', 'canceled'].includes(status)) where.status = status;

      const { rows, count } = await models.SupportTicket.findAndCountAll({
        where,
        order: [['updatedAt', 'DESC']],
        limit,
        offset,
      });

      // Optional "q" client-side filter to avoid dialect-specific ILIKE in fallback mode
      const filtered = q
        ? rows.filter(t => String(t.subject || '').toLowerCase().includes(q))
        : rows;

      res.setHeader('X-Total-Count', String(q ? filtered.length : count));
      return res.ok(filtered);
    }

    // Fallback: in-memory
    let items = Array.from(mem.tickets.values()).filter(t => t.tenantId === tenantId);
    if (status && ['open','resolved','canceled'].includes(status)) items = items.filter(t => t.status === status);
    if (q) items = items.filter(t => String(t.subject || '').toLowerCase().includes(q));
    const total = items.length;
    items = items.sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(offset, offset + limit);
    res.setHeader('X-Total-Count', String(total));
    return res.ok(items);
  } catch (e) {
    return res.fail(500, e.message || 'Failed to list tickets');
  }
});

/** POST /:tenantId/tickets  body: { subject?, body? } */
router.post('/:tenantId/tickets', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const b = req.body || {};
  const subject = typeof b.subject === 'string' && b.subject.trim() ? b.subject.trim() : 'Support ticket';
  const models = getModels(req);

  try {
    if (models?.SupportTicket) {
      const created = await models.SupportTicket.create({
        tenantId,
        subject,
        status: 'open',
        body: b.body || null,
      });
      return res.status(201).json(created);
    }

    // Fallback
    const id = String(mem.nextId++);
    const now = new Date().toISOString();
    const t = {
      id, tenantId, subject, status: 'open',
      messages: b.body ? [{ from: 'requester', body: String(b.body), at: now }] : [],
      createdAt: now, updatedAt: now
    };
    mem.tickets.set(id, t);
    return res.status(201).json(t);
  } catch (e) {
    return res.fail(500, e.message || 'Failed to create ticket');
  }
});

/** helper: load & mutate status consistently */
async function setTicketStatus(models, { id, tenantId, status }) {
  if (models?.SupportTicket) {
    const t = await models.SupportTicket.findOne({ where: { id, tenantId } });
    if (!t) return null;
    await t.update({ status });
    return t;
  }
  const t = mem.tickets.get(String(id));
  if (!t || t.tenantId !== tenantId) return null;
  t.status = status;
  t.updatedAt = new Date().toISOString();
  return t;
}

/** POST /:tenantId/tickets/:id/messages  body: { from?, body } */
router.post('/:tenantId/tickets/:id/messages', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const id = String(req.params.id);
  const b = req.body || {};
  const from = b.from || 'support';
  const body = String(b.body || '');
  const models = getModels(req);

  try {
    if (models?.SupportMessage && models?.SupportTicket) {
      const ticket = await models.SupportTicket.findOne({ where: { id, tenantId } });
      if (!ticket) return res.fail(404, 'Ticket not found');
      await models.SupportMessage.create({ ticketId: ticket.id, from, body });
      await ticket.update({ updatedAt: new Date() });

      // Reload with messages in ASC order
      const reload = await models.SupportTicket.findByPk(ticket.id, {
        include: [{ model: models.SupportMessage, as: 'messages' }],
        order: [[{ model: models.SupportMessage, as: 'messages' }, 'createdAt', 'ASC']],
      });
      return res.ok(reload);
    }

    // Fallback
    const t = mem.tickets.get(id);
    if (!t || t.tenantId !== tenantId) return res.fail(404, 'Ticket not found');
    t.messages.push({ from, body, at: new Date().toISOString() });
    t.updatedAt = new Date().toISOString();
    return res.ok(t);
  } catch (e) {
    return res.fail(500, e.message || 'Failed to add message');
  }
});

/** PATCH /:tenantId/tickets/:id  body: { status } */
router.patch('/:tenantId/tickets/:id', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const id = String(req.params.id);
  const status = req.body?.status ? String(req.body.status).toLowerCase() : null;
  if (!status || !['open', 'resolved', 'canceled'].includes(status)) return res.fail(400, 'Invalid status');

  const models = getModels(req);
  try {
    const t = await setTicketStatus(models, { id, tenantId, status });
    if (!t) return res.fail(404, 'Ticket not found');
    return res.ok(t);
  } catch (e) {
    return res.fail(500, e.message || 'Failed to update ticket');
  }
});

/** POST aliases: resolve/cancel/reopen (no body required) */
for (const toStatus of ['resolve', 'cancel', 'reopen']) {
  const target = { resolve: 'resolved', cancel: 'canceled', reopen: 'open' }[toStatus];
  router.post(`/:tenantId/tickets/:id/${toStatus}`, async (req, res) => {
    const tenantId = String(req.params.tenantId);
    const id = String(req.params.id);
    try {
      const t = await setTicketStatus(getModels(req), { id, tenantId, status: target });
      if (!t) return res.fail(404, 'Ticket not found');
      return res.ok(t);
    } catch (e) {
      return res.fail(500, e.message || 'Failed to change ticket status');
    }
  });
}

/* ===================================== SMS ===================================== */

/** POST /:tenantId/sms/send  body: { to, message, from? } */
router.post('/:tenantId/sms/send', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const { to, message } = req.body || {};
  const from = (req.body?.from || 'MkopoSuite');

  if (!to || !message) return res.fail(400, 'to and message are required');

  const models = getModels(req);
  try {
    if (models?.SmsLog) {
      const created = await models.SmsLog.create({ tenantId, to: String(to), message: String(message), from, status: 'queued' });
      return res.ok({ ok: true, messageId: created.id, status: created.status });
    }

    // Fallback
    const item = {
      id: Date.now(),
      tenantId,
      to: String(to),
      from,
      message: String(message),
      at: new Date().toISOString(),
      status: 'queued'
    };
    mem.smsLogs.push(item);
    return res.ok({ ok: true, messageId: item.id, status: item.status });
  } catch (e) {
    return res.fail(500, e.message || 'Failed to queue SMS');
  }
});

/** GET /:tenantId/sms/logs  (supports ?limit=&offset=) */
router.get('/:tenantId/sms/logs', async (req, res) => {
  const tenantId = String(req.params.tenantId);
  const limit = clamp(qInt(req.query.limit, 100), 1, 200);
  const offset = clamp(qInt(req.query.offset, 0), 0, 50_000);

  const models = getModels(req);
  try {
    if (models?.SmsLog) {
      const { rows, count } = await models.SmsLog.findAndCountAll({
        where: { tenantId },
        order: [['createdAt', 'DESC']],
        limit, offset
      });
      res.setHeader('X-Total-Count', String(count));
      return res.ok({ items: rows });
    }

    // Fallback
    const all = mem.smsLogs.filter(x => x.tenantId === tenantId).sort((a,b) => (b.at||'').localeCompare(a.at||''));
    const items = all.slice(offset, offset + limit);
    res.setHeader('X-Total-Count', String(all.length));
    return res.ok({ items });
  } catch (e) {
    return res.fail(500, e.message || 'Failed to load SMS logs');
  }
});

/* ============================ Billing by phone (lookup) ============================ */

router.get('/:tenantId/billing/phone/lookup', async (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (!phone) return res.fail(400, 'phone query is required');
  // Hook a real provider here if available; leaving structure intact
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

/* ================================== Enrichment ================================== */

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
