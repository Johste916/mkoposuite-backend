// routes/supportRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

const mem = { tickets: new Map(), nextId: 1 };
const hasModels = (req) => req.app.get('models') || null;

// List (optionally by tenantId & status)
router.get('/tickets', async (req, res) => {
  const models = hasModels(req);
  const where = {};
  if (req.query.tenantId) where.tenantId = String(req.query.tenantId);
  if (req.query.status) where.status = String(req.query.status).toLowerCase();
  try {
    if (models?.SupportTicket) {
      const items = await models.SupportTicket.findAll({ where, order: [['updatedAt', 'DESC']], limit: 200 });
      res.setHeader('X-Total-Count', String(items.length));
      return res.ok(items);
    }
    const all = Array.from(mem.tickets.values()).filter(t => (!where.tenantId || t.tenantId === where.tenantId) && (!where.status || t.status === where.status));
    res.setHeader('X-Total-Count', String(all.length));
    return res.ok(all);
  } catch (e) { return res.fail(500, e.message); }
});

router.post('/tickets', async (req, res) => {
  const models = hasModels(req);
  const b = req.body || {};
  try {
    if (models?.SupportTicket) {
      const created = await models.SupportTicket.create({
        tenantId: b.tenantId || null, subject: b.subject || 'Support ticket', status: 'open', body: b.body || null,
      });
      return res.status(201).json(created);
    }
    const id = String(mem.nextId++), now = new Date().toISOString();
    const t = { id, tenantId: b.tenantId || null, subject: b.subject || 'Support ticket', status: 'open', messages: b.body ? [{ from: 'requester', body: String(b.body), at: now }] : [], createdAt: now, updatedAt: now };
    mem.tickets.set(id, t);
    return res.status(201).json(t);
  } catch (e) { return res.fail(500, e.message); }
});

router.post('/tickets/:id/messages', async (req, res) => {
  const models = hasModels(req);
  const id = String(req.params.id);
  const b = req.body || {};
  try {
    if (models?.SupportMessage && models?.SupportTicket) {
      const ticket = await models.SupportTicket.findByPk(id);
      if (!ticket) return res.fail(404, 'Ticket not found');
      await models.SupportMessage.create({ ticketId: ticket.id, from: b.from || 'support', body: String(b.body || '') });
      const reload = await models.SupportTicket.findByPk(ticket.id, { include: [{ model: models.SupportMessage, as: 'messages' }] });
      return res.ok(reload);
    }
    const t = mem.tickets.get(id);
    if (!t) return res.fail(404, 'Ticket not found');
    t.messages.push({ from: b.from || 'support', body: String(b.body || ''), at: new Date().toISOString() });
    t.updatedAt = new Date().toISOString();
    return res.ok(t);
  } catch (e) { return res.fail(500, e.message); }
});

router.patch('/tickets/:id', async (req, res) => {
  const models = hasModels(req);
  const id = String(req.params.id);
  const status = req.body?.status ? String(req.body.status).toLowerCase() : null;
  if (!status || !['open','resolved','canceled'].includes(status)) return res.fail(400, 'Invalid status');
  try {
    if (models?.SupportTicket) {
      const t = await models.SupportTicket.findByPk(id);
      if (!t) return res.fail(404, 'Ticket not found');
      await t.update({ status });
      return res.ok(t);
    }
    const t = mem.tickets.get(id);
    if (!t) return res.fail(404, 'Ticket not found');
    t.status = status; t.updatedAt = new Date().toISOString(); return res.ok(t);
  } catch (e) { return res.fail(500, e.message); }
});

module.exports = router;
