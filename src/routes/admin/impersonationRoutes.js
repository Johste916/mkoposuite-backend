// routes/admin/impersonationRoutes.js
'use strict';
const express = require('express');
const router = express.Router();

const IMP = { tenantId: null, startedAt: null, by: null };

router.post('/tenants/:id/start', (req, res) => {
  const id = String(req.params.id);
  IMP.tenantId = id;
  IMP.startedAt = new Date().toISOString();
  IMP.by = req.user?.id || 'support';
  return res.ok({ ok: true, token: `impersonate:${id}`, context: IMP });
});

router.get('/session', (_req, res) => res.ok({ context: IMP }));
router.delete('/session', (_req, res) => {
  IMP.tenantId = null; IMP.startedAt = null; IMP.by = null;
  return res.ok({ ok: true });
});

module.exports = router;
