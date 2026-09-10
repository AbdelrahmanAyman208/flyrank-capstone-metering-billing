-- Create invoices table to store monthly statements

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    billing_month DATE NOT NULL,
    total_amount_microdollars BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, finalized, paid
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one invoice per tenant per month
    UNIQUE (tenant_id, billing_month)
);

CREATE INDEX idx_invoices_tenant ON invoices(tenant_id);
