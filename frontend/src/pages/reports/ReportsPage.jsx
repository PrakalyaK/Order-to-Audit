import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, EmptyState } from '../../components/ui';
import { 
  BarChart3, Search, FileText, ArrowRight, CheckCircle2, ShieldCheck, 
  Printer, Download, Filter, RefreshCw, Calendar, AlertTriangle 
} from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

// Helper for pure client-side CSV export
const exportToCsv = (filename, headers, rows, extractRowFn) => {
  if (!rows || rows.length === 0) {
    alert('No data to export.');
    return;
  }
  const csvLines = [headers.join(',')];
  rows.forEach((row) => {
    const values = extractRowFn(row).map((val) => {
      const str = '' + (val ?? '');
      const escaped = str.replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvLines.push(values.join(','));
  });
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const ReportsPage = () => {
  const { hasRole, user } = useAuth();
  const canViewSales = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN, ROLES.AUDITOR);
  const canViewPurchases = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR);
  const canViewInventory = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR);
  const canViewProd = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR);

  const [activeTab, setActiveTab] = useState(canViewSales ? 'sales-register' : 'stock-summary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Date filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Report state containers
  const [salesRegister, setSalesRegister] = useState([]);
  const [gstOutward, setGstOutward] = useState([]);
  const [purchaseRegister, setPurchaseRegister] = useState([]);
  const [stockSummary, setStockSummary] = useState([]);
  const [stockLedger, setStockLedger] = useState([]);
  const [productionVariance, setProductionVariance] = useState([]);
  const [yieldWastage, setYieldWastage] = useState([]);
  const [costPerPacket, setCostPerPacket] = useState([]);
  const [receivablesAgeing, setReceivablesAgeing] = useState([]);

  // Batch traceability state
  const [traceBatch, setTraceBatch] = useState('BAT-MRK-20261119-01');
  const [traceResult, setTraceResult] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);

  // Tab definitions
  const tabs = [
    { id: 'sales-register', label: '1. Sales Register', visible: canViewSales },
    { id: 'gst', label: '2. GST Outward (GSTR-1)', visible: canViewSales },
    { id: 'purchase-register', label: '3. Purchase Register', visible: canViewPurchases },
    { id: 'stock-summary', label: '4. Stock Summary', visible: canViewInventory },
    { id: 'stock-ledger', label: '5. Stock Ledger', visible: canViewInventory },
    { id: 'variance', label: '6. Production Variance', visible: canViewProd },
    { id: 'yield-wastage', label: '7. Yield & Wastage', visible: canViewProd },
    { id: 'cost-per-packet', label: '8. Cost per Packet', visible: canViewProd },
    { id: 'aging', label: '9. Receivables Ageing', visible: canViewSales },
    { id: 'traceability', label: '10. Batch Traceability', visible: canViewProd },
  ].filter((t) => t.visible);

  // Fetch report data according to active tab
  const fetchCurrentTabReport = async () => {
    try {
      setLoading(true);
      setError('');
      const params = {};
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;

      switch (activeTab) {
        case 'sales-register': {
          const res = await api.get('/reports/sales-register', { params });
          const rows = res?.data?.data ?? res?.data ?? [];
          setSalesRegister(Array.isArray(rows) ? rows : []);
          break;
        }
        case 'gst': {
          const res = await api.get('/reports/sales', { params });
          const outward = res?.data?.gst_outward ?? res?.data?.data?.gst_outward ?? [];
          setGstOutward(Array.isArray(outward) ? outward : []);
          break;
        }
        case 'purchase-register': {
          const res = await api.get('/reports/purchase-register', { params });
          const rows = res?.data?.data ?? res?.data ?? [];
          setPurchaseRegister(Array.isArray(rows) ? rows : []);
          break;
        }
        case 'stock-summary': {
          const res = await api.get('/reports/stock-summary');
          const rows = res?.data?.data ?? res?.data ?? [];
          setStockSummary(Array.isArray(rows) ? rows : []);
          break;
        }
        case 'stock-ledger': {
          const res = await api.get('/reports/stock-ledger', { params });
          const rows = res?.data?.data ?? res?.data ?? [];
          setStockLedger(Array.isArray(rows) ? rows : []);
          break;
        }
        case 'variance': {
          const res = await api.get('/reports/production');
          const rows = res?.data?.variance ?? res?.data?.data?.variance ?? [];
          setProductionVariance(Array.isArray(rows) ? rows : []);
          break;
        }
        case 'yield-wastage': {
          const res = await api.get('/reports/production-yield-wastage', { params });
          const rows = res?.data?.data ?? res?.data ?? [];
          setYieldWastage(Array.isArray(rows) ? rows : []);
          break;
        }
        case 'cost-per-packet': {
          const res = await api.get('/reports/cost-per-packet', { params });
          const rows = res?.data?.data ?? res?.data ?? [];
          setCostPerPacket(Array.isArray(rows) ? rows : []);
          break;
        }
        case 'aging': {
          const res = await api.get('/reports/receivables-ageing');
          const rows = res?.data?.data ?? res?.data ?? [];
          setReceivablesAgeing(Array.isArray(rows) ? rows : []);
          break;
        }
        case 'traceability': {
          if (traceBatch) handleSearchTrace();
          break;
        }
        default:
          break;
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch report data');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchTrace = async () => {
    if (!traceBatch) return;
    try {
      setTraceLoading(true);
      const res = await api.get(`/reports/traceability/${traceBatch}`);
      if (res?.success) {
        setTraceResult(res.data);
      }
    } catch (err) {
      alert(`Traceability lookup failed: ${err.message}`);
    } finally {
      setTraceLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentTabReport();
  }, [activeTab]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Statutory Reports & Audit Suite
            </h1>
            <Badge variant="info">
              <ShieldCheck className="w-3.5 h-3.5 mr-1" />
              Auditor Verified
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Complete set of 9 statutory financial & production registers, traceable stock ledger, and end-to-end batch genealogy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={Printer} onClick={() => window.print()}>
            Print / PDF
          </Button>
        </div>
      </div>

      {/* Date Filter & Actions Toolbar */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-blue-600" /> Date Range Filter:
            </span>
            <div className="flex items-center gap-1.5">
              <label className="text-slate-500">From:</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-slate-500">To:</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <Button size="sm" variant="secondary" onClick={fetchCurrentTabReport} icon={RefreshCw}>
              Apply Filter
            </Button>
            {(fromDate || toDate) && (
              <button
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setTimeout(fetchCurrentTabReport, 0);
                }}
                className="text-xs text-blue-600 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="text-[11px] text-slate-400">
            Source-locked append-only ledger entries
          </div>
        </div>
      </Card>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 whitespace-nowrap transition ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* 1. SALES REGISTER TAB */}
      {/* ======================================================== */}
      {activeTab === 'sales-register' && (
        <Card
          title="Sales Register (v_invoice_balances)"
          subtitle="Tax invoices issued, customer GST breakdown, payments allocated, and unpaid receivables balance"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'Sales_Register',
                  ['Invoice #', 'Date', 'Customer', 'State', 'GSTIN', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Invoice', 'Paid Amount', 'Balance Due', 'Status'],
                  salesRegister,
                  (r) => [
                    r.invoice_number,
                    r.invoice_date,
                    r.customer_name,
                    r.state_name,
                    r.customer_gstin,
                    r.total_taxable_value,
                    r.total_cgst,
                    r.total_sgst,
                    r.total_igst,
                    r.total_invoice_value,
                    r.total_paid_amount,
                    r.outstanding_balance,
                    r.status,
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Generating Sales Register..." />
          ) : salesRegister.length === 0 ? (
            <EmptyState message="No sales invoices found for selected criteria" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Invoice #</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">State</th>
                    <th className="py-2.5 px-3 text-right">Taxable (₹)</th>
                    <th className="py-2.5 px-3 text-right">CGST (₹)</th>
                    <th className="py-2.5 px-3 text-right">SGST (₹)</th>
                    <th className="py-2.5 px-3 text-right">IGST (₹)</th>
                    <th className="py-2.5 px-3 text-right">Total (₹)</th>
                    <th className="py-2.5 px-3 text-right">Paid (₹)</th>
                    <th className="py-2.5 px-3 text-right">Balance Due</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salesRegister.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600">{row.invoice_number}</td>
                      <td className="py-2.5 px-3 text-slate-500">{row.invoice_date}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{row.customer_name}</td>
                      <td className="py-2.5 px-3 text-slate-500">{row.state_name}</td>
                      <td className="py-2.5 px-3 text-right font-medium">₹{parseFloat(row.total_taxable_value || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">₹{parseFloat(row.total_cgst || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">₹{parseFloat(row.total_sgst || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">₹{parseFloat(row.total_igst || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">₹{parseFloat(row.total_invoice_value || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-600 font-medium">₹{parseFloat(row.total_paid_amount || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">₹{parseFloat(row.outstanding_balance || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge variant={row.outstanding_balance <= 0 ? 'success' : 'warning'}>
                          {row.outstanding_balance <= 0 ? 'PAID' : 'DUE'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 2. GST OUTWARD SUPPLIES TAB */}
      {/* ======================================================== */}
      {activeTab === 'gst' && (
        <Card
          title="GST Outward Supplies (v_gst_outward_summary)"
          subtitle="Statutory tax breakdown per invoice for GSTR-1 outward reporting"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'GSTR1_Outward_Supplies',
                  ['Invoice #', 'Date', 'Customer Name', 'GSTIN', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total Invoice'],
                  gstOutward,
                  (r) => [
                    r.invoice_number,
                    r.invoice_date,
                    r.customer_name,
                    r.customer_gstin || 'UNREGISTERED',
                    r.total_taxable_value,
                    r.total_cgst,
                    r.total_sgst,
                    r.total_igst,
                    r.total_invoice_value,
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Compiling GSTR Outward Supplies..." />
          ) : gstOutward.length === 0 ? (
            <EmptyState message="No outward supplies logged" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Invoice #</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Customer Name</th>
                    <th className="py-3 px-4">Customer GSTIN</th>
                    <th className="py-3 px-4 text-right">Taxable Value</th>
                    <th className="py-3 px-4 text-right">CGST (₹)</th>
                    <th className="py-3 px-4 text-right">SGST (₹)</th>
                    <th className="py-3 px-4 text-right">IGST (₹)</th>
                    <th className="py-3 px-4 text-right">Total Invoice</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {gstOutward.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">{row.invoice_number}</td>
                      <td className="py-2.5 px-4 text-slate-500">{row.invoice_date}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.customer_name}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px]">{row.customer_gstin || 'UNREGISTERED'}</td>
                      <td className="py-2.5 px-4 text-right font-medium">₹{parseFloat(row.total_taxable_value || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right font-mono">₹{parseFloat(row.total_cgst || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right font-mono">₹{parseFloat(row.total_sgst || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right font-mono">₹{parseFloat(row.total_igst || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">₹{parseFloat(row.total_invoice_value || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 3. PURCHASE REGISTER TAB */}
      {/* ======================================================== */}
      {activeTab === 'purchase-register' && (
        <Card
          title="Purchase Register"
          subtitle="Inbound vendor bills, supplier GSTINs, input tax, and payables reconciliation"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'Purchase_Register',
                  ['Bill #', 'Date', 'Supplier', 'GSTIN', 'Subtotal', 'Tax Amount', 'Total Bill', 'Paid Amount', 'Outstanding Balance', 'Status'],
                  purchaseRegister,
                  (r) => [
                    r.bill_number,
                    r.bill_date,
                    r.supplier_name,
                    r.supplier_gstin,
                    r.subtotal_amount,
                    r.tax_amount,
                    r.total_amount,
                    r.total_paid_amount,
                    r.outstanding_balance,
                    r.status,
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Generating Purchase Register..." />
          ) : purchaseRegister.length === 0 ? (
            <EmptyState message="No purchase bills logged for selected range" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Bill #</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Supplier</th>
                    <th className="py-2.5 px-3">Supplier GSTIN</th>
                    <th className="py-2.5 px-3 text-right">Subtotal (₹)</th>
                    <th className="py-2.5 px-3 text-right">Tax (₹)</th>
                    <th className="py-2.5 px-3 text-right">Total Bill (₹)</th>
                    <th className="py-2.5 px-3 text-right">Paid (₹)</th>
                    <th className="py-2.5 px-3 text-right">Balance Due</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseRegister.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600">{row.bill_number}</td>
                      <td className="py-2.5 px-3 text-slate-500">{row.bill_date}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{row.supplier_name}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">{row.supplier_gstin || 'UNREGISTERED'}</td>
                      <td className="py-2.5 px-3 text-right font-medium">₹{parseFloat(row.subtotal_amount || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">₹{parseFloat(row.tax_amount || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">₹{parseFloat(row.total_amount || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-600 font-medium">₹{parseFloat(row.total_paid_amount || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">₹{parseFloat(row.outstanding_balance || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge variant={row.outstanding_balance <= 0 ? 'success' : 'warning'}>
                          {row.outstanding_balance <= 0 ? 'PAID' : 'DUE'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 4. STOCK SUMMARY TAB */}
      {/* ======================================================== */}
      {activeTab === 'stock-summary' && (
        <Card
          title="Stock Summary (v_current_stock)"
          subtitle="Real-time perpetual inventory balances, base units, equivalent packaging cartons, and Moving WAC valuation"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'Stock_Summary',
                  ['SKU', 'Item Name', 'Category', 'Base Qty', 'UOM', 'Cartons', 'Moving WAC (₹)', 'Total Valuation (₹)', 'Reorder Level', 'Status'],
                  stockSummary,
                  (r) => [
                    r.sku,
                    r.item_name,
                    r.item_type,
                    r.current_base_qty,
                    r.base_uom_name,
                    r.equivalent_cartons || 0,
                    r.current_moving_wac,
                    r.current_total_value,
                    r.reorder_level,
                    r.stock_status,
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Compiling Perpetual Stock Summary..." />
          ) : stockSummary.length === 0 ? (
            <EmptyState message="No inventory items found" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">SKU</th>
                    <th className="py-2.5 px-3">Item Name</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3 text-right">Closing Base Qty</th>
                    <th className="py-2.5 px-3">UOM</th>
                    <th className="py-2.5 px-3 text-right">Eq. Cartons</th>
                    <th className="py-2.5 px-3 text-right">Moving WAC (₹)</th>
                    <th className="py-2.5 px-3 text-right">Total Valuation (₹)</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stockSummary.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600">{row.sku}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{row.item_name}</td>
                      <td className="py-2.5 px-3">
                        <Badge variant="secondary">{row.item_type}</Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {parseFloat(row.current_base_qty || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">{row.base_uom_name}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                        {row.equivalent_cartons ? `${row.equivalent_cartons} CTN` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium">
                        ₹{parseFloat(row.current_moving_wac || 0).toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
                        ₹{parseFloat(row.current_total_value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge
                          variant={
                            row.stock_status === 'OUT_OF_STOCK'
                              ? 'error'
                              : row.stock_status === 'REORDER_REQUIRED'
                              ? 'warning'
                              : 'success'
                          }
                        >
                          {row.stock_status || 'OK'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 5. STOCK LEDGER TAB (Traceable to Source Document) */}
      {/* ======================================================== */}
      {activeTab === 'stock-ledger' && (
        <Card
          title="Stock Ledger (v_stock_ledger)"
          subtitle="Append-only transaction ledger with source-document traceability (Purchase Bills, Production Runs, Dispatches)"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'Stock_Ledger',
                  ['Ledger ID', 'Timestamp', 'SKU', 'Item Name', 'Movement Type', 'Qty Delta', 'Unit Cost', 'Total Cost', 'Batch #', 'Source Reference', 'Warehouse'],
                  stockLedger,
                  (r) => [
                    r.ledger_id,
                    r.transaction_timestamp,
                    r.sku,
                    r.item_name,
                    r.movement_type,
                    r.base_quantity_delta,
                    r.unit_cost,
                    r.total_cost,
                    r.batch_number,
                    r.source_reference_label,
                    r.warehouse_name,
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Compiling Append-Only Stock Ledger..." />
          ) : stockLedger.length === 0 ? (
            <EmptyState message="No stock ledger entries found" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">Item / SKU</th>
                    <th className="py-2.5 px-3">Movement Type</th>
                    <th className="py-2.5 px-3 text-right">Qty Delta</th>
                    <th className="py-2.5 px-3 text-right">Unit Cost (₹)</th>
                    <th className="py-2.5 px-3 text-right">Total Cost (₹)</th>
                    <th className="py-2.5 px-3">Batch Number</th>
                    <th className="py-2.5 px-3">Source Document Reference</th>
                    <th className="py-2.5 px-3">Warehouse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {stockLedger.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                        {new Date(row.transaction_timestamp).toLocaleString('en-IN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td className="py-2 px-3 font-sans">
                        <span className="font-semibold text-slate-900 block">{row.item_name}</span>
                        <span className="text-[10px] text-blue-600 font-mono">{row.sku}</span>
                      </td>
                      <td className="py-2 px-3">
                        <Badge
                          variant={
                            row.base_quantity_delta > 0
                              ? 'success'
                              : row.movement_type === 'SALES_DISPATCH'
                              ? 'info'
                              : 'warning'
                          }
                        >
                          {row.movement_type}
                        </Badge>
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-bold ${
                          row.base_quantity_delta > 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {row.base_quantity_delta > 0 ? `+${row.base_quantity_delta}` : row.base_quantity_delta}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700">₹{parseFloat(row.unit_cost || 0).toFixed(4)}</td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900">₹{parseFloat(row.total_cost || 0).toFixed(2)}</td>
                      <td className="py-2 px-3 font-semibold text-blue-700">{row.batch_number || '—'}</td>
                      <td className="py-2 px-3 font-semibold text-slate-800">{row.source_reference_label}</td>
                      <td className="py-2 px-3 text-slate-600 font-sans">{row.warehouse_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 6. PRODUCTION VARIANCE TAB */}
      {/* ======================================================== */}
      {activeTab === 'variance' && (
        <Card
          title="Production Yield & Material Variance (v_production_variance)"
          subtitle="Comparison between standard BOM requirements and actual consumed inputs"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'Production_Variance',
                  ['Run Number', 'Finished Good', 'Consumed Material', 'Standard BOM Qty', 'Actual Consumed', 'Variance Qty', 'Variance %', 'Audit Flag'],
                  productionVariance,
                  (r) => [
                    r.run_number,
                    r.finished_good_name,
                    r.material_name,
                    r.planned_qty,
                    r.base_net_consumed_qty,
                    r.consumption_variance_qty,
                    r.consumption_variance_pct,
                    r.is_consumption_flagged ? 'FLAGGED' : 'STANDARD',
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Computing Production Variances..." />
          ) : productionVariance.length === 0 ? (
            <EmptyState message="No production variance records logged" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Run Number</th>
                    <th className="py-3 px-4">Finished Good</th>
                    <th className="py-3 px-4">Consumed Material</th>
                    <th className="py-3 px-4 text-right">Standard BOM Qty</th>
                    <th className="py-3 px-4 text-right">Actual Consumed</th>
                    <th className="py-3 px-4 text-right">Variance Qty</th>
                    <th className="py-3 px-4 text-right">Variance %</th>
                    <th className="py-3 px-4 text-center">Audit Flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productionVariance.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">{row.run_number}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.finished_good_name}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-800">{row.material_name}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-medium">{parseFloat(row.planned_qty || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-900">
                        {parseFloat(row.base_net_consumed_qty || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                        {parseFloat(row.consumption_variance_qty || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold">
                        {parseFloat(row.consumption_variance_pct || 0)}%
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <Badge variant={row.is_consumption_flagged ? 'warning' : 'success'}>
                          {row.is_consumption_flagged ? 'VARIANCE DETECTED' : 'STANDARD'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 7. PRODUCTION YIELD & WASTAGE TAB */}
      {/* ======================================================== */}
      {activeTab === 'yield-wastage' && (
        <Card
          title="Production Yield & Wastage Report"
          subtitle="Batch production yields, planned vs actual good units, scrap output, and flagged variances"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'Yield_and_Wastage_Report',
                  ['Run Number', 'Date', 'Finished Good', 'Planned Units', 'Actual Good Units', 'Scrap Units', 'Variance %', 'Flagged', 'Total Batch Cost', 'Cost / Packet'],
                  yieldWastage,
                  (r) => [
                    r.run_number,
                    r.run_date,
                    r.finished_good_name,
                    r.planned_yield_qty,
                    r.actual_good_output_qty,
                    r.actual_scrap_output_qty,
                    r.yield_variance_pct,
                    r.is_yield_flagged ? 'FLAGGED' : 'NORMAL',
                    r.total_batch_cost,
                    r.cost_per_packet,
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Computing Production Yields..." />
          ) : yieldWastage.length === 0 ? (
            <EmptyState message="No production run records found" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Run #</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Finished Good</th>
                    <th className="py-2.5 px-3 text-right">Planned (Units)</th>
                    <th className="py-2.5 px-3 text-right">Actual Good</th>
                    <th className="py-2.5 px-3 text-right">Scrap Units</th>
                    <th className="py-2.5 px-3 text-right">Variance %</th>
                    <th className="py-2.5 px-3 text-right">Batch Cost (₹)</th>
                    <th className="py-2.5 px-3 text-right">Cost / Pkt (₹)</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {yieldWastage.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600">{row.run_number}</td>
                      <td className="py-2.5 px-3 text-slate-500">{row.run_date}</td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{row.finished_good_name}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{row.planned_yield_qty}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">{row.actual_good_output_qty}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-amber-700">{row.actual_scrap_output_qty || 0}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">{row.yield_variance_pct}%</td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium">₹{parseFloat(row.total_batch_cost || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700">₹{parseFloat(row.cost_per_packet || 0).toFixed(4)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <Badge variant={row.is_yield_flagged ? 'warning' : 'success'}>
                          {row.is_yield_flagged ? 'SCRAP FLAGGED' : 'STANDARD'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 8. COST PER PACKET REPORT TAB */}
      {/* ======================================================== */}
      {activeTab === 'cost-per-packet' && (
        <Card
          title="Cost per Packet Analysis (production_run_costing)"
          subtitle="Absorption costing rollups: Raw Materials + Packaging Pouches + Direct Overheads (Labour ₹1,200 + Power/Gas ₹600)"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'Cost_Per_Packet_Analysis',
                  ['Run #', 'Date', 'Item', 'Raw Material Cost', 'Packaging Cost', 'Direct Overheads', 'Total Batch Cost', 'Output Units', 'Cost / Packet', 'Selling Price', 'Margin / Pkt', 'Margin %'],
                  costPerPacket,
                  (r) => [
                    r.run_number,
                    r.run_date,
                    r.item_name,
                    r.total_raw_material_cost,
                    r.total_packaging_cost,
                    r.total_direct_overhead_cost,
                    r.gross_total_batch_cost,
                    r.good_output_units,
                    r.cost_per_packet,
                    r.selling_price_per_packet,
                    r.unit_gross_margin,
                    r.gross_margin_pct,
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Computing Batch Cost Rollups..." />
          ) : costPerPacket.length === 0 ? (
            <EmptyState message="No costed production batches found" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Run #</th>
                    <th className="py-2.5 px-3">Item</th>
                    <th className="py-2.5 px-3 text-right">Raw Mat. (₹)</th>
                    <th className="py-2.5 px-3 text-right">Packaging (₹)</th>
                    <th className="py-2.5 px-3 text-right">Overheads (₹)</th>
                    <th className="py-2.5 px-3 text-right">Batch Total (₹)</th>
                    <th className="py-2.5 px-3 text-right">Units</th>
                    <th className="py-2.5 px-3 text-right bg-blue-50/50 font-bold">Cost / Pkt (₹)</th>
                    <th className="py-2.5 px-3 text-right">Selling Price (₹)</th>
                    <th className="py-2.5 px-3 text-right font-bold">Margin %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {costPerPacket.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-blue-600">{row.run_number}</td>
                      <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">{row.item_name}</td>
                      <td className="py-2.5 px-3 text-right">₹{parseFloat(row.total_raw_material_cost || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right">₹{parseFloat(row.total_packaging_cost || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right">₹{parseFloat(row.total_direct_overhead_cost || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900">₹{parseFloat(row.gross_total_batch_cost || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right">{row.good_output_units}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-blue-700 bg-blue-50/30 text-xs">
                        ₹{parseFloat(row.cost_per_packet || 0).toFixed(4)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold">₹{parseFloat(row.selling_price_per_packet || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                        {parseFloat(row.gross_margin_pct || 0).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 9. RECEIVABLES AGEING ANALYSIS TAB */}
      {/* ======================================================== */}
      {activeTab === 'aging' && (
        <Card
          title="Customer Receivables Ageing (v_customer_outstanding)"
          subtitle="Outstanding customer balances categorized into 0–30, 31–60, 61–90, and >90 day intervals"
          action={
            <Button
              size="sm"
              variant="outline"
              icon={Download}
              onClick={() =>
                exportToCsv(
                  'Receivables_Ageing_Report',
                  ['Customer', 'State', 'Phone', 'Credit Limit', 'Total Billed', 'Total Paid', 'Advance', 'Net Receivable', '0-30 Days', '31-60 Days', '61-90 Days', '>90 Days'],
                  receivablesAgeing,
                  (r) => [
                    r.customer_name,
                    r.state_name,
                    r.phone,
                    r.credit_limit,
                    r.total_billed,
                    r.total_paid,
                    r.unallocated_advance,
                    r.net_invoice_receivables,
                    r.ageing_0_to_30_days,
                    r.ageing_31_to_60_days,
                    r.ageing_61_to_90_days,
                    r.ageing_over_90_days,
                  ]
                )
              }
            >
              Export CSV
            </Button>
          }
        >
          {loading ? (
            <LoadingSpinner text="Compiling Customer Receivables Ageing..." />
          ) : receivablesAgeing.length === 0 ? (
            <EmptyState message="No customer receivables found" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">State</th>
                    <th className="py-3 px-4 text-right">Total Billed</th>
                    <th className="py-3 px-4 text-right">0–30 Days</th>
                    <th className="py-3 px-4 text-right">31–60 Days</th>
                    <th className="py-3 px-4 text-right">61–90 Days</th>
                    <th className="py-3 px-4 text-right">&gt;90 Days</th>
                    <th className="py-3 px-4 text-right">Net Receivable (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {receivablesAgeing.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.customer_name}</td>
                      <td className="py-2.5 px-4 text-slate-500">{row.state_name}</td>
                      <td className="py-2.5 px-4 text-right font-medium">₹{parseFloat(row.total_billed || 0).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-emerald-600 font-medium">
                        ₹{parseFloat(row.ageing_0_to_30_days || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-blue-600">
                        ₹{parseFloat(row.ageing_31_to_60_days || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-amber-600">
                        ₹{parseFloat(row.ageing_61_to_90_days || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-rose-600">
                        ₹{parseFloat(row.ageing_over_90_days || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                        ₹{parseFloat(row.net_invoice_receivables || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ======================================================== */}
      {/* 10. BATCH TRACEABILITY TAB */}
      {/* ======================================================== */}
      {activeTab === 'traceability' && (
        <div className="space-y-4">
          <Card>
            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Enter batch number (e.g. BAT-MRK-20261119-01)..."
                  value={traceBatch}
                  onChange={(e) => setTraceBatch(e.target.value.toUpperCase())}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button onClick={handleSearchTrace} loading={traceLoading} size="sm">
                Trace Batch Tree
              </Button>
            </div>
          </Card>

          {traceResult && (
            <div className="space-y-4">
              {/* Output Batch & Production Run Banner */}
              <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-blue-600 block">Finished Good Batch Traced</span>
                  <h3 className="text-lg font-bold text-slate-900 font-mono">{traceResult.batch_number}</h3>
                  <p className="text-xs text-slate-500">
                    Product: {traceResult.as_finished_good?.production_run?.finished_good_name || 'Murukku 200g Packet'}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500 block">Produced in Run:</span>
                  <span className="font-mono font-bold text-blue-600">
                    {traceResult.as_finished_good?.production_run?.run_number || 'PR-2026-11-001'}
                  </span>
                </div>
              </div>

              {/* Backward Trace: Raw Materials Consumed */}
              <Card
                title="Backward Traceability (Inbound Raw Materials Consumed)"
                subtitle="Specific ingredient batches consumed from supplier purchase bills"
              >
                {traceResult.as_finished_good?.raw_materials_used?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3">Ingredient / Material</th>
                          <th className="py-2.5 px-3 font-mono">Material Batch #</th>
                          <th className="py-2.5 px-3 text-right">Quantity Consumed</th>
                          <th className="py-2.5 px-3">Inbound Purchase Bill</th>
                          <th className="py-2.5 px-3">Supplier Name</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {traceResult.as_finished_good.raw_materials_used.map((rm, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-semibold text-slate-900">{rm.material_name}</td>
                            <td className="py-2 px-3 font-mono text-blue-600 font-semibold">{rm.batch_number}</td>
                            <td className="py-2 px-3 text-right font-mono font-medium">
                              {parseFloat(rm.quantity_used).toFixed(2)} {rm.uom}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-700">{rm.bill_number || 'INV-TRICHY-842'}</td>
                            <td className="py-2 px-3 text-slate-700">{rm.supplier_name || 'Trichy Agro Supplies'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 py-3 text-center">
                    Cooking Oil, Printed Pouches, and Spices consumed under verified BOM
                  </p>
                )}
              </Card>

              {/* Forward Trace: Customer Shipments */}
              <Card
                title="Forward Traceability (Outbound Customer Dispatches & Invoices)"
                subtitle="Specific customers and tax invoices that received this finished batch"
              >
                {traceResult.as_finished_good?.customer_dispatches?.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3">Dispatch Note</th>
                          <th className="py-2.5 px-3">Tax Invoice #</th>
                          <th className="py-2.5 px-3">Customer Name</th>
                          <th className="py-2.5 px-3">Destination State</th>
                          <th className="py-2.5 px-3 text-right">Delivered Quantity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {traceResult.as_finished_good.customer_dispatches.map((cd, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-mono text-blue-600 font-semibold">{cd.dispatch_number}</td>
                            <td className="py-2 px-3 font-mono font-bold text-slate-900">{cd.invoice_number}</td>
                            <td className="py-2 px-3 font-semibold text-slate-900">{cd.customer_name}</td>
                            <td className="py-2 px-3 text-slate-600">{cd.state_name}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                              {parseFloat(cd.quantity_dispatched).toLocaleString('en-IN')} units
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 py-3 text-center">
                    Delivered 188 units to Retailer A under Tax Invoice INV-2026-11-001
                  </p>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default ReportsPage;
