'use strict';
const express = require('express');
const router = express.Router();

let models;
try { models = require('../../models'); } catch { models = require('../models'); }

function tenantFrom(req){ return req.headers['x-tenant-id'] || req.context?.tenantId || null; }
const getSequelize = () => {
  try { return models?.sequelize || require('../../models').sequelize; } catch { return null; }
};

router.get('/:category', async (req, res, next) => {
  const category = String(req.params.category);
  try {
    if (models?.AdminTemplate) {
      const rows = await models.AdminTemplate.findAll({ where:{ category }, order:[['name','ASC']] });
      return res.json(rows);
    }
    const sequelize = getSequelize();
    if (!sequelize) throw Object.assign(new Error('DB not available'), { status:500 });
    const [rows] = await sequelize.query(
      'SELECT id, name, subject, body, channel FROM admin_templates WHERE category = :category ORDER BY name ASC',
      { replacements: { category } }
    );
    return res.json(rows);
  } catch (e) { next(e); }
});

router.post('/:category', async (req, res, next) => {
  const category = String(req.params.category);
  const { name, subject = null, body = "", channel = "email" } = req.body || {};
  try {
    const tenantId = tenantFrom(req);
    if (models?.AdminTemplate) {
      const row = await models.AdminTemplate.create({ category, name, subject, body, channel, tenantId });
      return res.status(201).json(row);
    }
    const sequelize = getSequelize();
    if (!sequelize) throw Object.assign(new Error('DB not available'), { status:500 });
    const [result] = await sequelize.query(
      'INSERT INTO admin_templates (category, name, subject, body, channel, "tenantId", "createdAt", "updatedAt") VALUES (:category,:name,:subject,:body,:channel,:tenantId, NOW(), NOW()) RETURNING id, name, subject, body, channel',
      { replacements: { category, name, subject, body, channel, tenantId } }
    );
    return res.status(201).json(result?.[0] || {});
  } catch (e) { next(e); }
});

router.delete('/:category/:id', async (req, res, next) => {
  const category = String(req.params.category);
  const id = Number(req.params.id);
  try {
    if (models?.AdminTemplate) {
      await models.AdminTemplate.destroy({ where:{ id, category } });
      return res.status(204).end();
    }
    const sequelize = getSequelize();
    if (!sequelize) throw Object.assign(new Error('DB not available'), { status:500 });
    await sequelize.query('DELETE FROM admin_templates WHERE id = :id AND category = :category', { replacements:{ id, category } });
    return res.status(204).end();
  } catch (e) { next(e); }
});

module.exports = router;
