// backend/src/controllers/admin/auditController.js
const { AuditLog, User, Branch } = require('../../models');

exports.list = async (req, res) => {
  try {
    const { limit = 50, offset = 0, category, userId, branchId } = req.query;

    const where = {};
    if (category) where.category = category;
    if (userId) where.userId = userId;
    if (branchId) where.branchId = Number(branchId);

    const include = [];
    if (User)   include.push({ model: User,   attributes: ['id', 'name', 'email'], required: false });
    if (Branch) include.push({ model: Branch, attributes: ['id', 'name'], required: false });

    const rows = await AuditLog.findAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(limit) || 50, 200),
      offset: Number(offset) || 0,
    });

    res.json(rows);
  } catch (err) {
    console.error('audit.list error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
};

exports.create = async (req, res) => {
  try {
    const { userId, branchId, category, message, ip, action } = req.body || {};

    const row = await AuditLog.create({
      userId:   userId ?? req.user?.id ?? null,
      branchId: typeof branchId === 'number' ? branchId : (req.user?.branchId ?? null),
      category: category || 'system',
      message:  message || '',
      action:   action || null,
      ip:       ip || req.ip,
      reversed: false,
    });

    res.status(201).json(row);
  } catch (err) {
    console.error('audit.create error:', err);
    res.status(400).json({ error: 'Failed to create audit log' });
  }
};

exports.remove = async (req, res) => {
  try {
    const row = await AuditLog.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('audit.remove error:', err);
    res.status(400).json({ error: 'Failed to delete log' });
  }
};

exports.reverse = async (req, res) => {
  try {
    const row = await AuditLog.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    await row.update({ reversed: true });
    res.json(row);
  } catch (err) {
    console.error('audit.reverse error:', err);
    res.status(400).json({ error: 'Failed to reverse log' });
  }
};
