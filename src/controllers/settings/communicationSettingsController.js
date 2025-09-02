// backend/controllers/settings/communicationSettingsController.js
const db = require('../../models');
const { Communication, CommunicationAttachment } = db;
const { Op } = db.Sequelize;

// Use case-insensitive like on Postgres, else normal like
const likeOp = db.sequelize?.getDialect?.() === 'postgres' ? Op.iLike : Op.like;

/** GET /api/settings/communications */
exports.listCommunications = async (req, res) => {
  try {
    const {
      q = '',
      page = 1,
      pageSize = 20,
      type,
      priority,
      isActive,
      showOnDashboard,
      showInTicker,
      branchId,
    } = req.query;

    const where = {};
    if (q) where[Op.or] = [{ title: { [likeOp]: `%${q}%` } }, { text: { [likeOp]: `%${q}%` } }];
    if (type) where.type = type;
    if (priority) where.priority = priority;
    if (typeof isActive !== 'undefined') where.isActive = String(isActive) === 'true';
    if (typeof showOnDashboard !== 'undefined') where.showOnDashboard = String(showOnDashboard) === 'true';
    if (typeof showInTicker !== 'undefined') where.showInTicker = String(showInTicker) === 'true';
    if (branchId) where.audienceBranchId = branchId;

    const { count, rows } = await Communication.findAndCountAll({
      where,
      include: [{ model: CommunicationAttachment, as: 'attachments' }],
      order: [['createdAt', 'DESC']],
      offset: (Number(page) - 1) * Number(pageSize),
      limit: Number(pageSize),
    });

    res.json({ items: rows, total: count });
  } catch (e) {
    console.error('listCommunications error:', e);
    res.status(500).json({ error: 'Failed to list communications' });
  }
};

/** POST /api/settings/communications */
exports.createCommunication = async (req, res) => {
  try {
    const title = (req.body.title || '').trim();
    // accept both "text" and legacy "body"
    const text = (req.body.text ?? req.body.body ?? '').toString().trim();

    if (!title || !text) {
      return res.status(400).json({ error: 'title and text are required' });
    }

    const payload = {
      title,
      text,
      type: req.body.type || req.body.channel || 'inapp',
      priority: req.body.priority || 'normal',
      audienceRole: req.body.audienceRole || null,
      audienceBranchId: req.body.audienceBranchId || null,
      startAt: req.body.startAt || null,
      endAt: req.body.endAt || null,
      showOnDashboard: req.body.showOnDashboard !== false,
      showInTicker: req.body.showInTicker !== false,
      isActive: req.body.isActive !== false,
      createdBy: req.user?.id || null,
      updatedBy: req.user?.id || null,
    };

    const c = await Communication.create(payload);
    res.status(201).json(c);
  } catch (e) {
    console.error('createCommunication error:', e);
    res.status(400).json({ error: 'Failed to create communication' });
  }
};

/** GET /api/settings/communications/:id */
exports.getCommunication = async (req, res) => {
  try {
    const c = await Communication.findByPk(req.params.id, {
      include: [{ model: CommunicationAttachment, as: 'attachments' }],
    });
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (e) {
    console.error('getCommunication error:', e);
    res.status(500).json({ error: 'Failed to fetch communication' });
  }
};

/** PUT /api/settings/communications/:id */
exports.updateCommunication = async (req, res) => {
  try {
    const c = await Communication.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });

    // normalize incoming body/text
    const updates = { ...req.body, updatedBy: req.user?.id || null };
    if (updates.body && !updates.text) updates.text = updates.body;
    delete updates.body;

    await c.update(updates);
    res.json(c);
  } catch (e) {
    console.error('updateCommunication error:', e);
    res.status(400).json({ error: 'Failed to update communication' });
  }
};

/** DELETE /api/settings/communications/:id */
exports.deleteCommunication = async (req, res) => {
  try {
    const c = await Communication.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    await c.destroy();
    res.json({ ok: true });
  } catch (e) {
    console.error('deleteCommunication error:', e);
    res.status(500).json({ error: 'Failed to delete communication' });
  }
};

/** POST /api/settings/communications/:id/attachments */
exports.addAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const { fileName, mimeType, size, fileUrl } = req.body;
    if (!fileName || !mimeType || !size || !fileUrl) {
      return res.status(400).json({ error: 'fileName, mimeType, size, fileUrl are required' });
    }

    const comm = await Communication.findByPk(id);
    if (!comm) return res.status(404).json({ error: 'Communication not found' });

    const att = await CommunicationAttachment.create({ communicationId: id, fileName, mimeType, size, fileUrl });
    res.status(201).json(att);
  } catch (e) {
    console.error('addAttachment error:', e);
    res.status(400).json({ error: 'Failed to add attachment' });
  }
};

/** DELETE /api/settings/communications/:id/attachments/:attId */
exports.removeAttachment = async (req, res) => {
  try {
    const { id, attId } = req.params;
    const att = await CommunicationAttachment.findOne({ where: { id: attId, communicationId: id } });
    if (!att) return res.status(404).json({ error: 'Attachment not found' });

    await att.destroy();
    res.json({ ok: true });
  } catch (e) {
    console.error('removeAttachment error:', e);
    res.status(500).json({ error: 'Failed to remove attachment' });
  }
};
