import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../api/client';
import { Card, StatCard, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import {
  Factory,
  Plus,
  Play,
  CheckCircle2,
  Eye,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Boxes,
  Calendar,
  Clock,
  Coins,
  DollarSign,
  FileSpreadsheet,
  FileText,
  Filter,
  IndianRupee,
  Layers,
  Package,
  PackageCheck,
  Scale,
  Search,
  Sparkles,
  TrendingUp,
  User,
  Wrench,
  Zap
} from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const ProductionPage = () => {
  const { hasRole } = useAuth();
  const location = useLocation();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR);

  // Core Data
  const [runs, setRuns] = useState([]);
  const [boms, setBoms] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filtering & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'draft' | 'materials_issued' | 'completed'

  // Workflow View Mode
  // If activeRunId is set, we render the dedicated 6-stage Production Order Workflow screen!
  const [activeRunId, setActiveRunId] = useState(null);
  const [activeRunDetails, setActiveRunDetails] = useState(null);
  const [activeRequirements, setActiveRequirements] = useState(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [requirementsChecking, setRequirementsChecking] = useState(false);
  const [scheduleRequirements, setScheduleRequirements] = useState(null);

  // Schedule New Run Form
  const [createForm, setCreateForm] = useState({
    bom_id: '',
    warehouse_id: '',
    planned_batch_count: 1,
    run_date: new Date().toISOString().split('T')[0],
    output_batch_number: '',
    notes: '',
  });

  // Yield & Execution Form for Stage 4
  const [executionForm, setExecutionForm] = useState({
    actual_good_output_qty: 200,
    actual_scrap_output_qty: 0,
    labour_cost: 1200,
    power_cost: 600,
    output_batch_number: '',
    notes: 'Quality inspected and approved for retail distribution',
  });
  const [executingYield, setExecutingYield] = useState(false);

  const getProductImage = (run) => {
    if (run?.finished_good_image_url) return run.finished_good_image_url;
    const name = (run?.finished_good_name || run?.item_name || '').toLowerCase();
    if (name.includes('potato') && name.includes('masala')) return '/products/masala-chips.jpg';
    if (name.includes('potato')) return '/products/potato-chips.jpg';
    if (name.includes('banana')) return '/products/banana-chips.jpg';
    if (name.includes('mixture')) return '/products/mixture.jpg';
    if (name.includes('ribbon')) return '/products/ribbon-pakoda.jpg';
    if (name.includes('thattai')) return '/products/thattai.jpg';
    if (name.includes('boondi')) return '/products/kara-boondi.jpg';
    if (name.includes('tapioca')) return '/products/tapioca-chips.jpg';
    if (name.includes('seedai')) return '/products/seedai.jpg';
    if (name.includes('murukku')) return '/products/murukku.jpg';
    return '/hero.png';
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [runsRes, bomsRes, whRes] = await Promise.allSettled([
        api.get('/production'),
        api.get('/boms'),
        api.get('/warehouses'),
      ]);

      if (runsRes.status === 'fulfilled' && runsRes.value?.success) {
        const raw = runsRes.value.data?.data ?? runsRes.value.data;
        setRuns(Array.isArray(raw) ? raw : []);
      } else {
        setRuns([]);
      }

      if (bomsRes.status === 'fulfilled' && bomsRes.value?.success) {
        const raw = bomsRes.value.data?.boms ?? bomsRes.value.data;
        setBoms(Array.isArray(raw) ? raw : []);
      } else {
        setBoms([]);
      }

      if (whRes.status === 'fulfilled' && whRes.value?.success) {
        const raw = whRes.value.data?.warehouses ?? whRes.value.data;
        setWarehouses(Array.isArray(raw) ? raw : []);
      } else {
        setWarehouses([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch production data');
      setRuns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Check if directed from BOMs page with pre-selected BOM
  useEffect(() => {
    if (location.state?.selectedBomId && boms.length > 0) {
      handleOpenCreateModal(location.state.selectedBomId);
    }
  }, [location.state, boms]);

  // Load detailed order workflow when activeRunId changes
  const loadOrderWorkflow = async (runId) => {
    try {
      setWorkflowLoading(true);
      setActiveRunId(runId);
      const res = await api.get(`/production/${runId}`);
      if (res.success && res.data) {
        const run = res.data;
        setActiveRunDetails(run);

        // Pre-fill yield form
        setExecutionForm({
          actual_good_output_qty: parseFloat(run.planned_yield_qty || 200),
          actual_scrap_output_qty: 0,
          labour_cost: 1200,
          power_cost: 600,
          output_batch_number: run.output_batch_number || '',
          notes: 'Standard quality parameters verified',
        });

        // If draft, also fetch live material requirements check
        if (run.status === 'draft') {
          try {
            const reqRes = await api.post(`/boms/${run.bom_id}/calculate-requirements`, {
              requested_output_qty: parseFloat(run.planned_yield_qty),
              output_uom_id: run.finished_good_uom || 'PKT',
            });
            if (reqRes.success && reqRes.data) {
              setActiveRequirements(reqRes.data);
            }
          } catch {
            setActiveRequirements(null);
          }
        } else {
          setActiveRequirements(null);
        }
      }
    } catch (err) {
      alert(`Error loading production workflow details: ${err.message}`);
    } finally {
      setWorkflowLoading(false);
    }
  };

  const handleOpenCreateModal = async (initialBomId = '') => {
    const defaultBom = initialBomId
      ? boms.find((b) => b.id === initialBomId)
      : boms.find((b) => b.is_active) || boms[0];

    const todayStr = new Date().toISOString().split('T')[0];
    const initialBomVal = defaultBom ? defaultBom.id : '';

    setCreateForm({
      bom_id: initialBomVal,
      warehouse_id: warehouses[0]?.id || '',
      planned_batch_count: 1,
      run_date: todayStr,
      output_batch_number: defaultBom
        ? `BAT-${(defaultBom.finished_good_sku || 'FG').replace(/[^A-Za-z0-9]/g, '')}-${todayStr.replace(/-/g, '')}-01`
        : '',
      notes: '',
    });

    if (defaultBom) {
      checkRequirementsForSchedule(defaultBom.id, 1, defaultBom);
    }

    setCreateModalOpen(true);
  };

  const checkRequirementsForSchedule = async (bomId, batchCount, bomObj = null) => {
    const targetBom = bomObj || boms.find((b) => b.id === bomId);
    if (!targetBom) return;
    try {
      setRequirementsChecking(true);
      const stdBatch = parseFloat(targetBom.standard_batch_size || targetBom.output_quantity || 200);
      const reqOutput = Math.round(stdBatch * parseFloat(batchCount || 1));
      const res = await api.post(`/boms/${bomId}/calculate-requirements`, {
        requested_output_qty: reqOutput,
        output_uom_id: targetBom.batch_uom_id || targetBom.output_uom_name || 'PKT',
      });
      if (res.success && res.data) {
        setScheduleRequirements(res.data);
      }
    } catch (err) {
      console.warn('Failed to calculate schedule requirements:', err);
      setScheduleRequirements(null);
    } finally {
      setRequirementsChecking(false);
    }
  };

  const handleBomChangeInSchedule = (bomId) => {
    const selectedBom = boms.find((b) => b.id === bomId);
    const todayStr = createForm.run_date || new Date().toISOString().split('T')[0];
    const newBatchNo = selectedBom
      ? `BAT-${(selectedBom.finished_good_sku || 'FG').replace(/[^A-Za-z0-9]/g, '')}-${todayStr.replace(/-/g, '')}-01`
      : '';

    setCreateForm((prev) => ({
      ...prev,
      bom_id: bomId,
      output_batch_number: newBatchNo,
    }));

    if (selectedBom) {
      checkRequirementsForSchedule(bomId, createForm.planned_batch_count, selectedBom);
    }
  };

  const handleBatchCountChange = (count) => {
    setCreateForm((prev) => ({ ...prev, planned_batch_count: count }));
    if (createForm.bom_id) {
      checkRequirementsForSchedule(createForm.bom_id, count);
    }
  };

  const handleCreateRun = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        bom_id: createForm.bom_id,
        planned_batch_count: Number(createForm.planned_batch_count || 1.0),
        run_date: createForm.run_date,
        output_batch_number: createForm.output_batch_number.trim() || undefined,
        notes: createForm.notes,
      };
      const res = await api.post('/production', payload);
      alert('Production run scheduled successfully (Status: DRAFT). Opening Workflow...');
      setCreateModalOpen(false);
      await fetchData();

      // Open new run workflow directly
      if (res.data?.id) {
        loadOrderWorkflow(res.data.id);
      }
    } catch (err) {
      alert(`Error scheduling run: ${err.message}`);
    }
  };

  // Stage 3: Issue Materials
  const handleIssueMaterials = async (runId) => {
    if (!window.confirm('Confirm raw material issue? This will deduct materials from Store Inventory at Moving Weighted Average Cost.')) {
      return;
    }
    try {
      await api.post(`/production/${runId}/issue`);
      alert('Materials successfully issued to factory floor! Status updated to: MATERIALS_ISSUED');
      await fetchData();
      await loadOrderWorkflow(runId);
    } catch (err) {
      alert(`Issue materials failed: ${err.message}`);
    }
  };

  // Stage 4-5: Record Yield & Overheads
  const handleRecordYield = async (e) => {
    e.preventDefault();
    if (!activeRunDetails) return;
    try {
      setExecutingYield(true);
      const payload = {
        actual_good_output_qty: Number(executionForm.actual_good_output_qty),
        actual_scrap_output_qty: Number(executionForm.actual_scrap_output_qty || 0),
        overheads: [
          ...(Number(executionForm.labour_cost) > 0
            ? [
                {
                  overhead_type: 'labour',
                  description: 'Factory Direct Labour',
                  amount: Number(executionForm.labour_cost),
                },
              ]
            : []),
          ...(Number(executionForm.power_cost) > 0
            ? [
                {
                  overhead_type: 'power_gas',
                  description: 'Factory Power & Fuel',
                  amount: Number(executionForm.power_cost),
                },
              ]
            : []),
        ],
      };

      await api.post(`/production/${activeRunDetails.id}/yield`, payload);
      alert(
        'Production completed successfully!\n- Finished Goods stock received into Inventory Ledger.\n- Unit Moving WAC calculated.\n- Costing and mass balance variances posted.'
      );
      await fetchData();
      await loadOrderWorkflow(activeRunDetails.id);
    } catch (err) {
      alert(`Failed to complete production run: ${err.message}`);
    } finally {
      setExecutingYield(false);
    }
  };

  // Filtered runs for dashboard
  const filteredRuns = runs.filter((r) => {
    const q = search.toLowerCase();
    const runNo = (r.run_number || '').toLowerCase();
    const itemName = (r.finished_good_name || r.item_name || '').toLowerCase();
    const sku = (r.finished_good_sku || '').toLowerCase();
    const batch = (r.output_batch_number || '').toLowerCase();
    const matchesSearch = !q || runNo.includes(q) || itemName.includes(q) || sku.includes(q) || batch.includes(q);

    const s = (r.status || '').toLowerCase();
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'draft'
        ? s === 'draft'
        : statusFilter === 'materials_issued'
        ? s === 'materials_issued' || s === 'in_progress'
        : statusFilter === 'completed'
        ? s === 'completed'
        : true;

    return matchesSearch && matchesStatus;
  });

  // KPI aggregates
  const totalRunsCount = runs.length;
  const inProgressCount = runs.filter(
    (r) => r.status?.toLowerCase() === 'draft' || r.status?.toLowerCase() === 'materials_issued'
  ).length;
  const completedCount = runs.filter((r) => r.status?.toLowerCase() === 'completed').length;
  const totalUnitsProduced = runs.reduce(
    (sum, r) => sum + (parseFloat(r.actual_good_output_qty || r.actual_output_qty || 0) || 0),
    0
  );

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

  // =========================================================================
  // RENDER DEDICATED 6-STAGE PRODUCTION ORDER WORKFLOW
  // =========================================================================
  if (activeRunId && activeRunDetails) {
    const run = activeRunDetails;
    const status = (run.status || '').toLowerCase();
    const isDraft = status === 'draft';
    const isIssued = status === 'materials_issued' || status === 'in_progress';
    const isCompleted = status === 'completed';

    // 6-stage tracker state
    const stages = [
      { id: 1, name: 'BOM Selected', state: 'done' },
      { id: 2, name: 'Material Requirements', state: isDraft ? 'in_progress' : 'done' },
      { id: 3, name: 'Materials Issued', state: isDraft ? 'pending' : 'done' },
      { id: 4, name: 'Production Execution', state: isDraft ? 'pending' : isIssued ? 'in_progress' : 'done' },
      { id: 5, name: 'Finished Goods Received', state: isCompleted ? 'done' : 'pending' },
      { id: 6, name: 'Costing & Variance', state: isCompleted ? 'done' : 'pending' },
    ];

    const plannedYield = parseFloat(run.planned_yield_qty || 0);
    const actualGood = parseFloat(run.actual_good_output_qty || 0);
    const actualScrap = parseFloat(run.actual_scrap_output_qty || 0);
    const yieldVarPct = parseFloat(run.yield_variance_pct || 0);
    const costing = run.costing;

    return (
      <div className="space-y-6">
        {/* Back Button & Run Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setActiveRunId(null);
                setActiveRunDetails(null);
              }}
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors flex items-center gap-1.5 text-xs font-semibold"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Orders</span>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {run.run_number}
                </span>
                <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                  {run.output_batch_number || 'BAT-PENDING'}
                </span>
                {getStatusBadge(run.status)}
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 mt-1">
                {run.finished_good_name || run.item_name}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Date: <strong>{run.run_date}</strong></span>
            <span>•</span>
            <span>Supervisor: <strong>{run.supervisor_name || run.supervisor_username || 'Floor Supervisor'}</strong></span>
          </div>
        </div>

        {/* 6-STAGE VISUAL PROGRESS TRACKER */}
        <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">
            6-Stage End-to-End Production Workflow Tracker
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {stages.map((stage) => {
              const isDone = stage.state === 'done';
              const isInProg = stage.state === 'in_progress';
              return (
                <div
                  key={stage.id}
                  className={`flex flex-col p-2.5 rounded-lg border transition-all ${
                    isDone
                      ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800'
                      : isInProg
                      ? 'bg-blue-50 border-blue-300 text-blue-800 ring-2 ring-blue-500/20'
                      : 'bg-slate-50 border-slate-200 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-mono font-bold">STAGE {stage.id}</span>
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : isInProg ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse" />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                    )}
                  </div>
                  <span className="text-xs font-semibold leading-tight line-clamp-1">
                    {stage.name}
                  </span>
                  <span className="text-[10px] opacity-75 mt-0.5">
                    {isDone ? 'Completed' : isInProg ? 'In Action' : 'Pending'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* WORKFLOW STAGES CONTENT */}
        {isDraft && (
          /* ========================================================================= */
          /* STAGE 1 & 2: DRAFT & MATERIAL REQUIREMENTS REVIEW                         */
          /* ========================================================================= */
          <div className="space-y-5">
            <Card title="Stage 1 & 2: Production Requirements & Live Stock Verification">
              <div className="space-y-4 text-xs">
                {/* Product info banner */}
                <div className="flex flex-col sm:flex-row items-center gap-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <img
                    src={getProductImage(run)}
                    alt=""
                    className="w-16 h-16 object-cover rounded-lg border border-slate-200"
                    onError={(e) => {
                      e.currentTarget.src = '/hero.png';
                    }}
                  />
                  <div className="flex-1 space-y-1">
                    <h3 className="font-bold text-slate-900 text-sm">
                      {run.finished_good_name || run.item_name}
                    </h3>
                    <p className="text-slate-500 font-mono text-[11px]">
                      SKU: {run.finished_good_sku} • BOM: {run.bom_code} (v{run.bom_version || 1}) • Standard Batch:{' '}
                      {run.standard_batch_size || 200} units
                    </p>
                    <p className="text-slate-700">
                      Planned Output:{' '}
                      <strong className="text-blue-700 font-mono text-sm">
                        {plannedYield.toLocaleString('en-IN')} Packets
                      </strong>{' '}
                      ({run.planned_batch_count || 1} batch)
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <Button
                      variant="primary"
                      icon={Play}
                      size="md"
                      onClick={() => handleIssueMaterials(run.id)}
                    >
                      Issue Materials to Factory Floor
                    </Button>
                    <span className="text-[10px] text-slate-400">
                      Deducts ingredients at live Moving WAC
                    </span>
                  </div>
                </div>

                {/* Material Requirements Preview Table */}
                <div>
                  <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] mb-2 flex items-center justify-between">
                    <span>Required Bill of Materials & Live Store Availability</span>
                    {activeRequirements && (
                      <Badge
                        variant={activeRequirements.all_materials_available ? 'success' : 'danger'}
                      >
                        {activeRequirements.all_materials_available
                          ? 'All Materials Available in Store'
                          : 'Material Shortage Warning'}
                      </Badge>
                    )}
                  </h4>

                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3">Item / Material</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3 text-right">Planned Req Qty</th>
                          <th className="py-2.5 px-3 text-right">Total Req (Inc Scrap)</th>
                          <th className="py-2.5 px-3">UOM</th>
                          <th className="py-2.5 px-3 text-right">Store Available</th>
                          <th className="py-2.5 px-3 text-center">Stock Feasibility</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeRequirements?.materials?.length > 0 ? (
                          activeRequirements.materials.map((mat, idx) => {
                            const isShortage = !mat.has_sufficient_stock;
                            return (
                              <tr key={idx} className="hover:bg-slate-50">
                                <td className="py-2.5 px-3 font-medium text-slate-900">
                                  {mat.item_name}
                                  <span className="text-[10px] text-slate-400 block font-mono">
                                    {mat.item_sku}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <Badge
                                    variant={mat.item_type === 'packaging' ? 'warning' : 'primary'}
                                  >
                                    {mat.item_type || 'raw_material'}
                                  </Badge>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-medium">
                                  {parseFloat(mat.planned_required_qty || 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                  {parseFloat(mat.total_required_qty || 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-slate-500">
                                  {mat.uom_id || 'KG'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono font-semibold">
                                  {parseFloat(mat.available_stock_qty || 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 px-3 text-center">
                                  {isShortage ? (
                                    <span className="inline-flex items-center gap-1 text-rose-600 font-bold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                                      <AlertTriangle className="w-3 h-3" /> Shortage (
                                      {parseFloat(mat.shortage_qty || 0).toFixed(2)})
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                      <CheckCircle2 className="w-3 h-3" /> In Stock
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : run.inputs?.length > 0 ? (
                          run.inputs.map((inp, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3 font-medium text-slate-900">
                                {inp.item_name}
                                <span className="text-[10px] text-slate-400 block font-mono">
                                  {inp.item_sku}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <Badge
                                  variant={inp.item_type === 'packaging' ? 'warning' : 'primary'}
                                >
                                  {inp.item_type || 'raw_material'}
                                </Badge>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-medium">
                                {parseFloat(inp.planned_qty || 0).toFixed(4)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                {parseFloat(inp.actual_issued_qty || inp.planned_qty || 0).toFixed(4)}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-500">
                                {inp.uom_id || 'KG'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-slate-400">—</td>
                              <td className="py-2.5 px-3 text-center">
                                <Badge variant="success">Standard Recipe</Badge>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="7" className="py-4 text-center text-slate-400">
                              Recipe lines loading...
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {isIssued && (
          /* ========================================================================= */
          /* STAGE 3 & 4: MATERIALS ISSUED & RECORD PRODUCTION YIELD                   */
          /* ========================================================================= */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Left 2 Cols: Form to record actual output & overheads */}
            <div className="lg:col-span-2 space-y-4">
              <Card title="Stage 4: Shop Floor Production Execution & Yield Recording">
                <form onSubmit={handleRecordYield} className="space-y-4 text-xs">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 flex items-start gap-2.5">
                    <Sparkles className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                      <strong className="font-semibold">Raw Materials Issued to Floor:</strong> Batch
                      processing underway. Record the actual good packets produced, damaged/scrap output,
                      and production overheads to complete this run.
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Actual Good Output Quantity (Packets) *
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        required
                        value={executionForm.actual_good_output_qty}
                        onChange={(e) =>
                          setExecutionForm({
                            ...executionForm,
                            actual_good_output_qty: e.target.value,
                          })
                        }
                        className="w-full border border-slate-300 rounded-lg p-2 font-mono text-base font-bold text-slate-900 bg-white"
                      />
                      <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Planned standard yield: {plannedYield} packets
                      </span>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Actual Damaged / Scrap Output (Packets)
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={executionForm.actual_scrap_output_qty}
                        onChange={(e) =>
                          setExecutionForm({
                            ...executionForm,
                            actual_scrap_output_qty: e.target.value,
                          })
                        }
                        className="w-full border border-slate-300 rounded-lg p-2 font-mono text-slate-800 bg-white"
                      />
                      <span className="text-[10px] text-slate-400 mt-0.5 block">
                        Factory floor rejects or defective packs
                      </span>
                    </div>
                  </div>

                  {/* Overheads breakdown */}
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
                    <h5 className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                      Direct Production Overheads Absorption
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-blue-600" />
                          <span>Direct Labour Overhead (₹)</span>
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          required
                          value={executionForm.labour_cost}
                          onChange={(e) =>
                            setExecutionForm({ ...executionForm, labour_cost: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                        />
                        <span className="text-[10px] text-slate-400">
                          Standard batch labor: ₹1,200.00
                        </span>
                      </div>

                      <div>
                        <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1">
                          <Zap className="w-3.5 h-3.5 text-amber-600" />
                          <span>Factory Power & Fuel Overhead (₹)</span>
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          required
                          value={executionForm.power_cost}
                          onChange={(e) =>
                            setExecutionForm({ ...executionForm, power_cost: e.target.value })
                          }
                          className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
                        />
                        <span className="text-[10px] text-slate-400">
                          Standard gas & electricity: ₹600.00
                        </span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Quality Control Notes & Inspection Observations
                    </label>
                    <input
                      type="text"
                      value={executionForm.notes}
                      onChange={(e) => setExecutionForm({ ...executionForm, notes: e.target.value })}
                      className="w-full border border-slate-300 rounded-lg p-2"
                    />
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      icon={CheckCircle2}
                      loading={executingYield}
                    >
                      Complete Production & Receive Finished Goods
                    </Button>
                  </div>
                </form>
              </Card>
            </div>

            {/* Right Col: Issued Materials Tracing */}
            <div>
              <Card title="Issued Materials (At Moving WAC)">
                <div className="space-y-3 text-xs">
                  <div className="divide-y divide-slate-100">
                    {(run.inputs || []).map((inp, idx) => (
                      <div key={idx} className="py-2 flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-slate-900 block">{inp.item_name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {inp.item_sku} • {inp.uom_id}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-slate-900 block">
                            {parseFloat(inp.actual_issued_qty || inp.planned_qty || 0).toFixed(2)}{' '}
                            {inp.uom_id}
                          </span>
                          <span className="text-[10px] text-blue-600 font-mono">
                            ₹{parseFloat(inp.total_material_cost || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {isCompleted && (
          /* ========================================================================= */
          /* STAGE 5 & 6: FINISHED GOODS RECEIPT, COSTING & VARIANCE ANALYSIS          */
          /* ========================================================================= */
          <div className="space-y-5">
            {/* Receipt Success Banner */}
            <div className="bg-emerald-500 text-white p-4 rounded-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-base">
                    Production Complete & Finished Goods Received into Inventory
                  </h3>
                  <p className="text-emerald-100 text-xs">
                    Batch <strong>{run.output_batch_number}</strong> ({actualGood.toLocaleString('en-IN')}{' '}
                    Packets) posted to Finished Goods Store via Moving Weighted Average Costing.
                  </p>
                </div>
              </div>

              <div className="bg-emerald-600/80 px-3 py-1.5 rounded-lg border border-emerald-400/30 text-right">
                <span className="text-[10px] uppercase font-bold text-emerald-200 block">
                  Absorption Cost
                </span>
                <span className="text-lg font-bold font-mono text-white">
                  ₹{parseFloat(costing?.cost_per_packet || 0).toFixed(2)} / pkt
                </span>
              </div>
            </div>

            {/* Financial Costing Summary Card */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 space-y-4">
                <Card title="Batch Costing Breakdown (Unit Absorption Model)">
                  <div className="space-y-4 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Raw Materials
                        </span>
                        <span className="text-base font-bold text-slate-900 font-mono">
                          ₹{parseFloat(costing?.total_raw_material_cost || 0).toFixed(2)}
                        </span>
                      </div>

                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Packaging
                        </span>
                        <span className="text-base font-bold text-slate-900 font-mono">
                          ₹{parseFloat(costing?.total_packaging_cost || 0).toFixed(2)}
                        </span>
                      </div>

                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Direct Labour
                        </span>
                        <span className="text-base font-bold text-blue-700 font-mono">
                          ₹
                          {parseFloat(
                            run.overheads?.find((o) => o.overhead_type === 'labour')?.amount || 1200
                          ).toFixed(2)}
                        </span>
                      </div>

                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Power & Fuel
                        </span>
                        <span className="text-base font-bold text-amber-700 font-mono">
                          ₹
                          {parseFloat(
                            run.overheads?.find((o) => o.overhead_type === 'power_gas')?.amount || 600
                          ).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Total Rollup Banner */}
                    <div className="p-4 bg-slate-900 text-white rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">
                          Total Batch Manufacturing Cost
                        </span>
                        <span className="text-2xl font-bold font-mono text-white">
                          ₹{parseFloat(costing?.gross_total_batch_cost || 0).toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">
                          Cost per Packet
                        </span>
                        <span className="text-2xl font-bold font-mono text-emerald-400">
                          ₹{parseFloat(costing?.cost_per_packet || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Margin analysis */}
                    <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 flex items-center justify-between text-emerald-900">
                      <div>
                        <span className="font-semibold block">Selling Price vs Manufacturing Cost:</span>
                        <span className="text-slate-600 text-[11px]">
                          Selling Price: ₹{parseFloat(costing?.selling_price_per_packet || 0).toFixed(2)} •
                          Unit Margin: ₹{parseFloat(costing?.unit_gross_margin || 0).toFixed(2)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold uppercase tracking-wider block">
                          Gross Margin
                        </span>
                        <span className="text-lg font-bold font-mono text-emerald-700">
                          {parseFloat(costing?.gross_margin_pct || 0).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Material Consumption Variance */}
                <Card title="Material Consumption & Mass Balance Variance">
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px]">
                        <tr>
                          <th className="py-2.5 px-3">Ingredient</th>
                          <th className="py-2.5 px-3 text-right">Standard Req</th>
                          <th className="py-2.5 px-3 text-right">Actual Consumed</th>
                          <th className="py-2.5 px-3 text-right">Unit Moving WAC</th>
                          <th className="py-2.5 px-3 text-right">Total Line Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(run.inputs || []).map((inp, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2 px-3 font-medium text-slate-900">
                              {inp.item_name}
                              <span className="text-[10px] text-slate-400 block font-mono">
                                {inp.item_sku}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono">
                              {parseFloat(inp.planned_qty || 0).toFixed(4)} {inp.uom_id}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                              {parseFloat(inp.actual_issued_qty || inp.good_production_qty || 0).toFixed(4)}{' '}
                              {inp.uom_id}
                            </td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              ₹{parseFloat(inp.unit_cost_applied || 0).toFixed(2)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-blue-700">
                              ₹{parseFloat(inp.total_material_cost || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              {/* Right Col: Output Variance Analysis */}
              <div className="space-y-4">
                <Card title="Output Yield Variance">
                  <div className="space-y-3 text-xs">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Planned Output:</span>
                        <span className="font-mono font-bold text-slate-900">{plannedYield} pkts</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Actual Good Output:</span>
                        <span className="font-mono font-bold text-emerald-700">{actualGood} pkts</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Scrap / Defective Output:</span>
                        <span className="font-mono font-bold text-rose-600">{actualScrap} pkts</span>
                      </div>
                      <div className="pt-2 border-t border-slate-200 flex justify-between items-center">
                        <span className="font-bold text-slate-700">Yield Variance:</span>
                        <span
                          className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                            Math.abs(yieldVarPct) <= (run.tolerance_variance_pct || 3.0)
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {yieldVarPct > 0 ? `+${yieldVarPct}%` : `${yieldVarPct}%`}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-900 text-[11px]">
                      <strong>Immutability Audit:</strong> Posted inventory ledger entries have been
                      permanently sealed. Cost per packet updated in moving average costing records.
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // RENDER MASTER PRODUCTION DASHBOARD & ORDERS LIST
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
              <Factory className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Production Management & Costing
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Manufacturing batch execution, raw material BOM consumption, yield variance, and unit absorption costing
              </p>
            </div>
          </div>
        </div>

        {canManage && (
          <Button onClick={() => handleOpenCreateModal()} icon={Plus} size="sm">
            Schedule Production Run
          </Button>
        )}
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Scheduled Runs"
          value={totalRunsCount}
          subtitle="All recorded production runs"
          icon={Boxes}
          color="blue"
        />
        <StatCard
          title="In Production"
          value={inProgressCount}
          subtitle="Draft or materials issued"
          icon={Clock}
          color="amber"
        />
        <StatCard
          title="Completed Runs"
          value={completedCount}
          subtitle="Yield & costing posted"
          icon={PackageCheck}
          color="green"
        />
        <StatCard
          title="Total Finished Output"
          value={`${totalUnitsProduced.toLocaleString('en-IN')} PKT`}
          subtitle="Received into store inventory"
          icon={Scale}
          color="purple"
        />
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by run number, product name, SKU, or batch..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-200">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-transparent border-none text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="all">All Run Statuses</option>
            <option value="draft">Draft (Scheduled)</option>
            <option value="materials_issued">Materials Issued (In Floor)</option>
            <option value="completed">Completed (Costing Posted)</option>
          </select>
        </div>
      </div>

      {/* Runs Table */}
      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching production runs..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : filteredRuns.length === 0 ? (
          <EmptyState
            message="No production runs recorded"
            action={
              canManage && (
                <Button onClick={() => handleOpenCreateModal()} icon={Plus} size="sm">
                  Schedule First Run
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Photo</th>
                  <th className="py-3 px-4">Run Number</th>
                  <th className="py-3 px-4">Finished Good Item</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4 text-right">Planned Output</th>
                  <th className="py-3 px-4 text-right">Actual Good Output</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRuns.map((r) => {
                  const s = (r.status || '').toLowerCase();
                  const isDraft = s === 'draft';
                  const isIssued = s === 'materials_issued' || s === 'in_progress';
                  const isCompleted = s === 'completed';

                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2 px-4">
                        <img
                          src={getProductImage(r)}
                          alt=""
                          className="w-10 h-10 object-cover rounded-lg border border-slate-200"
                          onError={(e) => {
                            e.currentTarget.src = '/hero.png';
                          }}
                        />
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                        {r.run_number}
                        <span className="text-[10px] text-slate-400 block font-mono">
                          {r.output_batch_number || 'BAT-PENDING'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {r.finished_good_name || r.item_name}
                        <span className="text-[10px] text-slate-400 block font-mono">
                          {r.bom_code || 'BOM'} (v{r.bom_version || 1})
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500">{r.run_date}</td>
                      <td className="py-3 px-4 text-right font-mono font-medium">
                        {parseFloat(r.planned_yield_qty || r.planned_output_qty || 0).toLocaleString(
                          'en-IN'
                        )}{' '}
                        <span className="text-slate-400 text-[10px]">PKT</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {r.actual_good_output_qty || r.actual_output_qty
                          ? `${parseFloat(
                              r.actual_good_output_qty || r.actual_output_qty
                            ).toLocaleString('en-IN')} PKT`
                          : '—'}
                      </td>
                      <td className="py-3 px-4 text-center">{getStatusBadge(r.status)}</td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            variant="primary"
                            size="sm"
                            icon={ArrowRight}
                            onClick={() => loadOrderWorkflow(r.id)}
                          >
                            Manage Workflow
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ========================================================================= */}
      {/* SCHEDULE PRODUCTION RUN MODAL                                             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Schedule Production Run"
        maxWidth="max-w-2xl"
      >
        <form onSubmit={handleCreateRun} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Select BOM Recipe *
            </label>
            <select
              required
              value={createForm.bom_id}
              onChange={(e) => handleBomChangeInSchedule(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 bg-white"
            >
              <option value="">Select Recipe...</option>
              {boms.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bom_code} — {b.finished_good_name || b.item_name} (Std:{' '}
                  {b.standard_batch_size || b.output_quantity} units)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Planned Batch Multiplier *
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="50"
                required
                value={createForm.planned_batch_count}
                onChange={(e) => handleBatchCountChange(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 font-mono"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Standard: 1 batch = 200 packets
              </span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Production Run Date *
              </label>
              <input
                type="date"
                required
                value={createForm.run_date}
                onChange={(e) => setCreateForm({ ...createForm, run_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Output Finished Goods Batch #
              </label>
              <input
                type="text"
                placeholder="BAT-FG-YYYYMMDD-01"
                value={createForm.output_batch_number}
                onChange={(e) =>
                  setCreateForm({ ...createForm, output_batch_number: e.target.value })
                }
                className="w-full border border-slate-300 rounded-lg p-2 font-mono uppercase"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Production Warehouse
              </label>
              <select
                value={createForm.warehouse_id}
                onChange={(e) => setCreateForm({ ...createForm, warehouse_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 bg-white"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Real-time Material Requirements Preview */}
          {createForm.bom_id && (
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-slate-800 uppercase tracking-wider text-[10px]">
                  Real-time Material Availability Check
                </span>
                {requirementsChecking ? (
                  <span className="text-[10px] text-slate-400">Checking stock...</span>
                ) : scheduleRequirements ? (
                  <Badge
                    variant={scheduleRequirements.all_materials_available ? 'success' : 'danger'}
                  >
                    {scheduleRequirements.all_materials_available
                      ? 'Stock Available'
                      : 'Shortage Detected'}
                  </Badge>
                ) : null}
              </div>

              {scheduleRequirements && (
                <div className="space-y-1">
                  {scheduleRequirements.materials?.slice(0, 4).map((m, idx) => (
                    <div key={idx} className="flex justify-between text-[11px]">
                      <span className="text-slate-600">
                        {m.item_name} ({parseFloat(m.total_required_qty).toFixed(2)} {m.uom_id}):
                      </span>
                      <span
                        className={
                          m.has_sufficient_stock
                            ? 'text-emerald-700 font-semibold'
                            : 'text-rose-600 font-bold'
                        }
                      >
                        {m.has_sufficient_stock
                          ? `In Stock (${parseFloat(m.available_stock_qty).toFixed(1)})`
                          : `Short (${parseFloat(m.shortage_qty).toFixed(1)})`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Production Notes</label>
            <input
              type="text"
              placeholder="e.g. Morning shift production run with nitrogen flush"
              value={createForm.notes}
              onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Schedule</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
