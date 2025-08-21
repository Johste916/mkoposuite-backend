const express = require('express');
const router = express.Router();
const repaymentController = require('../controllers/repaymentController');
const { authenticateUser } = require('../middleware/authMiddleware');
const upload = require('../middleware/upload');

// =========================
// 📥 LISTING & SEARCH
// =========================
router.get('/', authenticateUser, repaymentController.getAllRepayments);
router.get('/borrower/:borrowerId', authenticateUser, repaymentController.getRepaymentsByBorrower);
router.get('/loan/:loanId', authenticateUser, repaymentController.getRepaymentsByLoan);
router.get('/:id', authenticateUser, repaymentController.getRepaymentById);

// =========================
// 💰 CREATION
// =========================
router.post('/manual', authenticateUser, repaymentController.createRepayment);
router.post('/bulk', authenticateUser, repaymentController.createBulkRepayments);

// =========================
// 📄 CSV UPLOAD
// =========================
router.post('/upload-csv', authenticateUser, upload.single('file'), repaymentController.uploadRepaymentsCsv);

// =========================
// 🧮 PREVIEW / CALCULATIONS
// =========================
router.post('/preview-allocation', authenticateUser, repaymentController.previewAllocation);

// =========================
// ✅ APPROVALS
// =========================
router.get('/approvals/pending', authenticateUser, repaymentController.listPendingApprovals);
router.post('/approvals/:id/approve', authenticateUser, repaymentController.approveRepayment);
router.post('/approvals/:id/reject', authenticateUser, repaymentController.rejectRepayment);

// =========================
// 🚫 VOID (safe reverse)
// =========================
router.post('/:id/void', authenticateUser, repaymentController.voidRepayment);

// =========================
// 📊 REPORTS + EXPORT
// =========================
router.get('/reports/summary', authenticateUser, repaymentController.getRepaymentsSummary);
router.get('/reports/timeseries', authenticateUser, repaymentController.getRepaymentsTimeSeries);
router.get('/export/csv', authenticateUser, repaymentController.exportRepaymentsCsv);

// =========================
// 🔔 WEBHOOKS (no auth; protect via signatures)
// =========================
router.post('/webhooks/mobile-money', repaymentController.webhookMobileMoney);
router.post('/webhooks/bank', repaymentController.webhookBank);

module.exports = router;
