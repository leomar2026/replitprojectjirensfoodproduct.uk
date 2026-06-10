-- Reference cleanup service for production backend implementation.
-- Run only inside an explicit database transaction after admin authorization,
-- backup export, typed CONFIRM validation, and ALLOW_PRODUCTION_RESET=true when
-- environment is production.

BEGIN TRANSACTION;

-- Dependency order: child/detail rows before parent transaction rows.
DELETE FROM order_items;
DELETE FROM delivery_transactions;
DELETE FROM payment_records;
DELETE FROM invoice_records;
DELETE FROM customer_transaction_history;
DELETE FROM notification_queue;
DELETE FROM temporary_logs;
DELETE FROM checkout_sessions;
DELETE FROM cart_items;
DELETE FROM carts;
DELETE FROM inventory_movements;
DELETE FROM orders;
DELETE FROM sales_transactions;

-- Optional, only when "Reset document numbering back to initial value" is checked.
-- UPDATE number_series SET next_number = 1 WHERE document_type IN ('ORDER', 'INVOICE', 'DELIVERY', 'PAYMENT');

-- Preserve master tables:
-- products, number_series, delivery_fee_rules, users, roles, system_settings,
-- categories, uom_master, tax_vat_setup.

COMMIT;
