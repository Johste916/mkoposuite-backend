// controllers/settingController.js
const { LoanCategory, LoanSetting, SystemSetting } = require('../models');

// -----------------------------
// Loan Category CRUD
// -----------------------------
exports.createLoanCategory = async (req, res) => {
  try {
    const category = await LoanCategory.create(req.body);
    res.status(201).json(category);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create loan category' });
  }
};

exports.getLoanCategories = async (req, res) => {
  try {
    const categories = await LoanCategory.findAll();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch loan categories' });
  }
};

exports.updateLoanCategory = async (req, res) => {
  try {
    const category = await LoanCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: 'Not found' });

    await category.update(req.body);
    res.json(category);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update loan category' });
  }
};

exports.deleteLoanCategory = async (req, res) => {
  try {
    const category = await LoanCategory.findByPk(req.params.id);
    if (!category) return res.status(404).json({ error: 'Not found' });

    await category.destroy();
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete loan category' });
  }
};

// -----------------------------
// Loan Settings
// -----------------------------
exports.getLoanSettings = async (req, res) => {
  try {
    const settings = await LoanSetting.findByPk(1);
    res.json(settings || {});
  } catch (err) {
    console.error('Failed to fetch loan settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

exports.updateLoanSettings = async (req, res) => {
  try {
    const {
      defaultInterestRate,
      defaultLoanTerm,
      maxLoanAmount,
      penaltyRate,
      gracePeriodDays,
      processingFee,
      requireCollateral
    } = req.body;

    let settings = await LoanSetting.findByPk(1);
    if (settings) {
      await settings.update({
        defaultInterestRate,
        defaultLoanTerm,
        maxLoanAmount,
        penaltyRate,
        gracePeriodDays,
        processingFee,
        requireCollateral
      });
      res.json(settings);
    } else {
      settings = await LoanSetting.create({
        id: 1,
        defaultInterestRate,
        defaultLoanTerm,
        maxLoanAmount,
        penaltyRate,
        gracePeriodDays,
        processingFee,
        requireCollateral
      });
      res.status(201).json(settings);
    }
  } catch (err) {
    console.error('Failed to update loan settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

// -----------------------------
// System Settings
// -----------------------------
exports.getSystemSettings = async (req, res) => {
  try {
    const settings = await SystemSetting.findByPk(1);
    res.json(settings || {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

exports.updateSystemSettings = async (req, res) => {
  try {
    const settings = await SystemSetting.findByPk(1);
    if (settings) {
      await settings.update(req.body);
      res.json(settings);
    } else {
      const newSettings = await SystemSetting.create({ id: 1, ...req.body });
      res.status(201).json(newSettings);
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
};
