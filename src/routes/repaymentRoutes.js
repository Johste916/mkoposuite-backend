const express = require("express");
const router = express.Router();
const repaymentController = require("../controllers/repaymentController");
const { authenticateUser } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// IMPORTANT: Put specific routes before any `/:id` routes!
// Also force numeric IDs to avoid catching "/summary", "/timeseries", etc.

// =========================
// 📊 REPORTS + EXPORT
// =========================
router.get("/reports/summary", authenticateUser, repaymentController.getRepaymentsSummary);
router.get("/reports/timeseries", authenticateUser, repaymentController.getRepaymentsTimeSeries);
router.get("/export/csv", authenticateUser, repaymentController.exportRepaymentsCsv);

// =========================
// ✅ APPROVALS
// =========================
router.get("/approvals/pending", authenticateUser, repaymentController.listPendingApprovals);
// Keep both styles for frontend compatibility:
router.post("/:id(\\d+)/approve", authenticateUser, repaymentController.approveRepayment);
router.post("/:id(\\d+)/reject", authenticateUser, repaymentController.rejectRepayment);
// (Optional) alt namespace if you want:
router.post("/approvals/:id(\\d+)/approve", authenticateUser, repaymentController.approveRepayment);
router.post("/approvals/:id(\\d+)/reject", authenticateUser, repaymentController.rejectRepayment);

// =========================
// 📄 CSV UPLOAD
// =========================
router.post(
  "/upload-csv",
  authenticateUser,
  upload.single("file"),
  repaymentController.uploadRepaymentsCsv
);

// =========================
// 💰 CREATION
// =========================
router.post("/manual", authenticateUser, repaymentController.createRepayment);
router.post("/bulk", authenticateUser, repaymentController.createBulkRepayments);

// =========================
// 📥 LISTING & SEARCH
// =========================
router.get("/", authenticateUser, repaymentController.getAllRepayments);
router.get("/borrower/:borrowerId", authenticateUser, repaymentController.getRepaymentsByBorrower);
router.get("/loan/:loanId", authenticateUser, repaymentController.getRepaymentsByLoan);

// =========================
// 🚫 VOID (safe reverse)
// =========================
router.post("/:id(\\d+)/void", authenticateUser, repaymentController.voidRepayment);

// =========================
// 📄 SINGLE RECEIPT
// =========================
router.get("/:id(\\d+)", authenticateUser, repaymentController.getRepaymentById);

// =========================
// 🔔 WEBHOOKS (no auth; protect via signatures)
// =========================
router.post("/webhooks/mobile-money", repaymentController.webhookMobileMoney);
router.post("/webhooks/bank", repaymentController.webhookBank);

module.exports = router;
