'use strict';

/**
 * Communications controller with resilient fallbacks.
 * Order of storage backends:
 *  1) Sequelize models + tables (Communication, CommunicationAttachment)
 *  2) Setting KV (key = 'general_communications')
 *  3) In-memory (process lifetime)
 */

const tryRequireModels = () => {
  try { return require('../../models'); } catch (_) {
    try { return require('../../../models'); } catch { return null; }
  }
};

const db = tryRequireModels();
const hasSequelize = !!(db && db.sequelize && db.Sequelize);

// Optional models if present
const Setting = db?.Setting || null;
const Communication = db?.Communication || null;
const CommunicationAttachment = db?.CommunicationAttachment || null;

// Ops
const Op = hasSequelize ? db.Sequelize.Op : null;
const likeOp = hasSequelize
  ? (db.sequelize.getDialect() === 'postgres' ? db.Sequelize.Op.iLike : db.Sequelize.Op.like)
  : null;

// ---- helpers: detect "missing table" type errors across dialects ----
function isMissingTableError(err) {
  if (!err) return false;
  // Postgres
  if (err?.name === 'SequelizeDatabaseError' && err?.original?.code === '42P01') return true;
  // MySQL
  if (err?.name === 'SequelizeDatabaseError' && /ER_NO_SUCH_TABLE/.test(String(err?.original?.code || ''))) return true;
  // SQLite
  if (err?.name === 'SequelizeDatabaseError' && /no such table/i.test(String(err?.original?.message || err.message || ''))) return true;
  // Generic
  if (/relation .* does not exist/i.test(String(err?.message || ''))) return true;
  return false;
}

// ---- KV fallback (via Setting) ----
const KV_KEY = 'general_communications';

const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

async function kvLoad() {
  if (!Setting?.get) return [];
  const data = await Setting.get(KV_KEY, []);
  return Array.isArray(data) ? data : [];
}
async function kvSave(items, userId) {
  if (!Setting?.set) return;
  await Setting.set(KV_KEY, items, { updatedBy: userId || null, createdBy: userId || null });
}

// ---- ultimate fallback: in-memory ----
let memItems = [];
async function memLoad() { return memItems; }
async function memSave(items) { memItems = items; }

// choose KV if available; otherwise memory
async function storeLoad() {
  const items = await kvLoad();
  if (Array.isArray(items) && items._usingMemory !== true) return items;
  return memLoad();
}
async function storeSave(items, userId) {
  if (Setting?.set) return kvSave(items, userId);
  return memSave(items);
}

// ---- normalize incoming payload ----
function normalizePayload(body, user) {
  const title = String(body?.title || '').trim();
  const text  = String(body?.text  || body?.body || '').trim();
  return {
    title,
    text,
    type: body?.type || 'notice',
    priority: body?.priority || 'normal',
    audienceRole: body?.audienceRole || null,
    audienceBranchId: body?.audienceBranchId || null,
    startAt: body?.startAt || null,
    endAt: body?.endAt || null,
    showOnDashboard: body?.showOnDashboard !== false,
    showInTicker: body?.showInTicker !== false,
    isActive: body?.isActive !== false,
    createdBy: user?.id || null,
    updatedBy: user?.id || null,
  };
}

// ---- filtering helper for KV/memory arrays ----
function filterArray(items, query) {
  const {
    q = '', type, priority, isActive, showOnDashboard, showInTicker, branchId,
  } = query || {};
  let out = Array.from(items || []);

  const ql = String(q || '').toLowerCase();
  if (ql) {
    out = out.filter(x =>
      String(x.title || '').toLowerCase().includes(ql) ||
      String(x.text  || '').toLowerCase().includes(ql)
    );
  }
  if (type) out = out.filter(x => x.type === type);
  if (priority) out = out.filter(x => x.priority === priority);
  if (typeof isActive !== 'undefined') out = out.filter(x => !!x.isActive === (String(isActive) === 'true'));
  if (typeof showOnDashboard !== 'undefined') out = out.filter(x => !!x.showOnDashboard === (String(showOnDashboard) === 'true'));
  if (typeof showInTicker !== 'undefined') out = out.filter(x => !!x.showInTicker === (String(showInTicker) === 'true'));
  if (branchId) out = out.filter(x => String(x.audienceBranchId || '') === String(branchId));

  return out;
}

