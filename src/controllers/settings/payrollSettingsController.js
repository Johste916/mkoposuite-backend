const db = require('../../models');
const Setting = db.Setting;

const KEY = 'payrollSettings';

/**
 * @desc    Get payroll settings
 * @route   GET /api/settings/payroll-settings
 * @access  Private
 */
exports.getPayrollSettings = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: KEY } });

    res.status(200).json(
      setting?.value || {
        basicSalaryStructure: [],
        deductions: [],
        taxConfig: {},
      }
    );
  } catch (error) {
    console.error('❌ Error fetching payroll settings:', error);
    res.status(500).json({ message: 'Failed to fetch payroll settings' });
  }
};

/**
 * @desc    Update payroll settings
 * @route   PUT /api/settings/payroll-settings
 * @access  Private
 */
exports.updatePayrollSettings = async (req, res) => {
  try {
    const {
      basicSalaryStructure = [],
      deductions = [],
      taxConfig = {},
    } = req.body;

    const [updated] = await Setting.upsert({
      key: KEY,
      value: {
        basicSalaryStructure,
        deductions,
        taxConfig,
      }
    });

    res.status(200).json({
      message: 'Payroll settings updated successfully',
      data: updated.value,
    });
  } catch (error) {
    console.error('❌ Error updating payroll settings:', error);
    res.status(500).json({ message: 'Failed to update payroll settings' });
  }
};
