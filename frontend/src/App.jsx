import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, ROLES } from './context/AuthContext';
import { Layout } from './components/layout/Layout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { NotFound } from './components/layout/NotFound';

// Pages
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ItemsPage } from './pages/master/ItemsPage';
import { BomsPage } from './pages/master/BomsPage';
import { PartiesPage } from './pages/master/PartiesPage';
import { WarehousesPage } from './pages/master/WarehousesPage';
import { UsersPage } from './pages/master/UsersPage';
import { PurchasesPage } from './pages/purchases/PurchasesPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { ProductionPage } from './pages/production/ProductionPage';
import { SalesOrdersPage } from './pages/sales/SalesOrdersPage';
import { FulfilmentPage } from './pages/sales/FulfilmentPage';
import { InvoicesPage } from './pages/sales/InvoicesPage';
import { CustomerPaymentsPage } from './pages/payments/CustomerPaymentsPage';
import { SupplierPaymentsPage } from './pages/payments/SupplierPaymentsPage';
import { AccountingPage } from './pages/accounting/AccountingPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { AuditLogsPage } from './pages/audit/AuditLogsPage';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public login */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected layout routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            
            {/* Core Operations */}
            <Route path="dashboard" element={<DashboardPage />} />

            {/* Master Data */}
            <Route path="master/items" element={<ItemsPage />} />
            <Route
              path="master/boms"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR]}>
                  <BomsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="master/parties"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN, ROLES.AUDITOR]}>
                  <PartiesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="master/warehouses"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR]}>
                  <WarehousesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="master/users"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR]}>
                  <UsersPage />
                </ProtectedRoute>
              }
            />

            {/* Supply & Production */}
            <Route
              path="purchases"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR]}>
                  <PurchasesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="inventory"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR]}>
                  <InventoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="production"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR]}>
                  <ProductionPage />
                </ProtectedRoute>
              }
            />

            {/* Sales & Billing */}
            <Route
              path="sales/orders"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN, ROLES.AUDITOR]}>
                  <SalesOrdersPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="sales/fulfilment"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR]}>
                  <FulfilmentPage />
                </ProtectedRoute>
              }
            />
            <Route path="fulfilment" element={<Navigate to="/sales/fulfilment" replace />} />
            <Route
              path="sales/invoices"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR]}>
                  <InvoicesPage />
                </ProtectedRoute>
              }
            />

            {/* Payments & Receivables / Payables */}
            <Route
              path="payments/customers"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN, ROLES.AUDITOR]}>
                  <CustomerPaymentsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="payments/suppliers"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR]}>
                  <SupplierPaymentsPage />
                </ProtectedRoute>
              }
            />

            {/* Finance & Compliance */}
            <Route
              path="accounting"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR]}>
                  <AccountingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="reports"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.SALESMAN, ROLES.AUDITOR]}>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute allowedRoles={[ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR]}>
                  <AuditLogsPage />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* 404 Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
