const express = require('express');
const router = express.Router();
const { validate } = require('../middleware/validateInput');
const tenantRepo = require('../repositories/tenantRepo');
const alertRepo = require('../repositories/alertRepo');
const { NotFoundError } = require('../utils/errors');

const alertsValidation = validate({
  tenantId: { type: 'string', required: true },
}, 'query');

router.get('/', alertsValidation, async (req, res, next) => {
  try {
    const { tenantId } = req.query;

    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant', tenantId);
    }

    const alerts = await alertRepo.getRecentAlerts(tenantId);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