/* =====================================================================================
 * LIST  (GET /api/settings/communications)
 *  - Returns an ARRAY for FE simplicity (your page expects an array)
 * ===================================================================================== */
exports.listCommunications = async (req, res) => {
  // DB path (try -> catch fallback)
  if (Communication?.findAndCountAll) {
    try {
      const {
        q = '', page = 1, pageSize = 20, type, priority,
        isActive, showOnDashboard, showInTicker, branchId,
      } = req.query;

      const where = {};
      if (q && hasSequelize) {
        where[Op.or] = [{ title: { [likeOp]: `%${q}%` } }, { text: { [likeOp]: `%${q}%` } }];
      }
      if (type) where.type = type;
      if (priority) where.priority = priority;
      if (typeof isActive !== 'undefined') where.isActive = String(isActive) === 'true';
      if (typeof showOnDashboard !== 'undefined') where.showOnDashboard = String(showOnDashboard) === 'true';
      if (typeof showInTicker !== 'undefined') where.showInTicker = String(showInTicker) === 'true';
      if (branchId) where.audienceBranchId = branchId;

      const { rows } = await Communication.findAndCountAll({
        where,
        include: CommunicationAttachment ? [{ model: CommunicationAttachment, as: 'attachments' }] : [],
        order: [['createdAt', 'DESC']],
        offset: (Number(page) - 1) * Number(pageSize),
        limit: Number(pageSize),
      });
      return res.json(Array.isArray(rows) ? rows : []);
    } catch (e) {
      if (!isMissingTableError(e)) {
        console.error('listCommunications error:', e);
        // fall through to KV anyway so UI keeps working
      }
      // continue to fallback
    }
  }

  // Fallback: KV or Memory
  try {
    const items = await storeLoad();
    const filtered = filterArray(items, req.query);
    return res.json(filtered);
  } catch (e) {
    console.error('listCommunications fallback error:', e);
    return res.status(500).json({ error: 'Failed to list communications' });
  }
};

/* =====================================================================================
 * CREATE (POST /api/settings/communications)
 * ===================================================================================== */
