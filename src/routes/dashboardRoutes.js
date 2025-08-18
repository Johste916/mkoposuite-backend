// src/routes/dashboardRoutes.js
"use strict";

const express = require("express");
const router = express.Router();
const dc = require("../controllers/dashboardController");
const { authenticateUser } = require("../middleware/authMiddleware");

/**
 * Safe wrapper for missing controller functions
 * Prevents "callback undefined" crashes by returning 501
 */
const safe = (fn, name) =>
  typeof fn === "function"
    ? fn
    : (_req, res) => res.status(501).json({ error: `${name} not implemented` });

/* ======================
 * Dashboard Routes
 * ====================== */

// Filters (loan officers, branches, etc.)
router.get("/filters", authenticateUser, safe(dc.getFilters, "getFilters"));

// Summary & Trends
router.get("/summary",         authenticateUser, safe(dc.getDashboardSummary, "getDashboardSummary"));
router.get("/defaulters",      authenticateUser, safe(dc.getDefaulters, "getDefaulters"));
router.get("/monthly-trends",  authenticateUser, safe(dc.getMonthlyTrends, "getMonthlyTrends"));

// Activity & Tasks
router.get( "/activity",                   authenticateUser, safe(dc.getActivityFeed, "getActivityFeed"));
router.post("/activity/:id/comment",       authenticateUser, safe(dc.addActivityComment, "addActivityComment"));
router.post("/activity/:id/assign",        authenticateUser, safe(dc.assignActivityTask, "assignActivityTask"));

// Communications
router.get("/communications", authenticateUser, safe(dc.getGeneralCommunications, "getGeneralCommunications"));

module.exports = router;
