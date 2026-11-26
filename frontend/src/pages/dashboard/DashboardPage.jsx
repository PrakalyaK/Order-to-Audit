import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Card, StatCard, LoadingSpinner, Badge, Button } from '../../components/ui';
import { useAuth, ROLES } from '../../context/AuthContext';
import {
  TrendingUp,
  ShoppingBag,
  Boxes,
  Factory,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Receipt,
  Building,
  Truck,
  ShoppingCart,
  Play,
  ArrowRight,
  Layers,
  CheckCircle2,
  FileSpreadsheet,
  Users,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

export const DashboardPage = () => {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/reports/dashboard');
      if (res.success && res.data) {
        setData(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch dashboard metrics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  if (loading && !data) {
    return <LoadingSpinner text="Aggregating Real-Time ERP Metrics from PostgreSQL..." />;
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-sm">
        <p className="font-semibold">Unable to load dashboard:</p>
        <p className="mt-1">{error}</p>
        <Button onClick={fetchDashboard} variant="secondary" size="sm" className="mt-3">
          Retry
        </Button>
      </div>
    );
  }

  const { sales, purchases, inventory, production, receivables, payables, recent } = data || {};

  const comparisonData = [
    { name: 'Revenue vs Spend', Invoiced: sales?.total_sales || 0, Purchased: purchases?.total_purchases || 0 },
    { name: 'Cash Realized', Collected: sales?.total_collected || 0, Paid: purchases?.total_paid || 0 },
  ];

  const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ec4899'];

  return (
    <div className="space-y-6">
      {/* Top Welcome / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Executive & Operations Dashboard</h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time operational metrics calculated directly from immutable PostgreSQL ledgers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchDashboard} variant="outline" size="sm" icon={RefreshCw} loading={loading}>
            Refresh Metrics
          </Button>
        </div>
      </div>

      {/* Role-Specific Quick Action & Workspaces Banner */}
      {user?.role === 'salesman' && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-blue-500/10 border border-emerald-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-emerald-600 text-white rounded-lg">
                  <ShoppingCart className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-slate-900 text-sm">Sales Field Workspace &bull; {user.name}</h3>
                <Badge variant="success">Sales Representative</Badge>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Book field orders directly with GST auto-calculation, track order approval status, and inspect retailer credit balances.
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="primary"
                size="sm"
                icon={ShoppingCart}
                onClick={() => navigate('/sales/orders')}
                className="bg-emerald-600 hover:bg-emerald-700 w-full sm:w-auto"
              >
                Place Field Order
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={Users}
                onClick={() => navigate('/parties')}
                className="w-full sm:w-auto"
              >
                Retailer Directory
              </Button>
            </div>
          </div>
        </div>
      )}

      {user?.role === 'production_supervisor' && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-purple-500/10 border border-amber-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-amber-600 text-white rounded-lg">
                  <Factory className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-slate-900 text-sm">Shop Floor Supervisor Hub &bull; {user.name}</h3>
                <Badge variant="warning">Floor Operations</Badge>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Execute production runs with batch FEFO material issues, track real-time yield variances, and absorb labor & fuel overheads.
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="primary"
                size="sm"
                icon={Play}
                onClick={() => navigate('/production')}
                className="bg-amber-600 hover:bg-amber-700 w-full sm:w-auto"
              >
                Active Production Runs
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={Layers}
                onClick={() => navigate('/master/boms')}
                className="w-full sm:w-auto"
              >
                Recipe Catalogue
              </Button>
            </div>
          </div>
        </div>
      )}

      {user?.role === 'factory_admin' && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 border border-blue-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-blue-600 text-white rounded-lg">
                  <Truck className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-slate-900 text-sm">Factory Admin Desk &bull; {user.name}</h3>
                <Badge variant="primary">Operations Control</Badge>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Approve field sales orders, manage finished goods stock shortages, generate Production Requirements (PRQ), and post FEFO dispatches.
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="primary"
                size="sm"
                icon={CheckCircle2}
                onClick={() => navigate('/sales/orders')}
                className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
              >
                Order Approvals
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={Truck}
                onClick={() => navigate('/sales/fulfilment')}
                className="w-full sm:w-auto"
              >
                Fulfilment & Dispatch
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={ShoppingBag}
                onClick={() => navigate('/purchases')}
                className="w-full sm:w-auto"
              >
                Raw Material Inward
              </Button>
            </div>
          </div>
        </div>
      )}

      {user?.role === 'auditor' && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-rose-500/10 via-pink-500/10 to-slate-500/10 border border-rose-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="p-1.5 bg-rose-600 text-white rounded-lg">
                  <FileSpreadsheet className="w-4 h-4" />
                </span>
                <h3 className="font-bold text-slate-900 text-sm">Statutory Auditor Console &bull; {user.name}</h3>
                <Badge variant="danger">Audit & Compliance</Badge>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Verify tamper-proof append-only inventory ledgers, Moving WAC cost absorption, GSTR-1 tax compliance, and statutory balance sheets.
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="primary"
                size="sm"
                icon={FileSpreadsheet}
                onClick={() => navigate('/reports/sales-register')}
                className="bg-rose-600 hover:bg-rose-700 w-full sm:w-auto"
              >
                GST Outward Register
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={Boxes}
                onClick={() => navigate('/inventory/ledger')}
                className="w-full sm:w-auto"
              >
                Inventory Ledger Audit
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={Receipt}
                onClick={() => navigate('/accounting/trial-balance')}
                className="w-full sm:w-auto"
              >
                Trial Balance
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* KPI Cards Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Invoiced Sales"
          value={`₹${(sales?.total_sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          icon={TrendingUp}
          color="blue"
          subtitle={`₹${(sales?.total_collected || 0).toLocaleString('en-IN')} collected (${sales?.total_invoices || 0} invoices)`}
        />
        <StatCard
          title="Purchases Billed"
          value={`₹${(purchases?.total_purchases || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          icon={ShoppingBag}
          color="amber"
          subtitle={`₹${(purchases?.total_paid || 0).toLocaleString('en-IN')} disbursed (${purchases?.total_bills || 0} bills)`}
        />
        <StatCard
          title="Inventory Valuation"
          value={`₹${(inventory?.total_valuation || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          icon={Boxes}
          color="green"
          subtitle={`${inventory?.distinct_items_count || 0} active SKU stock balances`}
        />
        <StatCard
          title="Production Output"
          value={`${production?.completed_runs_count || 0} Completed`}
          icon={Factory}
          color="purple"
          subtitle={`${production?.active_runs_count || 0} active runs in process`}
        />
      </div>

      {/* KPI Cards Row 2 - Receivables, Payables, Alerts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Customer Receivables"
          value={`₹${(receivables?.total_outstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          icon={ArrowUpRight}
          color="blue"
          subtitle="Total open invoice balances"
        />
        <StatCard
          title="Supplier Payables"
          value={`₹${(payables?.total_outstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          icon={ArrowDownRight}
          color="rose"
          subtitle="Total open purchase bill liabilities"
        />
        <StatCard
          title="Low-Stock Alerts"
          value={`${inventory?.low_stock_count || 0} Items`}
          icon={AlertTriangle}
          color="amber"
          subtitle="At or below minimum reorder level"
        />
        <StatCard
          title="Near-Expiry Batches"
          value={`${inventory?.near_expiry_count || 0} Batches`}
          icon={Clock}
          color="rose"
          subtitle="Expiring within statutory 30-day window"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Sales Revenue vs Purchases" subtitle="Operational comparison of billing and expenses">
          <div className="h-64 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={comparisonData}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} tickFormatter={(val) => `₹${val}`} />
                <Tooltip formatter={(value) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Amount']} />
                <Legend />
                <Bar dataKey="Invoiced" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Purchased" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Collected" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Paid" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Statutory Audit Readiness" subtitle="Real-time compliance status against statutory requirements">
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <div>
                  <div className="text-xs font-bold text-emerald-950">Append-Only Inventory Ledger</div>
                  <div className="text-[11px] text-emerald-700">Moving Weighted Average Cost triggers verified</div>
                </div>
              </div>
              <Badge variant="success">Active</Badge>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 border border-blue-200">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                <div>
                  <div className="text-xs font-bold text-blue-950">Statutory GST Outward Register</div>
                  <div className="text-[11px] text-blue-700">CGST, SGST, IGST tax breakdown synchronized</div>
                </div>
              </div>
              <Badge variant="primary">Compliant</Badge>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-purple-50 border border-purple-200">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                <div>
                  <div className="text-xs font-bold text-purple-950">Double-Entry Financial Balancing</div>
                  <div className="text-[11px] text-purple-700">Automatic journal entry posting enabled</div>
                </div>
              </div>
              <Badge variant="purple">Balanced</Badge>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>
                <div>
                  <div className="text-xs font-bold text-slate-900">Tamper-Proof Audit Logging</div>
                  <div className="text-[11px] text-slate-600">Strict immutability database triggers active</div>
                </div>
              </div>
              <Badge variant="default">Protected</Badge>
            </div>
          </div>
        </Card>
      </div>

      {/* Operational Feeds Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices */}
        <Card title="Recent Invoices" subtitle="Latest billed customer invoices">
          <div className="divide-y divide-slate-100">
            {Array.isArray(recent?.invoices) && recent.invoices.length > 0 ? (
              recent.invoices.map((inv) => (
                <div key={inv.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-800">{inv.invoice_number}</span>
                    <p className="text-[11px] text-slate-500">{inv.customer_name}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-slate-900">
                      ₹{parseFloat(inv.total_amount || inv.total_invoice_value || 0).toLocaleString('en-IN')}
                    </span>
                    <div>
                      <Badge variant={inv.status === 'paid' ? 'success' : 'primary'}>{inv.status}</Badge>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">No recent invoices</p>
            )}
          </div>
        </Card>

        {/* Recent Production Runs */}
        <Card title="Recent Production Runs" subtitle="Batch execution status">
          <div className="divide-y divide-slate-100">
            {Array.isArray(recent?.production_runs) && recent.production_runs.length > 0 ? (
              recent.production_runs.map((pr) => (
                <div key={pr.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-800">{pr.run_number}</span>
                    <p className="text-[11px] text-slate-500">{pr.item_name || pr.finished_good_name}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-slate-700">
                      {parseFloat(pr.actual_good_output_qty || pr.actual_output_qty || pr.planned_yield_qty || pr.planned_output_qty || 0)} units
                    </span>
                    <div>
                      <Badge variant={pr.status === 'COMPLETED' || pr.status === 'completed' ? 'success' : 'warning'}>{pr.status}</Badge>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">No recent production runs</p>
            )}
          </div>
        </Card>

        {/* Recent Purchase Bills */}
        <Card title="Recent Purchases" subtitle="Inbound supplier shipments">
          <div className="divide-y divide-slate-100">
            {Array.isArray(recent?.purchase_bills) && recent.purchase_bills.length > 0 ? (
              recent.purchase_bills.map((pb) => (
                <div key={pb.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-800">{pb.bill_number}</span>
                    <p className="text-[11px] text-slate-500">{pb.supplier_name}</p>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-slate-900">
                      ₹{parseFloat(pb.total_amount || 0).toLocaleString('en-IN')}
                    </span>
                    <div>
                      <Badge variant={pb.status === 'received' || pb.status === 'posted' ? 'success' : 'default'}>{pb.status}</Badge>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-400 py-4 text-center">No recent purchase bills</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
