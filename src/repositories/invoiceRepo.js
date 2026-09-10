const pool = require('../config/db');

const invoiceRepo = {
  async createInvoice(tenantId, month, totalAmount, lineItems) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const invoiceRes = await client.query(
        `INSERT INTO invoices (tenant_id, billing_month, total_amount_microdollars, status)
         VALUES ($1, $2, $3, 'finalized')
         RETURNING *`,
        [tenantId, month, totalAmount]
      );
      const invoice = invoiceRes.rows[0];

      for (const item of lineItems) {
        await client.query(
          `INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price_microdollars, amount_microdollars)
           VALUES ($1, $2, $3, $4, $5)`,
          [invoice.id, item.description, item.quantity, item.unitPrice, item.amount]
        );
      }

      await client.query('COMMIT');
      return invoice;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getInvoicesByTenant(tenantId) {
    const res = await pool.query(
      `SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY billing_month DESC`,
      [tenantId]
    );
    return res.rows;
  },

  async getInvoicesWithLineItems(tenantId) {
    const invoices = await pool.query(
      `SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY billing_month DESC`,
      [tenantId]
    );
    
    if (invoices.rows.length === 0) return [];
    
    const invoiceIds = invoices.rows.map(inv => inv.id);
    const lineItems = await pool.query(
      `SELECT * FROM invoice_line_items WHERE invoice_id = ANY($1) ORDER BY created_at ASC`,
      [invoiceIds]
    );

    // Group line items by invoice
    for (const inv of invoices.rows) {
      inv.lineItems = lineItems.rows.filter(item => item.invoice_id === inv.id);
    }

    return invoices.rows;
  },

  async getInvoiceById(invoiceId, tenantId) {
    const invoiceRes = await pool.query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [invoiceId, tenantId]
    );

    if (invoiceRes.rows.length === 0) return null;
    const invoice = invoiceRes.rows[0];

    const lineItemsRes = await pool.query(
      `SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY created_at ASC`,
      [invoiceId]
    );
    invoice.lineItems = lineItemsRes.rows;

    return invoice;
  }
};

module.exports = invoiceRepo;
