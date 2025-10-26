// server/routes/reportRoutes.js
const express = require("express");

// Load controller (supports both CJS and ESM default)
let ctl = require("../controllers/reportController");
ctl = ctl && ctl.__esModule && ctl.default ? ctl.default : ctl;

const r = express.Router();

/** Resolve a handler by name; if missing, return a 501 placeholder and log a clear warning */
function handler(name) {
  const fn = ctl && ctl[name];
  if (typeof fn === "function") return fn;

  const available = Object.keys(ctl || {}).sort().join(", ");
  console.warn(
    `[reportRoutes] Missing controller handler "${name}". Got: ${typeof fn}. ` +
    `Available: [${available || "none"}]. ` +
    `Check ../controllers/reportController.{js,ts}`
  );

  // Fallback: keep the app running but mark the route as not implemented
  return (req, res) => {
    res.status(501).json({
      error: `Handler "${name}" is not implemented on the server.`,
      hint: "Verify the export in controllers/reportController",
      route: req.originalUrl,
    });
  };
}

/* Filters */
r.get("/filters", handler("getFilters"));

/* Borrowers */
r.get("/borrowers/loan-summary", handler("borrowersLoanSummary"));

/* Loans (summary + disbursed register) */
r.get("/loans/summary", handler("loansSummary"));
r.get("/loans/disbursements/list", handler("loansDisbursedList")); // Disbursed loans register
r.get("/loans/export/csv", handler("loansExportCSV"));
r.get("/loans/export/pdf", handler("loansExportPDF"));
r.get("/loans/trends", handler("loansTrends"));

/* Arrears / PAR / Outstanding */
r.get("/arrears-aging", handler("arrearsAging"));
r.get("/outstanding", handler("outstandingReport"));
r.get("/par/summary", handler("parSummary"));

/* Collections */
r.get("/collections/summary", handler("collectionsSummary"));
r.get("/collectors/summary", handler("collectorSummary"));

/* Disbursements / Fees / Officers / Products */
r.get("/disbursements/summary", handler("disbursementsSummary"));
r.get("/fees/summary", handler("feesSummary"));
r.get("/loan-officers/summary", handler("loanOfficerSummary"));
r.get("/loan-products/summary", handler("loanProductsSummary"));

/* Deferred Income */
r.get("/deferred-income", handler("deferredIncome"));
r.get("/deferred-income/monthly", handler("deferredIncomeMonthly"));

/* MFRS / Daily / Monthly / Glance / Everything */
r.get("/mfrs", handler("mfrsRatios"));
r.get("/daily", handler("dailyReport"));
r.get("/monthly", handler("monthlyReport"));
r.get("/at-a-glance", handler("atAGlance"));
r.get("/all-entries", handler("allEntries"));

module.exports = r;
