const db = require('../../models');
const LoanCategory = db.LoanCategory;

/**
 * @desc    Create a loan category
 * @route   POST /api/settings/loan-categories
 * @access  Private
 */
exports.createLoanCategory = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Loan category name is required' });
    }

    const newCategory = await LoanCategory.create({
      name: name.trim(),
      description: description?.trim() || ''
    });

    res.status(201).json(newCategory);
  } catch (error) {
    console.error('❌ Error creating loan category:', error);
    res.status(500).json({ error: 'Failed to create loan category' });
  }
};

/**
 * @desc    Get all loan categories
 * @route   GET /api/settings/loan-categories
 * @access  Private
 */
exports.getLoanCategories = async (req, res) => {
  try {
    const categories = await LoanCategory.findAll({
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json(categories);
  } catch (error) {
    console.error('❌ Error fetching loan categories:', error);
    res.status(500).json({ error: 'Failed to fetch loan categories' });
  }
};

/**
 * @desc    Update a loan category
 * @route   PUT /api/settings/loan-categories/:id
 * @access  Private
 */
exports.updateLoanCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const category = await LoanCategory.findByPk(id);
    if (!category) {
      return res.status(404).json({ error: 'Loan category not found' });
    }

    category.name = name?.trim() || category.name;
    category.description = description?.trim() || category.description;

    await category.save();

    res.status(200).json({
      message: 'Loan category updated successfully',
      category
    });
  } catch (error) {
    console.error('❌ Error updating loan category:', error);
    res.status(500).json({ error: 'Failed to update loan category' });
  }
};

/**
 * @desc    Delete a loan category
 * @route   DELETE /api/settings/loan-categories/:id
 * @access  Private
 */
exports.deleteLoanCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await LoanCategory.findByPk(id);
    if (!category) {
      return res.status(404).json({ error: 'Loan category not found' });
    }

    await category.destroy();

    res.status(200).json({ message: 'Loan category deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting loan category:', error);
    res.status(500).json({ error: 'Failed to delete loan category' });
  }
};
