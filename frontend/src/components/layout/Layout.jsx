import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ErrorBoundary } from '../common/ErrorBoundary';
import api from '../../api/client';

const ROUTE_TITLES = {
  '/dashboard': 'Dashboard — Order-to-Audit ERP',
  '/master/items': 'Items Master Catalogue — Order-to-Audit ERP',
  '/master/boms': 'Bill of Materials (BOM) — Order-to-Audit ERP',
  '/master/parties': 'Vendors & Parties — Order-to-Audit ERP',
  '/master/warehouses': 'Warehouses & Locations — Order-to-Audit ERP',
  '/master/users': 'User Management & RBAC — Order-to-Audit ERP',
  '/purchases': 'Purchases & Goods Receipts (GRN) — Order-to-Audit ERP',
  '/inventory': 'Real-Time Inventory & Valuation — Order-to-Audit ERP',
  '/production': 'Production & Batch Yield Tracking — Order-to-Audit ERP',
  '/sales/orders': 'Sales Orders — Order-to-Audit ERP',
  '/sales/fulfilment': 'Order Fulfilment & Production Planning — Order-to-Audit ERP',
  '/sales/invoices': 'Tax Invoices & GST Compliance — Order-to-Audit ERP',
  '/payments/customers': 'Customer Receipts — Order-to-Audit ERP',
  '/payments/suppliers': 'Supplier Payments — Order-to-Audit ERP',
  '/accounting': 'General Ledger & Financial Accounting — Order-to-Audit ERP',
  '/reports': 'Executive Reports & Statutory Audit — Order-to-Audit ERP',
  '/audit': 'Immutable Audit Trail Ledger — Order-to-Audit ERP',
};

export const Layout = () => {
  const location = useLocation();

  // Dynamically update the browser tab title as the user switches tabs
  useEffect(() => {
    const title = ROUTE_TITLES[location.pathname] || 'Order-to-Audit — Food Manufacturing ERP & Compliance';
    document.title = title;
  }, [location.pathname]);

  // Pre-warm operational data in the background once Layout mounts
  useEffect(() => {
    api.prefetchCommonData?.();
  }, []);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
};
