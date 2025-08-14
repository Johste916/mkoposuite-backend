const db = require('../../models');
const LoanCategory = db.LoanCategory;

/**
 * @desc    Create a loan category
 * @route   POST /api/settings/loan-categories
 * @access  Private
 */
exports.createLoanCategory = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();

    if (!name) return res.status(400).json({ error: 'Loan category name is required' });

    // Optional: prevent duplicates by name (case-insensitive)
    const exists = await LoanCategory.findOne({
      where: db.sequelize.where(
        db.sequelize.fn('LOWER', db.sequelize.col('name')),
        name.toLowerCase()
      ),
    });
    if (exists) return res.status(409).json({ error: 'Loan category already exists' });

    const newCategory = await LoanCategory.create({ name, description });
    res.status(201).json(newCategory);
  } catch (error) {
    console.error('❌ Error creating loan category:', error);
    res.status(500).json({ error: 'Failed to create loan category' });
  }
};

/**
 * @desc    Get all loan categories (optional q/page/pageSize)
 * @route   GET /api/settings/loan-categories
 * @access  Private
 */
exports.getLoanCategories = async (req, res) => {
  try {
    const { q = '', page = 1, pageSize = 100 } = req.query;

    const where = {};
    if (q) {
      const { Op } = db.Sequelize;
      const likeOp = db.sequelize.getDialect() === 'postgres' ? Op.iLike : Op.like;
      where.name = { [likeOp]: `%${q}%` };
    }

    const { rows, count } = await LoanCategory.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      offset: (Number(page) - 1) * Number(pageSize),
      limit: Number(pageSize),
    });

    res.status(200).json({ items: rows, total: count });
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
    const name = req.body.name ? String(req.body.name).trim() : undefined;
    const description = req.body.description ? String(req.body.description).trim() : undefined;

    const category = await LoanCategory.findByPk(id);
    if (!category) return res.status(404).json({ error: 'Loan category not found' });

    if (name && name.toLowerCase() !== category.name.toLowerCase()) {
      const exists = await LoanCategory.findOne({
        where: db.sequelize.where(
          db.sequelize.fn('LOWER', db.sequelize.col('name')),
          name.toLowerCase()
        ),
      });
      if (exists) return res.status(409).json({ error: 'Loan category with this name already exists' });
      category.name = name;
    }
    if (typeof description !== 'undefined') category.description = description;

    await category.save();
    res.status(200).json({ message: 'Loan category updated successfully', category });
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
    if (!category) return res.status(404).json({ error: 'Loan category not found' });

    await category.destroy();
    res.status(200).json({ message: 'Loan category deleted successfully' });
  } catch (error) {
    console.error('❌ Error deleting loan category:', error);
    res.status(500).json({ error: 'Failed to delete loan category' });
  }
};
