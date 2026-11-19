-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DEVELOPMENT RESET SCRIPT (DEV ONLY)
-- WARNING: This script drops all database objects and clears all business data.
-- DO NOT RUN IN PRODUCTION. Use for local development and clean test runs only.
-- ============================================================================

-- Drop views in reverse dependency order
DROP VIEW IF EXISTS v_gst_outward_summary CASCADE;
DROP VIEW IF EXISTS v_production_variance CASCADE;
DROP VIEW IF EXISTS v_customer_outstanding CASCADE;
DROP VIEW IF EXISTS v_invoice_balances CASCADE;
DROP VIEW IF EXISTS v_stock_ledger CASCADE;
DROP VIEW IF EXISTS v_current_stock CASCADE;

-- Drop transactional engine functions
DROP FUNCTION IF EXISTS fn_allocate_payment(UUID, UUID, NUMERIC, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_post_sales_dispatch(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_post_production_yield(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_post_production_issue(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_post_purchase_receipt(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS fn_compute_base_quantity(UUID, NUMERIC, VARCHAR) CASCADE;

-- Drop immutability & audit triggers and functions
DROP FUNCTION IF EXISTS fn_prevent_audit_log_modification() CASCADE;
DROP FUNCTION IF EXISTS fn_log_entity_audit_trail() CASCADE;
DROP FUNCTION IF EXISTS fn_prevent_received_purchase_deletion() CASCADE;
DROP FUNCTION IF EXISTS fn_prevent_completed_production_deletion() CASCADE;
DROP FUNCTION IF EXISTS fn_prevent_posted_invoice_deletion() CASCADE;
DROP FUNCTION IF EXISTS fn_prevent_inventory_ledger_tampering() CASCADE;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS inventory_ledger CASCADE;
DROP TABLE IF EXISTS item_stock_balances CASCADE;
DROP TABLE IF EXISTS stock_adjustments CASCADE;
DROP TABLE IF EXISTS credit_notes CASCADE;
DROP TABLE IF EXISTS payment_allocations CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS dispatch_items CASCADE;
DROP TABLE IF EXISTS dispatches CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS sales_order_items CASCADE;
DROP TABLE IF EXISTS sales_orders CASCADE;
DROP TABLE IF EXISTS production_run_costing CASCADE;
DROP TABLE IF EXISTS production_run_overheads CASCADE;
DROP TABLE IF EXISTS production_run_inputs CASCADE;
DROP TABLE IF EXISTS production_runs CASCADE;
DROP TABLE IF EXISTS bom_items CASCADE;
DROP TABLE IF EXISTS boms CASCADE;
DROP TABLE IF EXISTS purchase_bill_items CASCADE;
DROP TABLE IF EXISTS purchase_bills CASCADE;
DROP TABLE IF EXISTS parties CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS units_of_measure CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS users CASCADE;
