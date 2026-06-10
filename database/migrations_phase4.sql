-- Phase 4 Migration: Reports, Expenses, Master Data
-- Run once. All tables use IF NOT EXISTS / ON CONFLICT DO NOTHING.

-- ─────────────────────────────────────────────
-- EXPENSES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) UNIQUE NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendors (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(200) NOT NULL,
    contact_person VARCHAR(200),
    phone          VARCHAR(50),
    email          VARCHAR(200),
    address        TEXT,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
    id               SERIAL PRIMARY KEY,
    expense_number   VARCHAR(30) UNIQUE NOT NULL,
    expense_date     DATE NOT NULL,
    category         VARCHAR(100) NOT NULL DEFAULT 'Miscellaneous',
    vendor           VARCHAR(200),
    description      TEXT,
    amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_method   VARCHAR(50) NOT NULL DEFAULT 'Cash',
    reference_number VARCHAR(100),
    attachment_name  VARCHAR(255),
    attachment_type  VARCHAR(50),
    attachment_data  TEXT,
    remarks          TEXT,
    status           VARCHAR(20) NOT NULL DEFAULT 'Pending',
    approved_by      VARCHAR(100),
    approved_at      TIMESTAMPTZ,
    rejected_by      VARCHAR(100),
    rejected_at      TIMESTAMPTZ,
    created_by       VARCHAR(100),
    created_by_role  VARCHAR(20),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- MASTER DATA
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) UNIQUE NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS uom (
    id         SERIAL PRIMARY KEY,
    code       VARCHAR(20) UNIQUE NOT NULL,
    name       VARCHAR(100) NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- SETTINGS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_settings (
    id         INTEGER PRIMARY KEY DEFAULT 1,
    name       VARCHAR(50) NOT NULL DEFAULT 'VAT',
    rate       NUMERIC(5,2) NOT NULL DEFAULT 15,
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS currency_settings (
    id             SERIAL PRIMARY KEY,
    code           VARCHAR(10) UNIQUE NOT NULL,
    name           VARCHAR(100) NOT NULL,
    symbol         VARCHAR(10) NOT NULL,
    exchange_rate  NUMERIC(12,6) NOT NULL DEFAULT 1,
    is_default     BOOLEAN NOT NULL DEFAULT FALSE,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    decimal_places INTEGER NOT NULL DEFAULT 2,
    display_format VARCHAR(30) NOT NULL DEFAULT 'symbol-before',
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_fee_rules (
    id         SERIAL PRIMARY KEY,
    min_weight NUMERIC(8,3) NOT NULL DEFAULT 0,
    max_weight NUMERIC(8,3) NOT NULL,
    fee        NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency   VARCHAR(10) NOT NULL DEFAULT 'EUR',
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_details (
    id             INTEGER PRIMARY KEY DEFAULT 1,
    bank_name      VARCHAR(200),
    account_name   VARCHAR(200),
    account_number VARCHAR(100),
    qr_code_image  TEXT,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_by     VARCHAR(100)
);

-- ─────────────────────────────────────────────
-- PROMOTIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
    id                     SERIAL PRIMARY KEY,
    name                   VARCHAR(200) NOT NULL,
    type                   VARCHAR(50) NOT NULL DEFAULT 'spend',
    min_amount             NUMERIC(10,2) DEFAULT 0,
    discount_type          VARCHAR(50) DEFAULT 'free_delivery',
    discount_value         NUMERIC(10,2) DEFAULT 0,
    required_product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
    required_quantity      INTEGER DEFAULT 1,
    free_product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
    free_quantity          INTEGER DEFAULT 1,
    category               VARCHAR(100),
    reward_type            VARCHAR(50) DEFAULT 'selected_free',
    reward_value           NUMERIC(10,2) DEFAULT 0,
    start_date             DATE,
    end_date               DATE,
    auto_apply             BOOLEAN NOT NULL DEFAULT TRUE,
    combine                BOOLEAN NOT NULL DEFAULT FALSE,
    max_usage_per_customer INTEGER DEFAULT 0,
    max_total_usage        INTEGER DEFAULT 0,
    usage_count            INTEGER NOT NULL DEFAULT 0,
    active                 BOOLEAN NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ DEFAULT NOW(),
    updated_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- NUMBER SERIES — add EXP if not present
-- ─────────────────────────────────────────────
INSERT INTO number_series (document_type, prefix, next_number, padding, is_active)
VALUES ('EXP', 'EXP', 1, 6, TRUE)
ON CONFLICT (document_type) DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: tax_settings (single row)
-- ─────────────────────────────────────────────
INSERT INTO tax_settings (id, name, rate, active)
VALUES (1, 'VAT', 15, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: bank_details (single row)
-- ─────────────────────────────────────────────
INSERT INTO bank_details (id, bank_name, account_name, account_number, qr_code_image, active)
VALUES (1, 'Jiren''s Food Product Bank', 'Jiren''s Food Product', '000123456789', '', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: currency_settings
-- ─────────────────────────────────────────────
INSERT INTO currency_settings (code, name, symbol, exchange_rate, is_default, active, decimal_places, display_format)
VALUES
  ('EUR', 'Euro',           '€', 1.000000,    TRUE,  TRUE, 2, 'symbol-before'),
  ('GBP', 'British Pound',  '£', 0.860000,    FALSE, TRUE, 2, 'symbol-before'),
  ('USD', 'US Dollar',      '$', 1.080000,    FALSE, TRUE, 2, 'symbol-before')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: delivery_fee_rules
-- ─────────────────────────────────────────────
INSERT INTO delivery_fee_rules (min_weight, max_weight, fee, currency, active)
VALUES
  (0,     2,    3.65,  'EUR', TRUE),
  (2.01,  20,   5.55,  'EUR', TRUE),
  (20.01, 30,   11.95, 'EUR', TRUE)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: categories
-- ─────────────────────────────────────────────
INSERT INTO categories (name, active)
VALUES
  ('Frozen Products', TRUE),
  ('Condiments', TRUE)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: uom
-- ─────────────────────────────────────────────
INSERT INTO uom (code, name, active)
VALUES
  ('pack', 'Pack', TRUE),
  ('jar',  'Jar',  TRUE)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: expense_categories
-- ─────────────────────────────────────────────
INSERT INTO expense_categories (name, active)
VALUES
  ('Utilities', TRUE),
  ('Rent', TRUE),
  ('Delivery Expense', TRUE),
  ('Fuel', TRUE),
  ('Salary', TRUE),
  ('Office Supplies', TRUE),
  ('Packaging', TRUE),
  ('Inventory Purchase', TRUE),
  ('Maintenance', TRUE),
  ('Marketing', TRUE),
  ('Transportation', TRUE),
  ('Miscellaneous', TRUE)
ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: vendors
-- ─────────────────────────────────────────────
INSERT INTO vendors (name, contact_person, phone, email, address, active)
VALUES
  ('Frozen Goods Supplier', 'Supplier Desk', '+44 0000 000001', 'supplier@example.com', 'UK supply warehouse', TRUE)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────
-- SEED: promotions (default free delivery promo)
-- ─────────────────────────────────────────────
INSERT INTO promotions (name, type, min_amount, discount_type, discount_value, auto_apply, combine, active)
VALUES ('Spend 100 EUR and get free delivery', 'free_delivery', 100, 'free_delivery', 0, TRUE, FALSE, TRUE)
ON CONFLICT DO NOTHING;
