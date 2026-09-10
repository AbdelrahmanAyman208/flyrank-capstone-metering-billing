const express = require('express');
const router = express.Router();
const { validate } = require('../middleware/validateInput');
const tenantRepo = require('../repositories/tenantRepo');
const invoiceRepo = require('../repositories/invoiceRepo');
const costService = require('../services/costService');
const { NotFoundError } = require('../utils/errors');

const invoicesValidation = validate({
  tenantId: { type: 'string', required: true },
}, 'query');

router.get('/', invoicesValidation, async (req, res, next) => {
  try {
    const { tenantId } = req.query;

    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant', tenantId);
    }

    const invoices = await invoiceRepo.getInvoicesWithLineItems(tenantId);
    
    // Format amounts to dollar strings for convenience
    const formattedInvoices = invoices.map(inv => ({
      id: inv.id,
      tenantId: inv.tenant_id,
      billingMonth: inv.billing_month,
      totalAmountMicrodollars: inv.total_amount_microdollars,
      totalAmountDollars: costService.microdollarsToDollars(inv.total_amount_microdollars),
      status: inv.status,
      createdAt: inv.created_at,
      lineItems: inv.lineItems.map(item => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPriceMicrodollars: item.unit_price_microdollars,
        unitPriceDollars: costService.microdollarsToDollars(item.unit_price_microdollars),
        amountMicrodollars: item.amount_microdollars,
        amountDollars: costService.microdollarsToDollars(item.amount_microdollars),
      }))
    }));

    res.json({ invoices: formattedInvoices });
  } catch (err) {
    next(err);
  }
});

// Endpoint to manually trigger the monthly rollup (for testing/demo)
// Also generates invoices for the CURRENT month so freshly created events show up
router.post('/trigger-rollup', async (req, res, next) => {
  try {
    const { runMonthlyRollup } = require('../services/backgroundJobs');
    await runMonthlyRollup();

    // Also run for the current month so test events show up immediately
    const invoiceService = require('../services/invoiceService');
    const allTenants = await tenantRepo.findAll();
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString().slice(0, 10);

    for (const tenant of allTenants) {
      try {
        await invoiceService.generateMonthlyInvoice(tenant.id, currentMonth);
      } catch (e) {
        // Ignore duplicates or empty months
        console.log(`[TriggerRollup] Skipping current-month invoice for ${tenant.id}: ${e.message}`);
      }
    }

    res.json({ success: true, message: 'Monthly rollup and invoices generated successfully' });
  } catch (err) {
    next(err);
  }
});

// Endpoint to download PDF invoice
router.get('/:id/pdf', invoicesValidation, async (req, res, next) => {
  try {
    const invoiceId = req.params.id;
    const { tenantId } = req.query;

    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Tenant', tenantId);
    }

    const invoice = await invoiceRepo.getInvoiceById(invoiceId, tenantId);
    if (!invoice) {
      throw new NotFoundError('Invoice', invoiceId);
    }

    const pdfService = require('../services/pdfService');
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
    
    pdfService.generateInvoicePDF(invoice, tenant, res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