exports.createCommunication = async (req, res) => {
  const payload = normalizePayload(req.body, req.user);
  if (!payload.title || !payload.text) {
    return res.status(400).json({ error: 'title and text are required' });
  }

  if (Communication?.create) {
    try {
      const row = await Communication.create(payload);
      return res.status(201).json(row);
    } catch (e) {
      if (!isMissingTableError(e)) {
        console.error('createCommunication error:', e);
        // fall through
      }
    }
  }

  try {
    const items = await storeLoad();
    const row = {
      id: genId(),
      ...payload,
      attachments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    items.unshift(row);
    await storeSave(items, req.user?.id);
    return res.status(201).json(row);
  } catch (e) {
    console.error('createCommunication fallback error:', e);
    return res.status(400).json({ error: 'Failed to create communication' });
  }
};

/* =====================================================================================
 * GET ONE (GET /api/settings/communications/:id)
 * ===================================================================================== */
exports.getCommunication = async (req, res) => {
  const id = String(req.params.id);

  if (Communication?.findByPk) {
    try {
      const row = await Communication.findByPk(id, {
        include: CommunicationAttachment ? [{ model: CommunicationAttachment, as: 'attachments' }] : [],
      });
      if (!row) return res.status(404).json({ error: 'Not found' });
      return res.json(row);
    } catch (e) {
      if (!isMissingTableError(e)) {
        console.error('getCommunication error:', e);
      }
    }
  }

  try {
    const items = await storeLoad();
    const row = items.find(x => String(x.id) === id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    return res.json(row);
  } catch (e) {
    console.error('getCommunication fallback error:', e);
    return res.status(500).json({ error: 'Failed to fetch communication' });
  }
};

/* =====================================================================================
 * UPDATE (PUT /api/settings/communications/:id)
 * ===================================================================================== */
exports.updateCommunication = async (req, res) => {
  const id = String(req.params.id);

  if (Communication?.findByPk) {
    try {
      const row = await Communication.findByPk(id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      const updates = { ...req.body, updatedBy: req.user?.id || null };
      await row.update(updates);
      return res.json(row);
    } catch (e) {
      if (!isMissingTableError(e)) {
        console.error('updateCommunication error:', e);
      }
    }
  }

  try {
    const items = await storeLoad();
    const idx = items.findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const next = { ...items[idx], ...req.body, updatedAt: new Date().toISOString() };
    items[idx] = next;
    await storeSave(items, req.user?.id);
    return res.json(next);
  } catch (e) {
    console.error('updateCommunication fallback error:', e);
    return res.status(400).json({ error: 'Failed to update communication' });
  }
};

/* =====================================================================================
 * DELETE (DELETE /api/settings/communications/:id)
 * ===================================================================================== */
exports.deleteCommunication = async (req, res) => {
  const id = String(req.params.id);

  if (Communication?.destroy) {
    try {
      const n = await Communication.destroy({ where: { id } });
      if (!n) return res.status(404).json({ error: 'Not found' });
      return res.json({ ok: true });
    } catch (e) {
      if (!isMissingTableError(e)) {
        console.error('deleteCommunication error:', e);
      }
    }
  }

  try {
    const items = await storeLoad();
    const next = items.filter(x => String(x.id) !== id);
    if (next.length === items.length) return res.status(404).json({ error: 'Not found' });
    await storeSave(next, req.user?.id);
    return res.json({ ok: true });
  } catch (e) {
    console.error('deleteCommunication fallback error:', e);
    return res.status(500).json({ error: 'Failed to delete communication' });
  }
};

/* =====================================================================================
 * ADD ATTACHMENT (POST /api/settings/communications/:id/attachments)
 *  body: { fileName, mimeType, size, fileUrl }
 * ===================================================================================== */
exports.addAttachment = async (req, res) => {
  const id = String(req.params.id);
  const { fileName, mimeType, size, fileUrl } = req.body || {};
  if (!fileName || !mimeType || !size || !fileUrl) {
    return res.status(400).json({ error: 'fileName, mimeType, size, fileUrl are required' });
  }

  if (CommunicationAttachment?.create) {
    try {
      if (Communication?.findByPk) {
        const exists = await Communication.findByPk(id);
        if (!exists) return res.status(404).json({ error: 'Communication not found' });
      }
      const att = await CommunicationAttachment.create({
        communicationId: id, fileName, mimeType, size, fileUrl,
      });
      return res.status(201).json(att);
    } catch (e) {
      if (!isMissingTableError(e)) {
        console.error('addAttachment error:', e);
      }
    }
  }

  try {
    const items = await storeLoad();
    const idx = items.findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Communication not found' });

    const att = {
      id: genId(),
      fileName, mimeType, size, fileUrl,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user?.id || null,
    };

    const row = items[idx];
    row.attachments = Array.isArray(row.attachments) ? row.attachments : [];
    row.attachments.push(att);
    row.updatedAt = new Date().toISOString();

    await storeSave(items, req.user?.id);
    return res.status(201).json(att);
  } catch (e) {
    console.error('addAttachment fallback error:', e);
    return res.status(400).json({ error: 'Failed to add attachment' });
  }
};

/* =====================================================================================
 * REMOVE ATTACHMENT (DELETE /api/settings/communications/:id/attachments/:attId)
 * ===================================================================================== */
exports.removeAttachment = async (req, res) => {
  const id = String(req.params.id);
  const attId = String(req.params.attId);

  if (CommunicationAttachment?.destroy) {
    try {
      const n = await CommunicationAttachment.destroy({ where: { id: attId, communicationId: id } });
      if (!n) return res.status(404).json({ error: 'Attachment not found' });
      return res.json({ ok: true });
    } catch (e) {
      if (!isMissingTableError(e)) {
        console.error('removeAttachment error:', e);
      }
    }
  }

  try {
    const items = await storeLoad();
    const idx = items.findIndex(x => String(x.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Communication not found' });

    const row = items[idx];
    const before = Array.isArray(row.attachments) ? row.attachments.length : 0;
    row.attachments = (row.attachments || []).filter(a => String(a.id) !== attId);
    const after = row.attachments.length;
    if (before === after) return res.status(404).json({ error: 'Attachment not found' });

    row.updatedAt = new Date().toISOString();
    await storeSave(items, req.user?.id);
    return res.json({ ok: true });
  } catch (e) {
    console.error('removeAttachment fallback error:', e);
    return res.status(500).json({ error: 'Failed to remove attachment' });
  }
};
