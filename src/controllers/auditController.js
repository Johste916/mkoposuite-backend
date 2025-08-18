// backend/src/controllers/admin/auditController.js
const { Op } = require('sequelize');
const { AuditLog, User, Branch } = require('../../models');

exports.list = async (req, res) => {
  try {
    if (!AuditLog) {
      return res.json({ data: [], meta: { page: 1, limit: 20, total: 0 } });
    }

    const { limit = 50, offset = 0, category, userId, branchId, from, to } = req.query;
    const where = {};
    if (category) where.category = String(category);
    if (userId) where.userId = Number(userId);
    if (branchId) where.branchId = Number(branchId);
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt[Op.gte] = new Date(from);
      if (to)   where.createdAt[Op.lte] = new Date(to);
    }

    const rows = await AuditLog.findAll({
      where,
      include: [
        User   ? { model: User,   attributes: ['id', 'name', 'email'], required: false } : null,
        Branch ? { model: Branch, attributes: ['id', 'name'], required: false } : null,
      ].filter(Boolean),
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(limit) || 50, 200),
      offset: Number(offset) || 0,
    });

    res.json({ data: rows, meta: { limit: Number(limit) || 50, offset: Number(offset) || 0, total: rows.length } });
  } catch (err) {
    console.error('admin.audit.list error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

exports.create = async (req, res) => {
  try {
    if (!AuditLog) return res.status(501).json({ error: 'AuditLog model not available' });

    const { userId, branchId, category, message, ip, action } = req.body || {};
    const row = await AuditLog.create({
      userId: userId || req.user?.id || null,
      branchId: branchId ?? null,
      category: category || 'system',
      message: message || '',
      ip: ip || req.ip,
      action: action || null,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('admin.audit.create error:', err);
    res.status(400).json({ error: 'Failed to create audit log' });
  }
};
