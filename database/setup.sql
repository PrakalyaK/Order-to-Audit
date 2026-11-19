-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: MASTER DATABASE SETUP SCRIPT
-- Executes all migrations and populates the NIT Trichy benchmark scenario
-- ============================================================================

\echo '>>> Applying Migration 001: Initial Schema...'
\i database/migrations/001_initial_schema.sql

\echo '>>> Applying Migration 002: Constraints and Performance Indexes...'
\i database/migrations/002_constraints_and_indexes.sql

\echo '>>> Applying Migration 003: Immutability Triggers and Audit Logs...'
\i database/migrations/003_triggers_and_immutability.sql

\echo '>>> Applying Migration 004: Analytical Views and Auditor Registers...'
\i database/migrations/004_views.sql

\echo '>>> Seeding Benchmark Scenario Data...'
\i database/seeds/benchmark_seed.sql

\echo '>>> Verifying Benchmark Results...'
\i database/seeds/verify_benchmark.sql

\echo '>>> Database setup and verification completed successfully!'
