'use strict';
const express = require('express');
const router = express.Router();

const { authenticateUser, requireAuth, authorizeRoles } = require('../../middleware/authMiddleware');
const admin = require('../../controllers/admin/tenantsController');

// protect all admin tenant endpoints
router.use(authenticateUser, requireAuth, authorizeRoles('admin', 'director', 'superadmin'));

// index/read
router.get('/', admin.list);
router.get('/:id', admin.read);

// core updates
router.patch('/:id/core', admin.updateCore);

// entitlements & limits
router.put('/:id/entitlements', admin.setEntitlements);
router.put('/:id/limits', admin.setLimits);

// invoices
router.get('/:id/invoices', admin.listInvoices);
router.post('/:id/invoices', admin.createInvoice);
router.post('/:id/invoices/:invoiceId/paid', admin.markPaid);
router.post('/:id/invoices/:invoiceId/resend', admin.resendInvoice);
router.post('/:id/invoices/sync', admin.syncInvoices);

// comms & utility
router.post('/:id/notify', admin.notify);
router.post('/:id/impersonate', admin.impersonate);

module.exports = router;
