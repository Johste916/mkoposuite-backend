// src/controllers/borrowerController.js
const { Borrower } = require('../models');

// Map DB row -> API shape (adds fullName alias)
const toApi = (b) => {
  if (!b) return b;
  const json = b.toJSON ? b.toJSON() : b;
  return {
    ...json,
    // ensure frontends expecting fullName still work
    fullName: json.fullName ?? json.name ?? '',
  };
};

exports.getAllBorrowers = async (_req, res) => {
  try {
    // No explicit attributes → avoids column name mismatches
    const rows = await Borrower.findAll({ order: [['createdAt', 'DESC']], limit: 500 });
    res.json((rows || []).map(toApi));
  } catch (error) {
    console.error('getAllBorrowers error:', error);
    res.status(500).json({ error: 'Failed to fetch borrowers' });
  }
};

exports.createBorrower = async (req, res) => {
  try {
    const { name, fullName, nationalId, phone, email, address, branchId } = req.body;

    // Prefer name; fall back to provided fullName
    const payload = {
      name: name || fullName || '', // DB column is "name"
      nationalId: nationalId || null,
      phone: phone || null,
      email: email || null,
      address: address || null,
      branchId: branchId || null,
    };

    const created = await Borrower.create(payload);
    res.status(201).json(toApi(created));
  } catch (error) {
    console.error('createBorrower error:', error);
    res.status(500).json({ error: 'Failed to create borrower' });
  }
};

exports.updateBorrower = async (req, res) => {
  try {
    const { id } = req.params;
    const b = await Borrower.findByPk(id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

    const { name, fullName, nationalId, phone, email, address, branchId } = req.body;
    await b.update({
      name: name ?? fullName ?? b.name,
      nationalId: nationalId ?? b.nationalId,
      phone: phone ?? b.phone,
      email: email ?? b.email,
      address: address ?? b.address,
      branchId: branchId ?? b.branchId,
    });

    res.json(toApi(b));
  } catch (error) {
    console.error('updateBorrower error:', error);
    res.status(500).json({ error: 'Failed to update borrower' });
  }
};

exports.deleteBorrower = async (req, res) => {
  try {
    const { id } = req.params;
    const b = await Borrower.findByPk(id);
    if (!b) return res.status(404).json({ error: 'Borrower not found' });

    await b.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('deleteBorrower error:', error);
    res.status(500).json({ error: 'Failed to delete borrower' });
  }
};
