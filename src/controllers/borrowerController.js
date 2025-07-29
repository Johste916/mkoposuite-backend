const { Borrower } = require('../models');

exports.getAllBorrowers = async (req, res) => {
  try {
    const borrowers = await Borrower.findAll();
    res.json(borrowers);
  } catch (error) {
    console.error("Error fetching borrowers:", error);
    res.status(500).json({ error: 'Failed to fetch borrowers' });
  }
};

exports.createBorrower = async (req, res) => {
  try {
    const { name, nationalId, phone, email, address } = req.body;
    const newBorrower = await Borrower.create({ name, nationalId, phone, email, address });
    res.status(201).json(newBorrower);
  } catch (error) {
    console.error("Error creating borrower:", error);
    res.status(500).json({ error: 'Failed to create borrower' });
  }
};

exports.updateBorrower = async (req, res) => {
  try {
    const { id } = req.params;
    const borrower = await Borrower.findByPk(id);
    if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

    await borrower.update(req.body);
    res.json(borrower);
  } catch (error) {
    console.error("Error updating borrower:", error);
    res.status(500).json({ error: 'Failed to update borrower' });
  }
};

exports.deleteBorrower = async (req, res) => {
  try {
    const { id } = req.params;
    const borrower = await Borrower.findByPk(id);
    if (!borrower) return res.status(404).json({ error: 'Borrower not found' });

    await borrower.destroy();
    res.json({ message: 'Borrower deleted successfully' });
  } catch (error) {
    console.error("Error deleting borrower:", error);
    res.status(500).json({ error: 'Failed to delete borrower' });
  }
};
