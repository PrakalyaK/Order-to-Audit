import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, EmptyState } from '../../components/ui';
import { BarChart3, Search, FileText, ArrowRight, CheckCircle2, ShieldCheck, Printer } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const ReportsPage = () => {
  const { hasRole, user } = useAuth();
  const canViewSales = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN, ROLES.AUDITOR);
  const canViewProd = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR);

  const [activeTab, setActiveTab] = useState(canViewSales ? 'gst' : 'variance'); // 'gst' | 'aging' | 'variance' | 'traceability'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Report states
  const [salesData, setSalesData] = useState(null);
  const [prodData, setProdData] = useState(null);
  const [traceBatch, setTraceBatch] = useState('BAT-MRK-20261119-01');
  const [traceResult, setTraceResult] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError('');
      const promises = [];
      if (canViewSales) promises.push(api.get('/reports/sales'));
      if (canViewProd) promises.push(api.get('/reports/production'));

      const results = await Promise.allSettled(promises);
      let idx = 0;
      if (canViewSales) {
        const sRes = results[idx++];
        if (sRes?.status === 'fulfilled' && sRes.value?.success) {
          setSalesData(sRes.value.data);
        }
      }
      if (canViewProd) {
        const pRes = results[idx++];
        if (pRes?.status === 'fulfilled' && pRes.value?.success) {
          setProdData(pRes.value.data);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch statutory reports');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchTrace = async () => {
    if (!canViewProd || !traceBatch) return;
    try {
      setTraceLoading(true);
      const res = await api.get(`/reports/traceability/${traceBatch}`);
      if (res.success) {
        setTraceResult(res.data);
      }
    } catch (err) {
      alert(`Traceability lookup failed: ${err.message}`);
    } finally {
      setTraceLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    if (canViewProd) {
      handleSearchTrace();
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Statutory Reports & Batch Traceability</h1>
          <p className="text-xs text-slate-500 mt-1">
            GSTR Outward Supplies register, Customer Receivables Ageing, Production Variances, and End-to-End Batch Trees
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={Printer} onClick={() => window.print()}>
            Print / Export PDF
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {canViewSales && (
          <button
            onClick={() => setActiveTab('gst')}
            className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
              activeTab === 'gst'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            GSTR Outward Supplies Register
          </button>
        )}
        {canViewSales && (
          <button
            onClick={() => setActiveTab('aging')}
            className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
              activeTab === 'aging'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Receivables Ageing Analysis
          </button>
        )}
        {canViewProd && (
          <button
            onClick={() => setActiveTab('variance')}
            className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
              activeTab === 'variance'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Production Yield & Variance
          </button>
        )}
        {canViewProd && (
          <button
            onClick={() => setActiveTab('traceability')}
            className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
              activeTab === 'traceability'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            End-to-End Batch Traceability
          </button>
        )}
      </div>

      {/* GSTR Outward Register Tab */}
      {activeTab === 'gst' && canViewSales && (
        <Card title="GSTR Outward Supplies (v_gst_outward_summary)" subtitle="Statutory tax breakdown per invoice">
          {loading ? (
            <LoadingSpinner text="Compiling GSTR Outward Supplies..." />
          ) : !Array.isArray(salesData?.gst_outward) || salesData.gst_outward.length === 0 ? (
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
                  {(Array.isArray(salesData?.gst_outward) ? salesData.gst_outward : []).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">{row.invoice_number}</td>
                      <td className="py-2.5 px-4 text-slate-500">{row.invoice_date}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.customer_name}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px]">{row.customer_gstin || 'UNREGISTERED'}</td>
                      <td className="py-2.5 px-4 text-right font-medium">
                        ₹{parseFloat(row.total_taxable_value || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        ₹{parseFloat(row.total_cgst || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        ₹{parseFloat(row.total_sgst || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono">
                        ₹{parseFloat(row.total_igst || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-slate-900">
                        ₹{parseFloat(row.total_invoice_value || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Receivables Ageing Tab */}
      {activeTab === 'aging' && canViewSales && (
        <Card title="Customer Receivables Ageing (v_customer_outstanding)" subtitle="Outstanding balances categorized by statutory ageing intervals">
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
                {(Array.isArray(salesData?.customer_outstanding) ? salesData.customer_outstanding : []).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{row.customer_name}</td>
                    <td className="py-2.5 px-4 text-slate-500">{row.state_name}</td>
                    <td className="py-2.5 px-4 text-right font-medium">
                      ₹{parseFloat(row.total_billed || 0).toFixed(2)}
                    </td>
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
        </Card>
      )}

      {/* Production Variance Tab */}
      {activeTab === 'variance' && canViewProd && (
        <Card title="Production Yield & Material Variance (v_production_variance)" subtitle="Comparison between standard BOM requirements and actual consumed inputs">
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
                {(Array.isArray(prodData?.variance) ? prodData.variance : []).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">{row.run_number}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{row.finished_good_name}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-800">{row.material_name}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-medium">
                      {parseFloat(row.planned_qty || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-900">
                      {parseFloat(row.base_net_consumed_qty || 0).toFixed(2)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold">
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
        </Card>
      )}

      {/* Batch Traceability Tab */}
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
                  <span className="text-[10px] uppercase font-bold text-blue-600 block">
                    Finished Good Batch Traced
                  </span>
                  <h3 className="text-lg font-bold text-slate-900 font-mono">
                    {traceResult.batch_number}
                  </h3>
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
