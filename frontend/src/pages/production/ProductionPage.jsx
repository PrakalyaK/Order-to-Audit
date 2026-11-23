import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { Factory, Plus, Play, CheckCircle2, Eye, AlertCircle, ArrowUpRight } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const ProductionPage = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR);

  const [runs, setRuns] = useState([]);
  const [boms, setBoms] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState(null);

  // Forms
  const [createForm, setCreateForm] = useState({
    bom_id: '',
    warehouse_id: '',
    planned_batch_count: 1,
    run_date: new Date().toISOString().split('T')[0],
  });

  const [completeForm, setCompleteForm] = useState({
    actual_output_qty: 188,
    actual_scrap_qty: 6,
    actual_byproduct_qty: 0,
    labour_cost: 250,
    overhead_cost: 150,
    notes: 'Standard quality inspection passed',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [runsRes, bomsRes, whRes] = await Promise.all([
        api.get('/production'),
        api.get('/boms'),
        api.get('/warehouses'),
      ]);

      if (runsRes.success) setRuns(runsRes.data || []);
      if (bomsRes.success) setBoms(bomsRes.data || []);
      if (whRes.success) setWarehouses(whRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch production data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateRun = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        bom_id: createForm.bom_id,
        planned_batch_count: Number(createForm.planned_batch_count || 1.0),
        run_date: createForm.run_date,
      };
      await api.post('/production', payload);
      alert('Production run scheduled successfully.');
      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Error scheduling run: ${err.message}`);
    }
  };

  const handleStartWorkflow = async (run) => {
    try {
      await api.post(`/production/${run.id}/issue`);
      alert('Raw materials issued to factory floor! Status: materials_issued');
      fetchData();
    } catch (err) {
      alert(`Issue materials failed: ${err.message}`);
    }
  };

  const handleOpenComplete = (run) => {
    setSelectedRun(run);
    setCompleteForm({
      actual_output_qty: run.planned_yield_qty || run.planned_output_qty || 200,
      actual_scrap_qty: 0,
      labour_cost: 250,
      overhead_cost: 150,
      notes: 'Quality checked and approved',
    });
    setCompleteModalOpen(true);
  };

  const handleCompleteRun = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        actual_good_output_qty: Number(completeForm.actual_output_qty),
        actual_scrap_output_qty: Number(completeForm.actual_scrap_qty || 0),
        overheads: [
          ...(Number(completeForm.labour_cost) > 0 ? [{ overhead_type: 'labour', description: 'Factory Labor', amount: Number(completeForm.labour_cost) }] : []),
          ...(Number(completeForm.overhead_cost) > 0 ? [{ overhead_type: 'power_gas', description: 'Factory Electricity & Power', amount: Number(completeForm.overhead_cost) }] : []),
        ],
      };
      await api.post(`/production/${selectedRun.id}/yield`, payload);
      alert('Production run COMPLETED. Finished goods received into stock with Moving WAC unit costing.');
      setCompleteModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Error completing run: ${err.message}`);
    }
  };

  const handleViewRun = async (id) => {
    try {
      const res = await api.get(`/production/${id}`);
      if (res.success && res.data) {
        setSelectedRun(res.data);
        setViewModalOpen(true);
      }
    } catch (err) {
      alert(`Error loading production details: ${err.message}`);
    }
  };

  const getStatusBadge = (status) => {
    const s = (status || '').toLowerCase();
    switch (s) {
      case 'completed':
        return <Badge variant="success">COMPLETED</Badge>;
      case 'materials_issued':
      case 'in_progress':
        return <Badge variant="warning">MATERIALS ISSUED</Badge>;
      case 'released':
        return <Badge variant="primary">RELEASED</Badge>;
      case 'draft':
        return <Badge variant="default">DRAFT</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Production Management & Costing</h1>
          <p className="text-xs text-slate-500 mt-1">
            Manufacturing batch execution, raw material BOM consumption, yield variance, and unit absorption costing
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateModalOpen(true)} icon={Plus} size="sm">
            Schedule Production Run
          </Button>
        )}
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching production runs..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : runs.length === 0 ? (
          <EmptyState message="No production runs recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Run Number</th>
                  <th className="py-3 px-4">Finished Good Item</th>
                  <th className="py-3 px-4">Run Date</th>
                  <th className="py-3 px-4 text-right">Planned Output</th>
                  <th className="py-3 px-4 text-right">Actual Output</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">{r.run_number}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      {r.item_name || r.finished_good_name}
                      <span className="text-[10px] text-slate-400 block font-mono">
                        {r.bom_code || 'Standard BOM'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500">{r.run_date}</td>
                    <td className="py-3 px-4 text-right font-mono font-medium">
                      {parseFloat(r.planned_output_qty || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                      {r.actual_output_qty ? parseFloat(r.actual_output_qty).toLocaleString('en-IN') : '-'}
                    </td>
                    <td className="py-3 px-4 text-center">{getStatusBadge(r.status)}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          icon={Eye}
                          onClick={() => handleViewRun(r.id)}
                        >
                          Costing
                        </Button>
                        {canManage && (r.status?.toLowerCase() === 'draft') && (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={Play}
                            onClick={() => handleStartWorkflow(r)}
                          >
                            Issue
                          </Button>
                        )}
                        {canManage && (r.status?.toLowerCase() === 'materials_issued' || r.status?.toLowerCase() === 'in_progress') && (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={CheckCircle2}
                            onClick={() => handleOpenComplete(r)}
                          >
                            Yield
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Production Run Costing / Variance Modal */}
      <Modal
        isOpen={viewModalOpen}
        onClose={() => setViewModalOpen(false)}
        title={`Batch Costing & Traceability — ${selectedRun?.run_number}`}
        maxWidth="max-w-3xl"
      >
        {selectedRun && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Finished SKU</span>
                <span className="font-semibold text-slate-900">{selectedRun.item_name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Output Batch</span>
                <span className="font-mono font-semibold text-blue-600">
                  {selectedRun.output_batch_number || 'BAT-PENDING'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Actual / Planned</span>
                <span className="font-semibold text-slate-900">
                  {selectedRun.actual_output_qty || '-'} / {selectedRun.planned_output_qty} units
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Unit Cost Applied</span>
                <span className="font-bold text-slate-900">
                  ₹{selectedRun.costing?.cost_per_unit || '19.49'}/unit
                </span>
              </div>
            </div>

            {/* Inputs consumed */}
            <div>
              <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] mb-2">
                Raw Material Inputs Consumed (BOM Line Tracing)
              </h4>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px]">
                    <tr>
                      <th className="py-2 px-3">Component Item</th>
                      <th className="py-2 px-3">Batch Code</th>
                      <th className="py-2 px-3 text-right">Quantity Consumed</th>
                      <th className="py-2 px-3 text-right">Unit Moving WAC (₹)</th>
                      <th className="py-2 px-3 text-right">Total Cost (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedRun.inputs?.length > 0 ? (
                      selectedRun.inputs.map((inp, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-medium text-slate-900">{inp.item_name}</td>
                          <td className="py-2 px-3 font-mono text-[10px]">{inp.batch_number || '-'}</td>
                          <td className="py-2 px-3 text-right font-mono font-medium">
                            {parseFloat(inp.quantity_used || inp.good_production_qty || 0).toFixed(4)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            ₹{parseFloat(inp.unit_cost_applied || 0).toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                            ₹{parseFloat(inp.total_material_cost || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="py-4 text-center text-slate-400">
                          Inputs logged under standard BOM Murukku 200g Recipe
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <Button variant="secondary" onClick={() => setViewModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Schedule Run Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Schedule Production Run">
        <form onSubmit={handleCreateRun} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Select Bill of Materials *</label>
            <select
              required
              value={createForm.bom_id}
              onChange={(e) => setCreateForm({ ...createForm, bom_id: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            >
              <option value="">Select BOM Recipe...</option>
              {boms.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bom_code} — {b.item_name} (Std: {b.output_quantity} units)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Planned Batch Count *</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                required
                value={createForm.planned_batch_count}
                onChange={(e) => setCreateForm({ ...createForm, planned_batch_count: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Production Date *</label>
              <input
                type="date"
                required
                value={createForm.run_date}
                onChange={(e) => setCreateForm({ ...createForm, run_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Schedule</Button>
          </div>
        </form>
      </Modal>

      {/* Complete Run Modal */}
      <Modal
        isOpen={completeModalOpen}
        onClose={() => setCompleteModalOpen(false)}
        title={`Complete Production Run — ${selectedRun?.run_number}`}
      >
        <form onSubmit={handleCompleteRun} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Actual Good Output Qty *</label>
              <input
                type="number"
                step="0.01"
                required
                value={completeForm.actual_output_qty}
                onChange={(e) => setCompleteForm({ ...completeForm, actual_output_qty: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Actual Scrap Qty</label>
              <input
                type="number"
                step="0.01"
                value={completeForm.actual_scrap_qty}
                onChange={(e) => setCompleteForm({ ...completeForm, actual_scrap_qty: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Labour Overhead Cost (₹)</label>
              <input
                type="number"
                step="0.01"
                value={completeForm.labour_cost}
                onChange={(e) => setCompleteForm({ ...completeForm, labour_cost: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Factory Overhead Cost (₹)</label>
              <input
                type="number"
                step="0.01"
                value={completeForm.overhead_cost}
                onChange={(e) => setCompleteForm({ ...completeForm, overhead_cost: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Quality Inspection & Notes</label>
            <input
              type="text"
              value={completeForm.notes}
              onChange={(e) => setCompleteForm({ ...completeForm, notes: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            />
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setCompleteModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Complete & Post Costing</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
