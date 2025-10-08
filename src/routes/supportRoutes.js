'use strict';

const express = require('express');
const router = express.Router();

let auth = {};
try { auth = require('../middleware/authMiddleware'); } catch {}
const authenticateUser = auth.authenticateUser || ((_req, _res, next) => next());
const requireAuth      = auth.requireAuth      || ((_req, _res, next) => next());

router.use(authenticateUser, requireAuth);

/* In-memory store (simple + good enough for fallbacks) */
const STORE = { TICKETS: new Map(), nextId: 1 };

function nowISO() { return new Date().toISOString(); }

/* List */
router.get('/tickets', (req, res) => {
  const tenantId = req.query.tenantId ? String(req.query.tenantId) : undefined;
  const status   = req.query.status ? String(req.query.status).toLowerCase() : undefined;
  const items = Array.from(STORE.TICKETS.values()).filter(t =>
    (!tenantId || t.tenantId === tenantId) &&
    (!status || t.status === status)
  );
  res.setHeader('X-Total-Count', String(items.length));
  res.ok(items);
});

/* Create */
router.post('/tickets', (req, res) => {
  const b = req.body || {};
  const id = String(STORE.nextId++);
  const ticket = {
    id,
    tenantId: b.tenantId || null,
    subject: b.subject || 'Support ticket',
    status: 'open',
    messages: b.body ? [{ from: 'requester', body: String(b.body), at: nowISO() }] : [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  STORE.TICKETS.set(id, ticket);
  res.status(201).json(ticket);
});

/* Message add */
router.post('/tickets/:id/messages', (req, res) => {
  const t = STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  t.messages.push({ from: b.from || 'support', body: String(b.body || ''), at: nowISO() });
  t.updatedAt = nowISO();
  res.ok(t);
});

/* ---- Comment aliases expected by some clients ---- */
router.get('/tickets/:id/comments', (req, res) => {
  const t = STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  res.ok({ items: t.messages || [] });
});
router.post('/tickets/:id/comments', (req, res) => {
  const t = STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  t.messages.push({ from: b.from || 'support', body: String(b.body || ''), at: nowISO() });
  t.updatedAt = nowISO();
  res.ok({ ok: true });
});

/* Status mutations */
router.patch('/tickets/:id', (req, res) => {
  const t = STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const status = req.body?.status ? String(req.body.status).toLowerCase() : null;
  if (status && ['open', 'resolved', 'canceled'].includes(status)) t.status = status;
  t.updatedAt = nowISO();
  res.ok(t);
});
router.post('/tickets/:id/resolve', (req, res) => {
  const t = STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  t.status = 'resolved'; t.updatedAt = nowISO(); res.ok(t);
});
router.post('/tickets/:id/cancel', (req, res) => {
  const t = STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  t.status = 'canceled'; t.updatedAt = nowISO(); res.ok(t);
});
router.post('/tickets/:id/reopen', (req, res) => {
  const t = STORE.TICKETS.get(String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  t.status = 'open'; t.updatedAt = nowISO(); res.ok(t);
});

module.exports = router;
