// controllers/commentController.js
'use strict';

const { Op } = require('sequelize');
const { AuditLog, sequelize } = require('../models');

async function auditLogHasColumns(...cols) {
  try {
    const qi = sequelize.getQueryInterface();
    const desc = await qi.describeTable('audit_logs');
    return cols.every(c => desc[c] || desc[c.toLowerCase()] || desc[c.toUpperCase()]);
  } catch {
    return false;
  }
}

/**
 * GET /api/comments/loan/:loanId
 * Returns comments stored in AuditLog.
 * Works whether or not entityType/entityId columns exist.
 */
exports.listLoanComments = async (req, res) => {
  try {
    const { loanId } = req.params;
    const supportsEntityCols = await auditLogHasColumns('entity_type', 'entity_id');

    let where;
    if (supportsEntityCols) {
      // Newer schema (preferred)
      where = {
        entityType: 'Loan',
        entityId: Number(loanId),
        action: 'comment',
      };
    } else {
      // Fallback schema: we don’t have entityType/entityId. Use category/action/message.
      // Convention: category='loan' (or 'loans'), action='comment', message contains "#<loanId>" or JSON with loanId
      const needle = String(loanId);
      where = {
        action: 'comment',
        category: { [Op.iLike]: 'loan%' },
        message: { [Op.iLike]: `%${needle}%` }, // message should include the loan id somewhere
      };
    }

    const rows = await AuditLog.findAll({
      where,
      order: [['createdAt', 'ASC']],
    });

    // Map to a simple comment shape
    const items = rows.map(r => ({
      id: r.id,
      loanId: Number(loanId),
      author: r.userId ? { id: r.userId } : null,
      content: r.message || '',
      createdAt: r.createdAt,
    }));

    res.json(items);
  } catch (err) {
    console.error('[comments] listLoanComments error:', err);
    // Return an empty list instead of 500 so the UI doesn’t break
    res.status(200).json([]);
  }
};

/**
 * POST /api/comments
 * Body: { loanId, content }
 */
exports.createLoanComment = async (req, res) => {
  try {
    const { loanId, content } = req.body || {};
    if (!loanId || !content) return res.status(400).json({ error: 'loanId and content are required' });

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
      payload.entityType = 'Loan';
      payload.entityId = Number(loanId);
    } else {
      // Encode the target into the message so listing can discover it
      payload.message = `[loan:${loanId}] ${payload.message}`;
    }

    const row = await AuditLog.create(payload);
    res.status(201).json({
      id: row.id,
      loanId: Number(loanId),
      author: row.userId ? { id: row.userId } : null,
      content: row.message,
      createdAt: row.createdAt,
    });
  } catch (err) {
    console.error('[comments] createLoanComment error:', err);
    res.status(500).json({ error: 'Failed to create comment' });
  }
};
