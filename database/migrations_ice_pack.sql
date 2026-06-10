-- Ice Pack migration
-- Add ice pack columns to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS total_frozen_packs     integer         DEFAULT 0,
  ADD COLUMN IF NOT EXISTS packs_per_ice_pack     integer         DEFAULT 2,
  ADD COLUMN IF NOT EXISTS required_ice_pack_qty  integer         DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ice_pack_weight_per_piece numeric(10,3) DEFAULT 0.000,
  ADD COLUMN IF NOT EXISTS ice_pack_total_weight  numeric(10,3)   DEFAULT 0.000,
  ADD COLUMN IF NOT EXISTS product_weight_total   numeric(10,3)   DEFAULT 0.000,
  ADD COLUMN IF NOT EXISTS total_delivery_weight  numeric(10,3)   DEFAULT 0.000;

-- Seed default ice pack settings
INSERT INTO app_settings (key, value) VALUES ('ice_pack_enabled',       'true')                                   ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('ice_pack_weight_kg',     '0.5')                                    ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('ice_pack_packs_per_piece','2')                                     ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('ice_pack_min_qty',       '1')                                      ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value) VALUES ('ice_pack_description',   'Cold protection packaging for frozen items') ON CONFLICT (key) DO NOTHING;
