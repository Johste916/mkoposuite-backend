'use strict';

const express = require('express');
const router = express.Router();

// Multer in "no files" mode so we can accept form-data safely (content only)
const multer = require('multer');
const upload = multer();

// Optional auth (won't crash if middleware is missing)
let authenticateUser = (_req, _res, next) => next();
try {
  ({ authenticateUser } = require('../middleware/authMiddleware'));
} catch { /* no-op; keep routes usable in fallback */ }

// Controller (supports either createLoanComment OR addLoanComment for compatibility)
const comments = require('../controllers/commentController');

// Small async wrapper to forward errors to Express error handler
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ----------------------------- Helpers ---------------------------------- */
function normalizeCommentBody(req, _res, next) {
  // We accept JSON or form-data. Pull "content" from either place.
  const b = req.body || {};
  // Support alternative field names just in case
  const content = b.content ?? b.message ?? b.text ?? '';
  req.normalized = {
    loanId: Number(req.params.loanId),
    content: typeof content === 'string' ? content.trim() : '',
  };
  next();
}

function ensureValidLoanId(req, res, next) {
  const loanId = Number(req.params.loanId);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return res.status(400).json({ error: 'Invalid loanId' });
  }
  next();
}

function ensureContentPresent(req, res, next) {
  const content = req.normalized?.content;
  if (!content || !content.length) {
    return res.status(400).json({ error: 'content is required' });
  }
  next();
}

/* ------------------------------ Routes ---------------------------------- */

// GET /api/comments/loan/:loanId
router.get(
  '/loan/:loanId',
  authenticateUser,
  ensureValidLoanId,
  asyncHandler(comments.listLoanComments)
);

// POST /api/comments/loan/:loanId
// Accepts JSON or form-data (no files). Body: { content: "..." }
router.post(
  '/loan/:loanId',
  authenticateUser,
  upload.none(),
  ensureValidLoanId,
  normalizeCommentBody,
  ensureContentPresent,
  asyncHandler(async (req, res) => {
    // Prefer the new name; gracefully fall back to the old one if present
    const handler =
      comments.createLoanComment ||
      comments.addLoanComment ||
      comments.create ||
      comments.add;

    if (typeof handler !== 'function') {
      return res.status(500).json({ error: 'Comment handler not implemented' });
    }

    // Reconstruct a minimal request for the controller if it expects body fields
    req.body.loanId = req.normalized.loanId;
    req.body.content = req.normalized.content;

    return handler(req, res);
  })
);

/* ----------------------------- Exports ---------------------------------- */
module.exports = router;
module.exports.default = router;
module.exports.router = router;
