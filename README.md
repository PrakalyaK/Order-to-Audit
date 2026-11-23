# Order-to-Audit ERP — Enterprise Food Manufacturing System

> **Statutory Food-Manufacturing Enterprise Resource Planning (ERP)**  
> Built with Node.js, Express.js, PostgreSQL 19, React 19, Vite, Tailwind CSS, and Recharts.

---

## 1. System Overview

**Order-to-Audit** is an integrated manufacturing ERP engineered specifically for the regulatory, batch-oriented, and financial demands of commercial food production. The system provides strict statutory compliance with Indian GST regulations, an immutable append-only inventory ledger, Moving Weighted Average Cost (WAC) valuation, First-Expired First-Out (FEFO) batch tracking, and double-entry general ledger accounting.

### Key Architectural Characteristics
- **Modular Monolith**: Strict separation across Routes → Controllers → Services → Repositories → PostgreSQL.
- **Database-Enforced Immutability**: Statutory audit triggers prevent alteration or deletion of audit logs, ledger entries, and posted financial records.
- **Moving Weighted Average Cost (WAC)**: Automatically computed at the database level during purchase receipts, manufacturing runs, and stock adjustments.
- **End-to-End Batch Traceability**: Bi-directional tracking from supplier raw material batches to finished goods output and customer tax invoices.
- **Role-Based Access Control (RBAC)**: 5 distinct personas with enforced API middleware and dynamic frontend interface filtering.

---

## 2. Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, Vite, Tailwind CSS, Recharts, Lucide Icons, Axios, React Router 7 |
| **Backend** | Node.js (v22), Express.js (v4), Zod Validation, Helmet, Morgan, CORS |
| **Database** | PostgreSQL 19, Native PL/pgSQL Stored Functions, Immutable Triggers |
| **Security** | HS256 JWT Authentication, In-Memory Sliding Window Rate Limiting, Bcrypt |
| **Testing** | Node.js Native Test Runner (`node:test`, `node:assert/strict`), 214 Integration Tests |
| **Deployment** | Multi-Stage Dockerfile, Docker Compose, Nginx-ready SPA Static Serving |

---

## 3. Statutory RBAC Permissions Matrix

The ERP implements 5 statutory roles:

| Module / Operation | Managing Director (`owner`) | Factory Admin (`factory_admin`) | Floor Supervisor (`production_supervisor`) | Salesman (`salesman`) | Statutory Auditor (`auditor`) |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Dashboard KPIs** | Full | Full | Operations | Sales Only | Read-Only |
| **Master Data (Items/BOM/Parties)** | Read/Write | Read/Write | Read-Only | Read-Only | Read-Only |
| **Warehouses & Depots** | Full | Full | Read/Stock | No Access | Read-Only |
| **Purchase Bills & Inbound** | Full | Full | No Access | No Access | Read-Only |
| **Inventory & FEFO Batches** | Full | Full | Transfers/Adjust | No Access | Read-Only |
| **Production Scheduling & Costing**| Full | Full | Execute/Complete | No Access | Read-Only |
| **Sales Orders** | Full | Full | No Access | Create/View | Read-Only |
| **GST Tax Invoices & Dispatches** | Full | Full | No Access | No Access | Read-Only |
| **Customer Receipts (AR)** | Full | Full | No Access | Record/View | Read-Only |
| **Supplier Payments (AP)** | Full | Full | No Access | No Access | Read-Only |
| **Financial Accounting (GL/TB/P&L)**| Full | Full | No Access | No Access | Read-Only |
| **Statutory Reports & Traceability**| Full | Full | Variance/Trace | No Access | Full Read |
| **Tamper-Proof Audit Trail** | Full | Full | No Access | No Access | Full Read |

---

## 4. Module Inventory & Feature Breakdown

### 1. Executive & Operations Dashboard
- High-level KPIs: Invoiced Sales, Purchases Billed, Stock Valuation, Active Runs, Customer Receivables, Supplier Payables.
- Real-time statutory alerts: Low-Stock threshold warnings, Near-Expiry batch alerts (<30 days).
- Interactive visual charts powered by Recharts (Revenue vs Spend comparison, Category valuation).

