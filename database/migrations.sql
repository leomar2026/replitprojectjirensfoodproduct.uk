-- Jiren's Food Product - Database Migrations
-- PostgreSQL (idempotent - safe to re-run)

-- ─────────────────────────────────────────────
-- PHASE 1: Users & sessions
-- ─────────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'manager', 'cashier');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(50)  UNIQUE NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,
    role        user_role    NOT NULL DEFAULT 'cashier',
    full_name   VARCHAR(100),
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'users_updated_at') THEN
        CREATE TRIGGER users_updated_at
            BEFORE UPDATE ON users
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_sessions (
    id          VARCHAR(255) PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    data        TEXT,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- PHASE 2: Products
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
    id                   SERIAL PRIMARY KEY,
    name                 VARCHAR(150)  NOT NULL,
    sku                  VARCHAR(80)   UNIQUE NOT NULL,
    category             VARCHAR(100)  NOT NULL DEFAULT 'Frozen Products',
    pack_display         VARCHAR(80)   NOT NULL DEFAULT '500g pack',
    uom                  VARCHAR(20)   NOT NULL DEFAULT 'pack',
    price                NUMERIC(10,2) NOT NULL DEFAULT 0,
    promo_price          NUMERIC(10,2),
    cost_price           NUMERIC(10,2) NOT NULL DEFAULT 0,
    description          TEXT,
    image_filename       VARCHAR(255),
    weight_kg            NUMERIC(8,3)  NOT NULL DEFAULT 0,
    stock_quantity       INTEGER       NOT NULL DEFAULT 0,
    reorder_level        INTEGER       NOT NULL DEFAULT 0,
    is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
    ecommerce_visible    BOOLEAN       NOT NULL DEFAULT TRUE,
    stock_display_status VARCHAR(30),
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'products_updated_at') THEN
        CREATE TRIGGER products_updated_at
            BEFORE UPDATE ON products
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

-- ─────────────────────────────────────────────
-- PHASE 2: Orders
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
    id                     SERIAL PRIMARY KEY,
    order_number           VARCHAR(30)   UNIQUE NOT NULL,
    customer_name          VARCHAR(150)  NOT NULL,
    customer_phone         VARCHAR(50)   NOT NULL,
    fulfillment_method     VARCHAR(20)   NOT NULL DEFAULT 'pickup',
    delivery_address       TEXT,
    delivery_city          VARCHAR(100),
    delivery_area          VARCHAR(100),
    payment_method         VARCHAR(30)   NOT NULL DEFAULT 'cash_on_delivery',
    payment_method_display VARCHAR(60)   NOT NULL DEFAULT 'Cash on Delivery',
    payment_reference      VARCHAR(150),
    subtotal               NUMERIC(10,2) NOT NULL DEFAULT 0,
    vat_rate               NUMERIC(5,2)  NOT NULL DEFAULT 15,
    vat_amount             NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_weight           NUMERIC(8,3)  NOT NULL DEFAULT 0,
    delivery_fee           NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
    order_status           VARCHAR(40)   NOT NULL DEFAULT 'Pending Confirmation',
    payment_status         VARCHAR(40)   NOT NULL DEFAULT 'Pending verification',
    payment_verified_by    VARCHAR(100),
    payment_verified_at    TIMESTAMPTZ,
    confirmed_by           VARCHAR(100),
    confirmed_at           TIMESTAMPTZ,
    cancel_reason          TEXT,
    notes                  TEXT,
    invoice_number         VARCHAR(30),
    delivery_number        VARCHAR(30),
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_updated_at') THEN
        CREATE TRIGGER orders_updated_at
            BEFORE UPDATE ON orders
            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS order_items (
    id           SERIAL PRIMARY KEY,
    order_id     INTEGER       NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id   INTEGER       REFERENCES products(id) ON DELETE SET NULL,
    product_name VARCHAR(150)  NOT NULL,
    product_sku  VARCHAR(80),
    quantity     INTEGER       NOT NULL DEFAULT 1,
    unit_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
    weight_kg    NUMERIC(8,3)  NOT NULL DEFAULT 0,
    line_weight  NUMERIC(8,3)  NOT NULL DEFAULT 0,
    line_total   NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_proofs (
    id            SERIAL PRIMARY KEY,
    order_id      INTEGER       NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    filename      VARCHAR(255)  NOT NULL,
    original_name VARCHAR(255)  NOT NULL,
    file_type     VARCHAR(100)  NOT NULL,
    file_size     INTEGER       NOT NULL,
    upload_path   VARCHAR(500)  NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- PHASE 3: Number Series, Inventory, POS, Audit
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS number_series (
    id            SERIAL PRIMARY KEY,
    document_type VARCHAR(30)  UNIQUE NOT NULL,
    prefix        VARCHAR(10)  NOT NULL,
    next_number   INTEGER      NOT NULL DEFAULT 1,
    padding       INTEGER      NOT NULL DEFAULT 6,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO number_series (document_type, prefix, next_number, padding) VALUES
    ('POS',     'POS', 1, 6),
    ('RECEIPT', 'REC', 1, 6),
    ('INVOICE', 'INV', 1, 6)
ON CONFLICT (document_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS inventory_movements (
    id               SERIAL PRIMARY KEY,
    product_id       INTEGER      REFERENCES products(id) ON DELETE SET NULL,
    product_name     VARCHAR(150) NOT NULL,
    product_sku      VARCHAR(80),
    movement_type    VARCHAR(40)  NOT NULL,
    quantity         INTEGER      NOT NULL,
    quantity_before  INTEGER      NOT NULL DEFAULT 0,
    quantity_after   INTEGER      NOT NULL DEFAULT 0,
    reference_type   VARCHAR(50),
    reference_number VARCHAR(50),
    notes            TEXT,
    warehouse        VARCHAR(100),
    created_by       VARCHAR(100),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_transactions (
    id                 SERIAL PRIMARY KEY,
    transaction_number VARCHAR(30)   UNIQUE NOT NULL,
    receipt_number     VARCHAR(30),
    invoice_number     VARCHAR(30),
    transaction_type   VARCHAR(30)   NOT NULL DEFAULT 'POS Sale',
    source_reference   VARCHAR(50),
    customer_name      VARCHAR(150)  NOT NULL DEFAULT 'Walk-in customer',
    payment_method     VARCHAR(30)   NOT NULL,
    payment_reference  VARCHAR(150),
    subtotal           NUMERIC(10,2) NOT NULL DEFAULT 0,
    vat_amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
    status             VARCHAR(30)   NOT NULL DEFAULT 'Completed',
    created_by         VARCHAR(100),
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_transaction_items (
    id             SERIAL PRIMARY KEY,
    transaction_id INTEGER       NOT NULL REFERENCES sales_transactions(id) ON DELETE CASCADE,
    product_id     INTEGER       REFERENCES products(id) ON DELETE SET NULL,
    product_name   VARCHAR(150)  NOT NULL,
    product_sku    VARCHAR(80),
    quantity       INTEGER       NOT NULL DEFAULT 1,
    unit_price     NUMERIC(10,2) NOT NULL DEFAULT 0,
    line_total     NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          SERIAL PRIMARY KEY,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   VARCHAR(100),
    user_name   VARCHAR(100),
    details     JSONB,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
