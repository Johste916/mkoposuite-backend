'use strict';

/**
 * LEGACY + EXTENDED SETTINGS CONTROLLER
 * -------------------------------------
 * This file keeps the legacy endpoints you already use:
 *  - Loan Category CRUD
 *  - Loan Settings (singleton)
 *  - System Settings (singleton)
 *
 * It also exposes optional generic helpers backed by the new Setting model:
 *  - getSetting / setSetting / mergeSetting (tenant-aware via x-tenant-id)
 *
 * If other, newer modular controllers exist under controllers/settings/*,
 * keep this file only for the endpoints that still import it.
 */

const { LoanCategory, LoanSetting, SystemSetting, Setting } = require('../models');

/* -----------------------------
 * Helpers
 * --------------------------- */
const send500 = (res, msg, err) => {
  console.error(msg, err);
  return res.status(500).json({ error: msg });
};

const pick = (obj = {}, fields = []) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => fields.includes(k)));

/* -----------------------------
 * Loan Category CRUD
 * --------------------------- */
exports.createLoanCategory = async (req, res) => {
  try {
    if (!LoanCategory) return res.status(501).json({ error: 'LoanCategory model not available' });
    const category = await LoanCategory.create(req.body);
    return res.status(201).json(category);
  } catch (err) {
    return send500(res, 'Failed to create loan category', err);
  }
};

exports.getLoanCategories = async (_req, res) => {
  try {
    if (!LoanCategory) return res.json([]);
    const categories = await LoanCategory.findAll();
    return res.json(categories);
  } catch (err) {
    return send500(res, 'Failed to fetch loan categories', err);
  }
};

exports.updateLoanCategory = async (req, res) => {
  try {
    if (!LoanCategory) return res.status(501).json({ error: 'LoanCategory model not available' });
    const category = await LoanCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: 'Not found' });

    await category.update(req.body);
    return res.json(category);
  } catch (err) {
    return send500(res, 'Failed to update loan category', err);
  }
};

exports.deleteLoanCategory = async (req, res) => {
  try {
    if (!LoanCategory) return res.status(501).json({ error: 'LoanCategory model not available' });
    const category = await LoanCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: 'Not found' });

    await category.destroy();
    return res.json({ message: 'Deleted successfully' });
  } catch (err) {
    return send500(res, 'Failed to delete loan category', err);
  }
};

/* -----------------------------
 * Loan Settings (singleton id=1)
 * --------------------------- */
exports.getLoanSettings = async (_req, res) => {
  try {
    if (!LoanSetting) return res.json({});
    const settings = await LoanSetting.findByPk(1);
    return res.json(settings || {});
  } catch (err) {
    return send500(res, 'Failed to fetch loan settings', err);
  }
};

exports.updateLoanSettings = async (req, res) => {
  try {
    if (!LoanSetting) return res.status(501).json({ error: 'LoanSetting model not available' });

    // Only accept known fields to avoid accidental schema drift
    const allowed = [
      'defaultInterestRate',
      'defaultLoanTerm',
      'maxLoanAmount',
      'penaltyRate',
      'gracePeriodDays',
      'processingFee',
      'requireCollateral'
    ];
    const payload = pick(req.body || {}, allowed);

    let settings = await LoanSetting.findByPk(1);
    if (settings) {
      await settings.update(payload);
      return res.json(settings);
    }
    settings = await LoanSetting.create({ id: 1, ...payload });
    return res.status(201).json(settings);
  } catch (err) {
    return send500(res, 'Failed to update loan settings', err);
  }
};

/* -----------------------------
 * System Settings (singleton id=1)
 * --------------------------- */
exports.getSystemSettings = async (_req, res) => {
  try {
    if (!SystemSetting) return res.json({});
    const settings = await SystemSetting.findByPk(1);
    return res.json(settings || {});
  } catch (err) {
    return send500(res, 'Failed to fetch system settings', err);
  }
};

exports.updateSystemSettings = async (req, res) => {
  try {
    if (!SystemSetting) return res.status(501).json({ error: 'SystemSetting model not available' });
    const payload = req.body || {};

    let settings = await SystemSetting.findByPk(1);
    if (settings) {
      await settings.update(payload);
      return res.json(settings);
    }
    const created = await SystemSetting.create({ id: 1, ...payload });
    return res.status(201).json(created);
  } catch (err) {
    return send500(res, 'Failed to update system settings', err);
  }
};

/* -----------------------------------------------------------
 * OPTIONAL: Generic settings endpoints (backed by Setting model)
 * Not wired by default; you can map routes later if useful.
 * These are tenant-aware via the x-tenant-id header.
 * --------------------------------------------------------- */

/**
 * GET /settings/:key
 * Returns { key, value }
 */
exports.getSetting = async (req, res) => {
  try {
    if (!Setting) return res.status(501).json({ error: 'Setting model not available' });
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key is required' });

    const tenantId = req.headers['x-tenant-id'] || null;
    const value = await Setting.get(key, {}, { tenantId });
    return res.json({ key, value });
  } catch (err) {
    return send500(res, 'Failed to load setting', err);
  }
};

/**
 * PUT /settings/:key
 * Body: { value: any, description?: string }
 * Replaces value.
 */
exports.setSetting = async (req, res) => {
  try {
    if (!Setting) return res.status(501).json({ error: 'Setting model not available' });
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key is required' });

    const { value, description } = req.body || {};
    const tenantId = req.headers['x-tenant-id'] || null;
    const userId = req.user?.id || null;

    const saved = await Setting.set(key, value ?? {}, { updatedBy: userId, createdBy: userId, tenantId });

    // Optionally update description if provided (does not change behavior if missing)
    if (typeof description === 'string') {
      const row = await Setting.findOne({ where: { key: tenantId ? `${tenantId}:${key}` : key } });
      if (row) await row.update({ description });
    }

    return res.json({ key, value: saved });
  } catch (err) {
    return send500(res, 'Failed to save setting', err);
  }
};

/**
 * PATCH /settings/:key
 * Body: { patch: object, description?: string }
 * Shallow-merges into existing JSON.
 */
exports.mergeSetting = async (req, res) => {
  try {
    if (!Setting) return res.status(501).json({ error: 'Setting model not available' });
    const key = String(req.params.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key is required' });

    const { patch, description } = req.body || {};
    if (patch && typeof patch !== 'object') {
      return res.status(400).json({ error: 'patch must be an object' });
    }

    const tenantId = req.headers['x-tenant-id'] || null;
    const userId = req.user?.id || null;

    const value = await Setting.merge(key, patch || {}, { updatedBy: userId, tenantId });

    if (typeof description === 'string') {
      const row = await Setting.findOne({ where: { key: tenantId ? `${tenantId}:${key}` : key } });
      if (row) await row.update({ description });
    }

    return res.json({ key, value });
  } catch (err) {
    return send500(res, 'Failed to merge setting', err);
  }
};
