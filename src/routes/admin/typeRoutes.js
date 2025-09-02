'use strict';
const express = require('express');
const router = express.Router();

let models;
try { models = require('../../models'); } catch { models = require('../models'); }

function tenantFrom(req){ return req.headers['x-tenant-id'] || req.context?.tenantId || null; }

// Prefer a model if you have one; fall back to raw SQL.
const getSequelize = () => {
  try { return models?.sequelize || require('../../models').sequelize; } catch { return null; }
};

router.get('/:category', async (req, res, next) => {
  const category = String(req.params.category);
  try {
    if (models?.AdminType) {
      const rows = await models.AdminType.findAll({ where:{ category }, order:[['name','ASC']] });
      return res.json(rows);
    }
    const sequelize = getSequelize();
    if (!sequelize) throw Object.assign(new Error('DB not available'), { status:500 });
    const [rows] = await sequelize.query(
      'SELECT id, name, code, meta FROM admin_types WHERE category = :category ORDER BY name ASC',
      { replacements: { category } }
    );
    return res.json(rows);
  } catch (e) { next(e); }
});

router.post('/:category', async (req, res, next) => {
  const category = String(req.params.category);
  const { name, code = null, meta = null } = req.body || {};
  try {
    const tenantId = tenantFrom(req);
    if (models?.AdminType) {
      const row = await models.AdminType.create({ category, name, code, meta, tenantId });
      return res.status(201).json(row);
    }
    const sequelize = getSequelize();
    if (!sequelize) throw Object.assign(new Error('DB not available'), { status:500 });
    const [result] = await sequelize.query(
      'INSERT INTO admin_types (category, name, code, meta, "tenantId", "createdAt", "updatedAt") VALUES (:category,:name,:code,:meta,:tenantId, NOW(), NOW()) RETURNING id, name, code, meta',
      { replacements: { category, name, code, meta: meta ? JSON.stringify(meta) : null, tenantId } }
    );
    return res.status(201).json(result?.[0] || {});
  } catch (e) { next(e); }
});

router.delete('/:category/:id', async (req, res, next) => {
  const category = String(req.params.category);
  const id = Number(req.params.id);
  try {
    if (models?.AdminType) {
      await models.AdminType.destroy({ where:{ id, category } });
      return res.status(204).end();
    }
    const sequelize = getSequelize();
    if (!sequelize) throw Object.assign(new Error('DB not available'), { status:500 });
    await sequelize.query('DELETE FROM admin_types WHERE id = :id AND category = :category', { replacements:{ id, category } });
    return res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
