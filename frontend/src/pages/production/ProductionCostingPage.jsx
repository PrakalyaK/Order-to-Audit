import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, EmptyState } from '../../components/ui';
import {
  Calculator,
  Plus,
  Trash2,
  Factory,
  Zap,
  User,
  Wrench,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Package,
  Layers,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const ProductionCostingPage = () => {
  const { hasRole } = useAuth();
  const canManageExpenses = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR);

  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [costingData, setCostingData] = useState(null);
  const [summaryList, setSummaryList] = useState([]);
  const [activeTab, setActiveTab] = useState('run-costing'); // 'run-costing' | 'comparison'

  const [loading, setLoading] = useState(true);
  const [submittingExpense, setSubmittingExpense] = useState(false);
  const [error, setError] = useState('');

  // New Expense Form State
  const [expenseForm, setExpenseForm] = useState({
    overhead_type: 'labour',
    description: 'Floor 4-operator batch frying & packaging',
    amount: 1200,
  });

  // Fetch production runs and all costing summaries
  const fetchInitialData = async () => {
    try {
      setLoading(true);
      setError('');

      const [runsRes, summaryRes] = await Promise.allSettled([
        api.get('/production', { params: { limit: 100 } }),
        api.get('/production/costing/summary'),
      ]);

      let runsList = [];
      if (runsRes.status === 'fulfilled' && runsRes.value?.success) {
        const raw = runsRes.value.data?.production_runs || runsRes.value.data;
        runsList = Array.isArray(raw) ? raw : [];
        setRuns(runsList);
      }

      if (summaryRes.status === 'fulfilled' && summaryRes.value?.success) {
        setSummaryList(Array.isArray(summaryRes.value.data) ? summaryRes.value.data : []);
      }

      // Default select benchmark run or first run
      const benchmarkRun = runsList.find((r) => r.run_number === 'PR-2026-11-001') || runsList[0];
      if (benchmarkRun && !selectedRunId) {
        setSelectedRunId(benchmarkRun.id);
        await loadRunCosting(benchmarkRun.id);
      }
    } catch (err) {
      setError(err.message || 'Failed to load production costing');
    } finally {
      setLoading(false);
    }
  };

  // Fetch detailed costing for selected run
  const loadRunCosting = async (runId) => {
    if (!runId) return;
    try {
      setLoading(true);
      const res = await api.get(`/production/${runId}/costing`);
      if (res.success && res.data) {
        setCostingData(res.data);
      }
    } catch (err) {
      console.error('Failed to load costing details:', err);
      // Fallback: try to fetch run details directly
      try {
        const runRes = await api.get(`/production/${runId}`);
        if (runRes.success && runRes.data) {
          setCostingData({
            production_run_id: runRes.data.id,
            run_number: runRes.data.run_number,
            status: runRes.data.status,
            finished_good: {
              sku: runRes.data.finished_good_sku,
              name: runRes.data.finished_good_name,
            },
            costing: runRes.data.costing || {},
            overheads: runRes.data.overheads || [],
            inputs: runRes.data.inputs || [],
          });
        }
      } catch (_) {}
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const handleSelectRun = (runId) => {
    setSelectedRunId(runId);
    loadRunCosting(runId);
  };

  // Pre-fill standard benchmark expense presets
  const handleApplyPreset = (type, desc, amt) => {
    setExpenseForm({
      overhead_type: type,
      description: desc,
      amount: amt,
    });
  };

  // Record/Add Expense
  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (!selectedRunId) {
      alert('Please select a production run first.');
      return;
    }
    if (Number(expenseForm.amount) <= 0) {
      alert('Expense amount must be greater than zero.');
      return;
    }

    setSubmittingExpense(true);
    try {
      const payload = {
        overhead_type: expenseForm.overhead_type,
        description: expenseForm.description,
        amount: Number(expenseForm.amount),
      };

      const res = await api.post(`/production/${selectedRunId}/overheads`, payload);
      alert(`Expense added successfully to production run!\nOverall production batch cost and cost per packet have been recalculated.`);
      await loadRunCosting(selectedRunId);

      // Reset form to next suggested expense (if labour was added, suggest power/gas)
      if (expenseForm.overhead_type === 'labour') {
        setExpenseForm({
          overhead_type: 'power_gas',
          description: 'LPG cylinder consumption & fryer motor power',
          amount: 600,
        });
      } else {
        setExpenseForm({
          overhead_type: 'labour',
          description: 'Floor 4-operator batch frying & packaging',
          amount: 1200,
        });
      }

      // Refresh comparison summary in background
      const sumRes = await api.get('/production/costing/summary');
      if (sumRes.success && Array.isArray(sumRes.data)) {
        setSummaryList(sumRes.data);
      }
    } catch (err) {
      alert(`Failed to record expense: ${err.message}`);
    } finally {
      setSubmittingExpense(false);
    }
  };

  // Delete an overhead expense
  const handleDeleteExpense = async (overheadId) => {
    if (!window.confirm('Are you sure you want to delete this expense from the production run? Costing will be automatically recalculated.')) {
      return;
    }
    try {
      await api.delete(`/production/${selectedRunId}/overheads/${overheadId}`);
      alert('Expense deleted and costing updated.');
      await loadRunCosting(selectedRunId);

      const sumRes = await api.get('/production/costing/summary');
      if (sumRes.success && Array.isArray(sumRes.data)) {
        setSummaryList(sumRes.data);
      }
    } catch (err) {
      alert(`Failed to delete expense: ${err.message}`);
    }
  };

  // Costing calculations
  const costing = costingData?.costing || {};
  const overheads = costingData?.overheads || [];
  const inputs = costingData?.inputs || [];

  const rawCost = parseFloat(costing.total_raw_material_cost || 0);
  const pkgCost = parseFloat(costing.total_packaging_cost || 0);
  const totalMaterialCost = rawCost + pkgCost;
  const directOverheadCost = parseFloat(costing.total_direct_overhead_cost || overheads.reduce((sum, o) => sum + parseFloat(o.amount || 0), 0));
  const grossBatchCost = parseFloat(costing.gross_total_batch_cost || (totalMaterialCost + directOverheadCost));
  const outputUnits = parseFloat(costing.good_output_units || costingData?.actual_good_output_qty || 188);
  const costPerPacket = parseFloat(costing.cost_per_packet || (outputUnits > 0 ? grossBatchCost / outputUnits : 0));
  const sellingPrice = parseFloat(costing.selling_price_per_packet || 50.0);
  const unitMargin = parseFloat(costing.unit_gross_margin || (sellingPrice - costPerPacket));
  const marginPct = parseFloat(costing.gross_margin_pct || (sellingPrice > 0 ? (unitMargin / sellingPrice) * 100 : 0));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Calculator className="w-6 h-6 text-blue-600" />
            <span>Production Costing & Direct Expenses</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Associate direct labour, fuel & power, and manufacturing overheads with production runs to calculate total batch manufacturing cost, cost per packet, and profit margins
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('run-costing')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              activeTab === 'run-costing' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Batch Costing & Expenses
          </button>
          <button
            onClick={() => setActiveTab('comparison')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              activeTab === 'comparison' ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Batch Cost Comparison
          </button>
        </div>
      </div>

      {activeTab === 'run-costing' && (
        <div className="space-y-6">
          {/* Run Selector Card */}
          <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Factory className="w-4 h-4 text-blue-600" />
                Select Production Run:
              </span>
              <select
                value={selectedRunId}
                onChange={(e) => handleSelectRun(e.target.value)}
                className="text-xs font-mono font-semibold border border-slate-300 rounded-lg p-2 bg-slate-50 min-w-[320px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.run_number} — {r.finished_good_name || 'Murukku 200g'} ({parseFloat(r.actual_good_output_qty || 188).toFixed(0)} pkts) [{r.status?.toUpperCase()}]
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <Badge variant={costingData?.status === 'completed' ? 'success' : 'warning'}>
                {costingData?.status ? costingData.status.toUpperCase() : 'IN PROGRESS'}
              </Badge>
              <button
                onClick={() => loadRunCosting(selectedRunId)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
                title="Refresh costing calculation"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {loading ? (
            <LoadingSpinner text="Calculating production run costing and overhead absorption..." />
          ) : (
            <>
              {/* Financial KPI Rollup Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">Raw Materials</span>
                  <span className="text-base font-bold text-slate-800 font-mono">
                    ₹{rawCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Flour, Oil, Spices</span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">Packaging</span>
                  <span className="text-base font-bold text-slate-800 font-mono">
                    ₹{pkgCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Pouches & Cartons</span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-blue-600 block tracking-wider">Direct Overheads</span>
                  <span className="text-base font-bold text-blue-700 font-mono">
                    ₹{directOverheadCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Labour, Power & Fuel</span>
                </div>

                <div className="p-3 bg-slate-900 text-white rounded-xl shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block tracking-wider">Total Batch Cost</span>
                  <span className="text-lg font-bold text-white font-mono">
                    ₹{grossBatchCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Output: {outputUnits.toFixed(0)} pkts</span>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-emerald-800 block tracking-wider">Cost per Packet</span>
                  <span className="text-xl font-bold text-emerald-700 font-mono">
                    ₹{costPerPacket.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">₹{costPerPacket.toFixed(4)} exact</span>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm">
                  <span className="text-[10px] font-bold uppercase text-emerald-800 block tracking-wider">Gross Margin</span>
                  <span className="text-xl font-bold text-emerald-700 font-mono">
                    {marginPct.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-emerald-600 block mt-0.5">₹{unitMargin.toFixed(2)} / pkt profit</span>
                </div>
              </div>

              {/* Two Column Layout: Record Expense Form + Overheads Ledger */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left 5 cols: Expense Entry Form */}
                <div className="lg:col-span-5 space-y-4">
                  <Card title="Record Additional Production Expenses">
                    <form onSubmit={handleAddExpense} className="space-y-4 text-xs">
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 flex items-start gap-2.5">
                        <Sparkles className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                        <div>
                          <strong className="font-semibold block">Batch Direct Expense Allocation:</strong>
                          Associate shop floor labour, fuel, LPG, or machinery costs with{' '}
                          <span className="font-mono font-bold text-blue-800">{costingData?.run_number}</span> to absorption-cost each finished packet.
                        </div>
                      </div>

                      {/* Quick Presets */}
                      <div>
                        <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                          Quick Presets (Benchmark Scenario):
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleApplyPreset('labour', 'Floor 4-operator batch frying & packaging', 1200)}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 border border-slate-200 transition"
                          >
                            + Labour (₹1,200)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApplyPreset('power_gas', 'LPG cylinder consumption & fryer motor power', 600)}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-700 border border-slate-200 transition"
                          >
                            + Gas & Power (₹600)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApplyPreset('maintenance', 'Fryer mesh cleaning & servicing', 250)}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 hover:bg-purple-50 hover:text-purple-700 text-slate-700 border border-slate-200 transition"
                          >
                            + Maintenance (₹250)
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Expense Type / Category *</label>
                        <select
                          value={expenseForm.overhead_type}
                          onChange={(e) => setExpenseForm({ ...expenseForm, overhead_type: e.target.value })}
                          className="w-full border border-slate-300 rounded-lg p-2 bg-white"
                        >
                          <option value="labour">Labour Cost (Direct Operators & Packaging)</option>
                          <option value="power_gas">Gas and Power Expenses (LPG & Fryer Electricity)</option>
                          <option value="maintenance">Machinery Maintenance & Tooling</option>
                          <option value="depreciation">Equipment Depreciation</option>
                          <option value="other">Other Factory Direct Expenses</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Description / Narration</label>
                        <input
                          type="text"
                          required
                          value={expenseForm.description}
                          onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                          placeholder="e.g. Floor 4-operator batch frying & packaging"
                          className="w-full border border-slate-300 rounded-lg p-2 bg-white"
                        />
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Amount (₹) *</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={expenseForm.amount}
                          onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                          className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold text-slate-900 bg-white"
                        />
                      </div>

                      <div className="pt-2">
                        <Button
                          type="submit"
                          disabled={submittingExpense || !canManageExpenses}
                          icon={Plus}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          {submittingExpense ? 'Recording Expense...' : 'Add Expense & Recalculate Batch Cost'}
                        </Button>
                      </div>
                    </form>
                  </Card>
                </div>

                {/* Right 7 cols: Current Overheads Ledger */}
                <div className="lg:col-span-7 space-y-4">
                  <Card title={`Direct Overheads Allocated to ${costingData?.run_number || 'Batch'}`}>
                    {overheads.length === 0 ? (
                      <EmptyState message="No direct overhead expenses recorded for this production run yet. Use the form on the left to add Labour (₹1,200) and Gas/Power (₹600)." />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs text-slate-600">
                          <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                            <tr>
                              <th className="py-2.5 px-3">Expense Type</th>
                              <th className="py-2.5 px-3">Description</th>
                              <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                              <th className="py-2.5 px-3 text-right">% of Overheads</th>
                              <th className="py-2.5 px-3 text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {overheads.map((ovh) => {
                              const amt = parseFloat(ovh.amount || 0);
                              const pct = directOverheadCost > 0 ? (amt / directOverheadCost) * 100 : 0;
                              const isLabour = ovh.overhead_type === 'labour';
                              const isPower = ovh.overhead_type === 'power_gas';

                              return (
                                <tr key={ovh.id} className="hover:bg-slate-50/80">
                                  <td className="py-2.5 px-3 font-semibold text-slate-900 flex items-center gap-1.5">
                                    {isLabour ? (
                                      <User className="w-3.5 h-3.5 text-blue-600" />
                                    ) : isPower ? (
                                      <Zap className="w-3.5 h-3.5 text-amber-600" />
                                    ) : (
                                      <Wrench className="w-3.5 h-3.5 text-purple-600" />
                                    )}
                                    <span className="uppercase text-[11px]">
                                      {ovh.overhead_type?.replace('_', ' ')}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 text-slate-600">{ovh.description || '—'}</td>
                                  <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                    ₹{amt.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                                    {pct.toFixed(1)}%
                                  </td>
                                  <td className="py-2.5 px-3 text-center">
                                    {canManageExpenses && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteExpense(ovh.id)}
                                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                        title="Delete expense"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                            <tr>
                              <td colSpan="2" className="py-2.5 px-3 text-slate-900 uppercase text-[11px]">
                                Total Direct Overheads Absorbed:
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-blue-700 text-sm">
                                ₹{directOverheadCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td colSpan="2" className="py-2.5 px-3 text-right text-[11px] text-slate-500">
                                (₹{(outputUnits > 0 ? directOverheadCost / outputUnits : 0).toFixed(2)}/pkt)
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </Card>

                  {/* Summary Cost Rollup Box */}
                  <div className="p-4 bg-slate-900 text-white rounded-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="text-xs uppercase font-bold text-slate-400">Total Manufacturing Absorption:</span>
                      <span className="text-xl font-bold font-mono text-emerald-400">
                        ₹{costPerPacket.toFixed(2)} / packet
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                      <div>
                        <span className="text-slate-400 block">Raw Materials:</span>
                        <span className="text-white font-bold">
                          ₹{(outputUnits > 0 ? rawCost / outputUnits : 0).toFixed(2)}/pkt
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Packaging:</span>
                        <span className="text-white font-bold">
                          ₹{(outputUnits > 0 ? pkgCost / outputUnits : 0).toFixed(2)}/pkt
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Overheads:</span>
                        <span className="text-blue-300 font-bold">
                          ₹{(outputUnits > 0 ? directOverheadCost / outputUnits : 0).toFixed(2)}/pkt
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Material Inputs Table */}
              <Card title="Raw Material & Packaging Ingredients Consumed in Batch">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">Item / Ingredient</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3 text-right">Standard BOM Qty</th>
                        <th className="py-2.5 px-3 text-right">Actual Issued Qty</th>
                        <th className="py-2.5 px-3 text-right">Actual Consumed</th>
                        <th className="py-2.5 px-3 text-right">Unit Moving WAC (₹)</th>
                        <th className="py-2.5 px-3 text-right">Total Material Cost (₹)</th>
                        <th className="py-2.5 px-3 text-center">Variance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inputs.map((inp) => {
                        const planned = parseFloat(inp.planned_qty || 0);
                        const issued = parseFloat(inp.actual_issued_qty || 0);
                        const consumed = parseFloat(inp.actual_consumed_qty || inp.base_net_consumed_qty || issued);
                        const rate = parseFloat(inp.unit_cost_applied || 0);
                        const cost = parseFloat(inp.total_material_cost || consumed * rate);
                        const varPct = parseFloat(inp.consumption_variance_pct || 0);

                        return (
                          <tr key={inp.item_id} className="hover:bg-slate-50/80">
                            <td className="py-2.5 px-3 font-semibold text-slate-900">
                              {inp.item_name}
                              <span className="block text-[10px] text-slate-400 font-mono">{inp.item_sku}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  inp.item_type === 'raw_material' ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800'
                                }`}
                              >
                                {inp.item_type === 'raw_material' ? 'RAW MATERIAL' : 'PACKAGING'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              {planned.toFixed(2)} {inp.uom_id}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                              {issued.toFixed(2)} {inp.uom_id}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              {consumed.toFixed(2)} {inp.uom_id}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono">
                              ₹{rate.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                              ₹{cost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {varPct > 0 ? (
                                <Badge variant="danger">+{varPct.toFixed(1)}%</Badge>
                              ) : varPct < 0 ? (
                                <Badge variant="warning">{varPct.toFixed(1)}%</Badge>
                              ) : (
                                <Badge variant="success">0.0%</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                      <tr>
                        <td colSpan="6" className="py-2.5 px-3 text-slate-900 uppercase text-[11px]">
                          Total Material Cost (Raw + Packaging):
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-900 text-sm">
                          ₹{totalMaterialCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* TAB 2: BATCH COMPARISON */}
      {activeTab === 'comparison' && (
        <Card title="Production Runs Batch Manufacturing Cost Comparison">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Run #</th>
                  <th className="py-3 px-4">Product Name</th>
                  <th className="py-3 px-4">Run Date</th>
                  <th className="py-3 px-4 text-right">Good Output (Pkts)</th>
                  <th className="py-3 px-4 text-right">Raw Materials (₹)</th>
                  <th className="py-3 px-4 text-right">Packaging (₹)</th>
                  <th className="py-3 px-4 text-right">Overheads (₹)</th>
                  <th className="py-3 px-4 text-right">Gross Total Cost (₹)</th>
                  <th className="py-3 px-4 text-right">Cost / Packet (₹)</th>
                  <th className="py-3 px-4 text-right">Gross Margin</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summaryList.map((row) => (
                  <tr key={row.production_run_id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-blue-600">{row.run_number}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{row.finished_good_name}</td>
                    <td className="py-3 px-4 text-slate-500">{row.run_date ? String(row.run_date).split('T')[0] : '—'}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                      {parseFloat(row.actual_good_output_qty || (row.planned_batch_count * row.standard_batch_size) || 0).toFixed(0)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      ₹{parseFloat(row.total_raw_material_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      ₹{parseFloat(row.total_packaging_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-blue-700">
                      ₹{parseFloat(row.total_direct_overhead_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                      ₹{parseFloat(row.gross_total_batch_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 text-sm">
                      ₹{parseFloat(row.cost_per_packet || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">
                      {parseFloat(row.gross_margin_pct || 0).toFixed(1)}%
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedRunId(row.production_run_id);
                          loadRunCosting(row.production_run_id);
                          setActiveTab('run-costing');
                        }}
                      >
                        Inspect & Add Expenses
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};