### 2. Master Data Management
- **Items & Products**: Raw Materials, Packaging, and Finished Goods with HSN classifications (e.g. 1905), GST rates (0%, 5%, 12%, 18%), Moving WAC, and reorder levels.
- **Bill of Materials (BOM)**: Versioned manufacturing recipes with component quantities, unit ratios, and scrap allowances.
- **Parties**: Customers and Suppliers with GSTIN (15-digit validation), State Codes, Credit Limits, and Contact Information.
- **Warehouses**: Multi-depot physical locations with live inventory balances and stock transfers.
- **User Directory**: Operator accounts with assigned roles and active statuses.

### 3. Purchases & Inbound Supply
- Sequential purchase bills recording with line items, batch assignments, and expiry dates.
- Automatic calculation of CGST, SGST, and IGST based on supplier state code vs company state code (33 - Tamil Nadu).
- Stock receipt workflow updating the immutable ledger and computing new Moving Weighted Average Costs.

### 4. Inventory, FEFO & Warehousing
- Real-time stock valuation using Moving Weighted Average Cost.
- First-Expired First-Out (FEFO) batch inspector highlighting expiring batches.
- Multi-step inter-warehouse stock transfers (`request` → `approve` → `dispatch` → `receive`).
- Stock adjustment ledger posting for periodic cycle counts and damage write-offs.

### 5. Production & Manufacturing Costing
- Production scheduling from versioned BOMs.
- Automatic consumption of raw material batches and deduction from inventory ledger.
- Completion posting with actual good output, scrap, by-products, and unit absorption costing.
- Yield and consumption variance analysis against standard BOM specifications.

### 6. Sales, Billing & Dispatch
- Sales order entry with automated credit limit validation.
- Order approval workflow and conversion to statutory GST Tax Invoices.
- Dispatch execution with FEFO batch allocation and immediate finished goods stock relief.

### 7. Payments & Cash Flow (AR & AP)
- Customer payment recording (cash, cheque, bank transfer, UPI) with invoice allocation.
- Supplier disbursement management and purchase bill settlement.
- Unallocated advance tracking and atomic payment reversals.

### 8. Financial Accounting & General Ledger
- Complete Chart of Accounts across Assets, Liabilities, Equity, Revenue, and Expense heads.
- Manual Journal Entry creator enforcing balanced double-entry debits and credits.
- Automated Trial Balance, General Ledger register, and Profit & Loss statement views.

### 9. Statutory Compliance & Audit Logs
- **GSTR Outward Supplies Register**: Detailed tax ledger for GSTR-1 preparation.
- **Receivables & Payables Ageing**: 0–30, 31–60, 61–90, >90 day statutory intervals.
- **Batch Traceability**: Full tree view connecting supplier shipments, raw material batches, production runs, and customer delivery invoices.
- **Tamper-Proof Audit Trail**: Cryptographic database audit log with side-by-side JSON diff inspection.

---

## 5. Local Setup & Quick Start

### Prerequisites
- Node.js v20+ or v22+
- PostgreSQL 16+ or 19
- npm v10+

### 1. Database Setup
Ensure PostgreSQL is running and create the database:
```sql
CREATE DATABASE order_to_audit;
```

Run database migrations sequentially from `database/migrations/`:
```bash
# Migrations 000 through 011
psql -U postgres -d order_to_audit -f database/migrations/000_upgrade_existing_schema.sql
# ... apply remaining migrations in numerical order
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your PostgreSQL credentials
npm install
npm run dev
```
Backend runs at `http://localhost:5000`.

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Frontend development server runs at `http://localhost:3000` (proxies `/api` to `http://localhost:5000`).

---

## 6. Running Tests

Execute the complete backend integration test suite:
```bash
npm test --prefix backend
```
**Verification Baseline:**
- **214 tests passing** across 11 test suites.
- 0 failures, 0 regressions.
- Benchmark database integrity fully preserved.

---

## 7. Production Deployment via Docker

Run the entire Order-to-Audit ERP and PostgreSQL database using Docker Compose:
```bash
docker-compose up --build -d
```
Access the application in your browser at `http://localhost:5000`.

---

## 8. Benchmark Evaluation Personas

The frontend includes an **Instant Persona Switcher** on the login page and header to evaluate all 5 roles:
- `owner_main`: Managing Director (`owner`)
- `admin_factory`: Factory Admin Desk (`factory_admin`)
- `supervisor_floor`: Floor Supervisor (`production_supervisor`)
- `salesman_a`: Sales Representative (`salesman`)
- `auditor_ext`: Statutory Auditor (`auditor`)
