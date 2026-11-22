\set ON_ERROR_STOP on
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: MASTER DATABASE SETUP SCRIPT
-- ============================================================================
-- EXECUTION INSTRUCTIONS:
--
-- Path A (Fresh Database Setup - Recommended):
--   1. Create an empty PostgreSQL database (e.g., `createdb order_to_audit`)
--   2. Run this script directly:
--      psql -U <username> -d order_to_audit -f database/setup.sql
--   (For local development reset: run database/scripts/dev_reset.sql first)
--
-- Path B (Upgrading Existing Database from previous schema drafts):
--   1. Run explicit upgrade migration first:
--      psql -U <username> -d order_to_audit -f database/migrations/000_upgrade_existing_schema.sql
--   2. Run migrations 002 through 005.
-- ============================================================================

\echo '>>> Applying Migration 001: Initial Non-Destructive Schema...'
\i database/migrations/001_initial_schema.sql

\echo '>>> Applying Migration 002: Constraints and Performance Indexes...'
\i database/migrations/002_constraints_and_indexes.sql

\echo '>>> Applying Migration 003: Tamper-Proof Audit Logging & Immutability...'
\i database/migrations/003_audit_and_immutability.sql

\echo '>>> Applying Migration 004: Transactional Inventory Engine & Moving WAC...'
\i database/migrations/004_inventory_posting_engine.sql

\echo '>>> Applying Migration 005: Analytical Views & Auditor Registers...'
\i database/migrations/005_views.sql

\echo '>>> Applying Migration 006: Production Hardening, Costing & Immutability...'
\i database/migrations/006_production_hardening_and_immutability.sql

\echo '>>> Applying Migration 007: Purchases Immutability & Inventory Hardening...'
\i database/migrations/007_purchases_and_inventory_hardening.sql

\echo '>>> Applying Migration 008: Sales, Dispatch & Invoicing Hardening & Audit Trail...'
\i database/migrations/008_sales_dispatch_invoicing_hardening.sql

\echo '>>> Applying Migration 009: Payments, Allocations & Receivables Hardening...'
\i database/migrations/009_payments_receivables_hardening.sql

\echo '>>> Applying Migration 010: Financial Accounting & Reporting...'
\i database/migrations/010_financial_accounting.sql

\echo '>>> Seeding Benchmark Scenario Data via Atomic Posting Functions...'
\i database/seeds/benchmark_seed.sql

\echo '>>> Executing Verification Queries for All Benchmark Rules...'
\i database/seeds/verify_benchmark.sql

\echo '>>> Master setup script execution finished.'
