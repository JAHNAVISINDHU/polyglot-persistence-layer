-- Initialize logistics database schema

CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_id VARCHAR(255) UNIQUE NOT NULL,
    package_id VARCHAR(255) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    customer_id VARCHAR(255) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    event_id VARCHAR(255),
    timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_package_id ON invoices(package_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);

-- Ensure invoice_id uniqueness (belt and suspenders)
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_id_unique;
ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_id_unique UNIQUE (invoice_id);
