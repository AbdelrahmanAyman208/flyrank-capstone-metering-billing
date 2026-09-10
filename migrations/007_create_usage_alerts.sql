-- Create usage_alerts table to track notifications sent to tenants

CREATE TABLE IF NOT EXISTS usage_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    month DATE NOT NULL,
    usage_type VARCHAR(50) NOT NULL,
    threshold_pct INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure we only send one alert per threshold per type per month
    UNIQUE (tenant_id, month, usage_type, threshold_pct)
);

CREATE INDEX idx_usage_alerts_tenant_month ON usage_alerts(tenant_id, month);
