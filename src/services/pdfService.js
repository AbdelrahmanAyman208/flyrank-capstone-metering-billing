const PDFDocument = require('pdfkit');
const costService = require('./costService');

const pdfService = {
  generateInvoicePDF(invoice, tenant, res) {
    const doc = new PDFDocument({ margin: 50 });
    
    // Pipe the document to the response stream
    doc.pipe(res);

    // Header
    doc
      .fillColor('#444444')
      .fontSize(20)
      .text('INVOICE', 50, 50, { align: 'right' })
      .fontSize(10)
      .text(`Invoice ID: ${invoice.id}`, { align: 'right' })
      .text(`Billing Month: ${new Date(invoice.billing_month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`, { align: 'right' })
      .text(`Status: ${invoice.status.toUpperCase()}`, { align: 'right' });
    
    // Company Info
    doc
      .fontSize(18)
      .text('FlyRank Metering & Billing', 50, 50)
      .fontSize(10)
      .text('123 API Way')
      .text('Cloud City, Web 00000')
      .moveDown();
    
    // Tenant Info
    doc
      .fontSize(12)
      .text('Billed To:', 50, 130)
      .fontSize(10)
      .text(`Tenant ID: ${tenant.id}`)
      .text(tenant.name || 'Valued Customer')
      .text(tenant.email || '')
      .moveDown();

    // Line Items Table Header
    const tableTop = 200;
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text('Description', 50, tableTop)
      .text('Quantity', 280, tableTop, { width: 90, align: 'right' })
      .text('Unit Price', 370, tableTop, { width: 90, align: 'right' })
      .text('Amount', 470, tableTop, { width: 90, align: 'right' });

    // Draw a line
    const hr = (y) => {
      doc.strokeColor('#aaaaaa').lineWidth(1).moveTo(50, y).lineTo(560, y).stroke();
    };

    hr(tableTop + 15);

    // Line Items
    doc.font('Helvetica');
    let y = tableTop + 25;
    
    for (const item of invoice.lineItems) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      const unitPriceStr = costService.microdollarsToDollars(item.unit_price_microdollars || 0);
      const amountStr = costService.microdollarsToDollars(item.amount_microdollars || 0);
      
      doc
        .text(item.description, 50, y, { width: 230 })
        .text(Number(item.quantity).toLocaleString(), 280, y, { width: 90, align: 'right' })
        .text(unitPriceStr, 370, y, { width: 90, align: 'right' })
        .text(amountStr, 470, y, { width: 90, align: 'right' });
      
      y += 20;
    }

    hr(y + 10);

    // Total
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .text('Total:', 370, y + 25, { width: 90, align: 'right' })
      .text(costService.microdollarsToDollars(invoice.total_amount_microdollars || 0), 470, y + 25, { width: 90, align: 'right' });

    // Finalize PDF file
    doc.end();
  }
};

module.exports = pdfService;
