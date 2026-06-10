-- Static preview schema reference for a future backend migration.
-- The current project stores this data in IndexedDB/localStorage through index.html.

CREATE TABLE number_series (
  id INTEGER PRIMARY KEY,
  document_type VARCHAR(30) NOT NULL UNIQUE,
  prefix VARCHAR(20) NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  padding INTEGER NOT NULL DEFAULT 6,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE currencies (
  id INTEGER PRIMARY KEY,
  currency_code VARCHAR(3) NOT NULL UNIQUE,
  currency_name VARCHAR(80) NOT NULL,
  currency_symbol VARCHAR(12) NOT NULL,
  exchange_rate DECIMAL(18, 6) NOT NULL DEFAULT 1,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  decimal_places INTEGER NOT NULL DEFAULT 2,
  display_format VARCHAR(40) NOT NULL DEFAULT 'symbol-before',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO currencies (id, currency_code, currency_name, currency_symbol, exchange_rate, is_default, active, decimal_places, display_format)
VALUES (1, 'EUR', 'Euro', '€', 1, TRUE, TRUE, 2, 'symbol-before');

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  product_name VARCHAR(160) NOT NULL,
  sku VARCHAR(80) NOT NULL UNIQUE,
  category VARCHAR(80) NOT NULL,
  description TEXT,
  selling_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  cost_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  uom VARCHAR(30) NOT NULL DEFAULT 'pack',
  weight_kg DECIMAL(10, 2) NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  product_image_url TEXT,
  ecommerce_image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE delivery_fee_rules (
  id INTEGER PRIMARY KEY,
  min_weight_kg DECIMAL(10, 2) NOT NULL DEFAULT 0,
  max_weight_kg DECIMAL(10, 2) NOT NULL,
  delivery_fee DECIMAL(12, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EUR',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  movement_type VARCHAR(40) NOT NULL,
  quantity DECIMAL(12, 2) NOT NULL DEFAULT 0,
  reference_type VARCHAR(40),
  reference_number VARCHAR(80),
  remarks TEXT,
  created_by VARCHAR(120),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE bank_details (
  id INTEGER PRIMARY KEY,
  bank_name VARCHAR(160) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  account_number VARCHAR(80) NOT NULL,
  qr_code_image TEXT,
  active_status BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE promotions (
  id INTEGER PRIMARY KEY,
  promotion_name VARCHAR(160) NOT NULL,
  promotion_type VARCHAR(40) NOT NULL,
  minimum_order_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  start_date DATE,
  end_date DATE,
  auto_apply BOOLEAN NOT NULL DEFAULT TRUE,
  can_combine BOOLEAN NOT NULL DEFAULT FALSE,
  max_usage_per_customer INTEGER NOT NULL DEFAULT 0,
  max_total_usage INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE promotion_rules (
  id INTEGER PRIMARY KEY,
  promotion_id INTEGER NOT NULL,
  discount_type VARCHAR(40),
  discount_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
  required_quantity INTEGER NOT NULL DEFAULT 1,
  free_quantity INTEGER NOT NULL DEFAULT 1,
  product_group VARCHAR(80),
  reward_type VARCHAR(40),
  reward_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
  FOREIGN KEY (promotion_id) REFERENCES promotions(id)
);

CREATE TABLE promotion_products (
  id INTEGER PRIMARY KEY,
  promotion_id INTEGER NOT NULL,
  product_id INTEGER,
  role VARCHAR(30) NOT NULL,
  FOREIGN KEY (promotion_id) REFERENCES promotions(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE promotion_usage (
  id INTEGER PRIMARY KEY,
  promotion_id INTEGER NOT NULL,
  order_number VARCHAR(80),
  customer_identifier VARCHAR(160),
  discount_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (promotion_id) REFERENCES promotions(id)
);

CREATE TABLE website_editor_settings (
  id INTEGER PRIMARY KEY,
  layout_type VARCHAR(20) NOT NULL DEFAULT '3',
  transition_effect VARCHAR(40) NOT NULL DEFAULT 'smooth-slide',
  transition_speed INTEGER NOT NULL DEFAULT 4500,
  show_arrows BOOLEAN NOT NULL DEFAULT TRUE,
  show_dots BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE homepage_banners (
  id INTEGER PRIMARY KEY,
  image_url TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 1,
  transition_effect VARCHAR(40),
  transition_speed INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE whats_new_ads (
  id INTEGER PRIMARY KEY,
  layout_type VARCHAR(20) NOT NULL DEFAULT '3',
  media_type VARCHAR(20) NOT NULL DEFAULT 'image',
  image_url TEXT,
  video_url TEXT,
  title VARCHAR(160) NOT NULL,
  description TEXT,
  button_text VARCHAR(80),
  button_link TEXT,
  display_order INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expense_categories (
  id INTEGER PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  expense_number VARCHAR(40) NOT NULL UNIQUE,
  expense_date DATE NOT NULL,
  category_id INTEGER,
  category_name VARCHAR(120) NOT NULL,
  vendor_id INTEGER,
  vendor_name VARCHAR(180),
  description TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  payment_method VARCHAR(80) NOT NULL,
  reference_number VARCHAR(120),
  remarks TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  created_by VARCHAR(120) NOT NULL,
  created_by_role VARCHAR(40),
  approved_by VARCHAR(120),
  approved_at TIMESTAMP,
  rejected_by VARCHAR(120),
  rejected_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expense_attachments (
  id INTEGER PRIMARY KEY,
  expense_id INTEGER NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(80) NOT NULL,
  file_size INTEGER,
  file_url TEXT,
  uploaded_by VARCHAR(120),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (expense_id) REFERENCES expenses(id)
);

INSERT INTO number_series (id, document_type, prefix, next_number, padding, active) VALUES
  (1, 'ORDER', 'ORDER', 1, 6, TRUE),
  (2, 'INVOICE', 'INV', 1, 6, TRUE),
  (3, 'DELIVERY', 'DEL', 1, 6, TRUE),
  (4, 'PAYMENT', 'PAY', 1, 6, TRUE),
  (5, 'SKU', 'FP', 1, 5, TRUE),
  (6, 'EXP', 'EXP', 1, 6, TRUE);

INSERT INTO expense_categories (id, name, active) VALUES
  (1, 'Utilities', TRUE),
  (2, 'Rent', TRUE),
  (3, 'Delivery Expense', TRUE),
  (4, 'Fuel', TRUE),
  (5, 'Salary', TRUE),
  (6, 'Office Supplies', TRUE),
  (7, 'Packaging', TRUE),
  (8, 'Inventory Purchase', TRUE),
  (9, 'Maintenance', TRUE),
  (10, 'Marketing', TRUE),
  (11, 'Transportation', TRUE),
  (12, 'Miscellaneous', TRUE);

INSERT INTO delivery_fee_rules (id, min_weight_kg, max_weight_kg, delivery_fee, currency, active) VALUES
  (1, 0.00, 2.00, 3.65, 'EUR', TRUE),
  (2, 2.01, 20.00, 5.55, 'EUR', TRUE),
  (3, 20.01, 30.00, 11.95, 'EUR', TRUE);

INSERT INTO bank_details (id, bank_name, account_name, account_number, qr_code_image, active_status) VALUES
  (1, 'Jiren''s Food Product Bank', 'Jiren''s Food Product', '000123456789', NULL, TRUE);
