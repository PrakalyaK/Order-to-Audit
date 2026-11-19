-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: MASTER DATABASE SETUP SCRIPT
-- Executes all migrations and populates the NIT Trichy benchmark scenario
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

\echo '>>> Seeding Benchmark Scenario Data via Atomic Posting Functions...'
\i database/seeds/benchmark_seed.sql

\echo '>>> Executing Verification Queries for All Benchmark Rules...'
\i database/seeds/verify_benchmark.sql

\echo '>>> Database scripts ready for execution.'
