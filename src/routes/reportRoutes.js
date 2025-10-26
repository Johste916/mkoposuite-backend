// server/routes/reportRoutes.js
const express = require("express");

// Load controller (supports both CJS and ESM default)
let ctl = require("../controllers/reportController");
ctl = ctl && ctl.__esModule && ctl.default ? ctl.default : ctl;

const r = express.Router();

/** ----------------------------- Small utilities ----------------------------- */

/** Coerce common query types (numbers, booleans, dates) when present. */
function coerceQuery(req, _res, next) {
  const q = req.query || {};

  // Numeric coercions (id fields, pagination, amounts, year/month)
  const numKeys = [
    "branchId", "officerId", "borrowerId", "productId",
    "page", "pageSize", "minAmount", "maxAmount", "year", "month"
  ];
  for (const k of numKeys) {
    if (q[k] != null && q[k] !== "") {
      const n = Number(q[k]);
      if (Number.isFinite(n)) q[k] = n;
    }
  }

  // Booleans (future-proof – add here as needed)
  const boolKeys = [];
  for (const k of boolKeys) {
    if (typeof q[k] === "string") {
      const v = q[k].toLowerCase();
      if (v === "true" || v === "1") q[k] = true;
      if (v === "false" || v === "0") q[k] = false;
    }
  }

  req.query = q;
  next();
}

/** Log missing handler only once per name to avoid noisy logs in prod. */
const missingLogged = new Set();

/** Resolve a handler by name; if missing, return a 501 placeholder and log a clear warning */
function handler(name) {
  const fn = ctl && ctl[name];
  if (typeof fn === "function") return fn;

  if (!missingLogged.has(name)) {
    missingLogged.add(name);
    const available = Object.keys(ctl || {}).sort().join(", ");
    // eslint-disable-next-line no-console
    console.warn(
      `[reportRoutes] Missing controller handler "${name}". Got: ${typeof fn}. ` +
      `Available: [${available || "none"}]. ` +
      `Check ../controllers/reportController.{js,ts}`
    );
  }

  // Fallback: keep the app running but mark the route as not implemented
  return (req, res) => {
    res.status(501).json({
      error: `Handler "${name}" is not implemented on the server.`,
      hint: "Verify the export in controllers/reportController",
      route: req.originalUrl,
    });
  };
}

/** Convenience to register GET + OPTIONS (preflight/CORS) */
function registerGET(path, action) {
  r.options(path, (_req, res) => res.sendStatus(204));
  r.get(path, coerceQuery, action);
}

/** Convenience to mirror HEAD to an existing GET action (for “ping before open”) */
function registerHEAD(path, action) {
  // HEAD uses the same handler but should not send body.
  r.head(path, coerceQuery, async (req, res, next) => {
    try {
      // Run through the action; if it streams a body we still return 200 with no body for HEAD.
      const originalSend = res.send.bind(res);
      res.send = () => res.end(); // swallow any body for HEAD
      await action(req, res, next);
    } catch (e) {
      next(e);
    }
  });
}

/** --------------------------------- Routes --------------------------------- */

/* Health/metadata */
registerGET("/", (_req, res) => {
  res.json({
    ok: true,
    service: "reports",
    endpoints: [
      "GET    /filters",
      "GET    /borrowers/loan-summary",
      "GET    /loans/summary",
      "GET    /loans/disbursements/list",
      "GET    /loans/export/csv",
      "GET    /loans/export/pdf",
      "HEAD   /loans/export/csv",
      "HEAD   /loans/export/pdf",
      "GET    /loans/trends",
      "GET    /arrears-aging",
      "GET    /outstanding",
      "GET    /par/summary",
      "GET    /collections/summary",
      "GET    /collectors/summary",
      "GET    /disbursements/summary",
      "GET    /fees/summary",
      "GET    /loan-officers/summary",
      "GET    /loan-products/summary",
      "GET    /deferred-income",
      "GET    /deferred-income/monthly",
      "GET    /mfrs",
      "GET    /daily",
      "GET    /monthly",
      "GET    /at-a-glance",
      "GET    /all-entries",
    ],
  });
});

/* Filters */
registerGET("/filters", handler("getFilters"));

/* Borrowers */
registerGET("/borrowers/loan-summary", handler("borrowersLoanSummary"));

/* Loans (summary + disbursed register) */
registerGET("/loans/summary", handler("loansSummary"));
registerGET("/loans/disbursements/list", handler("loansDisbursedList")); // Disbursed loans register
registerGET("/loans/export/csv", handler("loansExportCSV"));
registerGET("/loans/export/pdf", handler("loansExportPDF"));
registerHEAD("/loans/export/csv", handler("loansExportCSV")); // allow HEAD ping
registerHEAD("/loans/export/pdf", handler("loansExportPDF")); // allow HEAD ping
registerGET("/loans/trends", handler("loansTrends"));

/* Arrears / PAR / Outstanding */
registerGET("/arrears-aging", handler("arrearsAging"));
registerGET("/outstanding", handler("outstandingReport"));
registerGET("/par/summary", handler("parSummary"));

/* Collections */
registerGET("/collections/summary", handler("collectionsSummary"));
registerGET("/collectors/summary", handler("collectorSummary"));

/* Disbursements / Fees / Officers / Products */
registerGET("/disbursements/summary", handler("disbursementsSummary"));
registerGET("/fees/summary", handler("feesSummary"));
registerGET("/loan-officers/summary", handler("loanOfficerSummary"));
registerGET("/loan-products/summary", handler("loanProductsSummary"));

/* Deferred Income */
registerGET("/deferred-income", handler("deferredIncome"));
registerGET("/deferred-income/monthly", handler("deferredIncomeMonthly"));

/* MFRS / Daily / Monthly / Glance / Everything */
registerGET("/mfrs", handler("mfrsRatios"));
registerGET("/daily", handler("dailyReport"));
registerGET("/monthly", handler("monthlyReport"));
registerGET("/at-a-glance", handler("atAGlance"));
registerGET("/all-entries", handler("allEntries"));

/** 405 for methods we don’t support on this router (keeps logs clean) */
r.all("*", (_req, res) => res.sendStatus(405));

module.exports = r;
