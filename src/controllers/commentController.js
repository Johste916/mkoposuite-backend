// controllers/commentController.js
'use strict';

const { Op } = require('sequelize');
const { AuditLog, sequelize } = require('../models');

let _auditCols = null;
async function auditLogHasColumns(...cols) {
  // Cache the audit_logs description for this process
  if (!_auditCols) {
    try {
      const qi = sequelize.getQueryInterface();
      const desc = await qi.describeTable('audit_logs'); // { colName: {...} }
      _auditCols = new Set(Object.keys(desc || {}));
    } catch {
      _auditCols = new Set();
    }
  }
  // Accept camel/snake/upper
  return cols.every((c) => {
    const s = String(c);
    return (
      _auditCols.has(s) ||
      _auditCols.has(s.toLowerCase()) ||
      _auditCols.has(s.toUpperCase())
    );
  });
}

/**
 * GET /api/comments/loan/:loanId
 * Returns comments associated with a loan.
 * - Preferred: filters by audit_logs.entity_type/entity_id + action='comment'
 * - Fallback: category ILIKE 'loan%' AND message contains the loan id marker
 */
exports.listLoanComments = async (req, res) => {
  try {
    const loanId = Number(req.params.loanId);
    if (!Number.isFinite(loanId)) return res.status(400).json({ error: 'Invalid loanId' });

    // Optional pagination
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 50)));
    const offset = (page - 1) * pageSize;

    const supportsEntityCols = await auditLogHasColumns('entity_type', 'entity_id');

    let where;
    if (supportsEntityCols) {
      // Address DB columns directly to avoid model-attribute naming mismatches
      // WHERE "AuditLog"."entity_type" = 'Loan' AND "AuditLog"."entity_id" = :loanId AND "action"='comment'
      where = {
        [Op.and]: [
          sequelize.where(sequelize.col('AuditLog.entity_type'), 'Loan'),
          sequelize.where(sequelize.col('AuditLog.entity_id'), loanId),
          { action: 'comment' },
        ],
      };
    } else {
      // Fallback: category + message sniffing
      // We’ll search our marker "[loan:ID]" and (loosely) plain ID as well.
      const marker = `[loan:${loanId}]`;
      where = {
        action: 'comment',
        category: { [Op.iLike]: 'loan%' },
        [Op.or]: [
          { message: { [Op.iLike]: `%${marker}%` } },
          { message: { [Op.iLike]: `%${loanId}%` } },
        ],
      };
    }

    const { rows, count } = await AuditLog.findAndCountAll({
      where,
      order: [['createdAt', 'ASC']],
      limit: pageSize,
      offset,
    });

    const items = rows.map((r) => ({
      id: r.id,
      loanId,
      author: r.userId ? { id: r.userId } : null,
      content: r.message || '',
      createdAt: r.createdAt,
    }));

    res.setHeader('X-Total-Count', String(count || items.length));
    return res.json(items);
  } catch (err) {
    console.error('[comments] listLoanComments error:', err);
    // Soft-fail so UI keeps working
    return res.status(200).json([]);
  }
};

/**
 * POST /api/comments/loan/:loanId    (router variant)
 * POST /api/comments                 (body: { loanId, content })
 */
async function _createLoanCommentCore(loanId, content, req, res) {
  const supportsEntityCols = await auditLogHasColumns('entity_type', 'entity_id');

  const payload = {
    userId: req.user?.id || null,
    branchId: req.user?.branchId || null,
    category: 'loan',
    action: 'comment',
    message: String(content),
    ip: req.ip || null,
    reversed: false,
  };

  if (supportsEntityCols) {
    // If model defines camelCase fields, Sequelize will map them to snake_case based on your model config.
    // To avoid relying on model field names, we use plain keys; most AuditLog models map these 1:1 already.
    payload.entityType = 'Loan';
    payload.entityId = Number(loanId);
  } else {
    // Encode loan id in message to be discoverable by the fallback reader
    payload.message = `[loan:${loanId}] ${payload.message}`;
  }

  const row = await AuditLog.create(payload);
  return {
    id: row.id,
    loanId: Number(loanId),
    author: row.userId ? { id: row.userId } : null,
    content: row.message,
    createdAt: row.createdAt,
  };
}

/** Body-style create: POST /api/comments  (JSON) */
exports.createLoanComment = async (req, res) => {
  try {
    const { loanId, content } = req.body || {};
    if (!loanId || !content) {
      return res.status(400).json({ error: 'loanId and content are required' });
    }
    const out = await _createLoanCommentCore(loanId, content, req, res);
    return res.status(201).json(out);
  } catch (err) {
    console.error('[comments] createLoanComment error:', err);
    return res.status(500).json({ error: 'Failed to create comment' });
  }
};

/** Route-style create: POST /api/comments/loan/:loanId  (JSON or form-data) */
exports.addLoanComment = async (req, res) => {
  try {
    const loanId = req.params.loanId || req.body?.loanId;
    const content =
      (req.body && (req.body.content || req.body.message || req.body.text)) ||
      (Array.isArray(req.files) && req.files[0]?.buffer?.toString('utf8')) || // last-resort if using multipart with a single text file
      '';

    if (!loanId || !content) {
      return res.status(400).json({ error: 'loanId and content are required' });
    }
    const out = await _createLoanCommentCore(loanId, content, req, res);
    return res.status(201).json(out);
  } catch (err) {
    console.error('[comments] addLoanComment error:', err);
    return res.status(500).json({ error: 'Failed to create comment' });
  }
};
