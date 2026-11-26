import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Card, StatCard, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import {
  FileSpreadsheet,
  Eye,
  Plus,
  Search,
  Filter,
  Grid,
  List,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
  Archive,
  Copy,
  Clock,
  Boxes,
  Scale,
  PackageCheck,
  Percent,
  IndianRupee,
  Factory
} from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const BomsPage = () => {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  // Core Data
  const [boms, setBoms] = useState(() => {
    const cached = api.getCached?.('/boms');
    const raw = cached?.data?.boms ?? cached?.data;
    return Array.isArray(raw) ? raw : [];
  });
  const [items, setItems] = useState(() => {
    const cached = api.getCached?.('/items');
    const raw = cached?.data?.items ?? cached?.data;
    return Array.isArray(raw) ? raw : [];
  });
  const [uoms, setUoms] = useState(() => {
    const cached = api.getCached?.('/units');
    const raw = cached?.data?.units ?? cached?.data;
    return Array.isArray(raw) ? raw : [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = api.getCached?.('/boms');
    const raw = cached?.data?.boms ?? cached?.data;
    return !Array.isArray(raw) || raw.length === 0;
  });
  const [error, setError] = useState('');

  // UI View Controls
  const [viewMode, setViewMode] = useState('catalogue'); // 'catalogue' | 'table'
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'archived'
  const [categoryFilter, setCategoryFilter] = useState('all'); // 'all' | '100g' | '200g'

  // Modals & Selection
  const [selectedBom, setSelectedBom] = useState(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Create / Clone BOM Form
  const [createForm, setCreateForm] = useState({
    finished_good_item_id: '',
    bom_code: '',
    version_number: 1,
    standard_batch_size: 200,
    batch_uom_id: 'PKT',
    tolerance_variance_pct: 3.0,
    effective_from: new Date().toISOString().split('T')[0],
    notes: '',
    materials: [
      { item_id: '', standard_qty: 1, uom_id: 'KG', scrap_allowance_pct: 0 }
    ],
  });

  const getProductImage = (bom) => {
    if (bom.finished_good_image_url) return bom.finished_good_image_url;
    const name = (bom.item_name || bom.finished_good_name || '').toLowerCase();
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
      if (boms.length === 0) setLoading(true);
      setError('');
      const [bomsRes, itemsRes, uomsRes] = await Promise.allSettled([
        api.get('/boms'),
        api.get('/items'),
        api.get('/units'),
      ]);

      if (bomsRes.status === 'fulfilled' && bomsRes.value?.success) {
        const raw = bomsRes.value.data?.boms ?? bomsRes.value.data;
        setBoms(Array.isArray(raw) ? raw : []);
      } else {
        setBoms([]);
      }

      if (itemsRes.status === 'fulfilled' && itemsRes.value?.success) {
        const raw = itemsRes.value.data?.items ?? itemsRes.value.data;
        setItems(Array.isArray(raw) ? raw : []);
      } else {
        setItems([]);
      }

      if (uomsRes.status === 'fulfilled' && uomsRes.value?.success) {
        const raw = uomsRes.value.data?.units ?? uomsRes.value.data;
        setUoms(Array.isArray(raw) ? raw : []);
      } else {
        setUoms([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch BOMs');
      setBoms([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleViewBom = async (id) => {
    try {
      const res = await api.get(`/boms/${id}`);
      if (res.success && res.data) {
        const raw = res.data?.bom ?? res.data;
        setSelectedBom(raw);
        setViewModalOpen(true);
      }
    } catch (err) {
      alert(`Failed to load BOM: ${err.message}`);
    }
  };

  const handleToggleStatus = async (bom, e) => {
    e?.stopPropagation();
    const actionName = bom.is_active ? 'archive' : 'activate';
    if (!window.confirm(`Are you sure you want to ${actionName} BOM "${bom.bom_code}"?`)) {
      return;
    }
    try {
      await api.patch(`/boms/${bom.id}/status`, { is_active: !bom.is_active });
      fetchData();
      if (selectedBom && selectedBom.id === bom.id) {
        setSelectedBom({ ...selectedBom, is_active: !bom.is_active });
      }
    } catch (err) {
      alert(`Failed to update BOM status: ${err.message}`);
    }
  };

  const handleOpenCreateNew = () => {
    setCreateForm({
      finished_good_item_id: '',
      bom_code: '',
      version_number: 1,
      standard_batch_size: 200,
      batch_uom_id: 'PKT',
      tolerance_variance_pct: 3.0,
      effective_from: new Date().toISOString().split('T')[0],
      notes: '',
      materials: [
        { item_id: '', standard_qty: 1, uom_id: 'KG', scrap_allowance_pct: 0 }
      ],
    });
    setCreateModalOpen(true);
  };

  const handleCloneAsNewVersion = async (bom, e) => {
    e?.stopPropagation();
    try {
      const res = await api.get(`/boms/${bom.id}`);
      const fullBom = res.data?.bom ?? res.data;
      const materials = (fullBom.materials || fullBom.items || []).map((m) => ({
        item_id: m.item_id,
        standard_qty: parseFloat(m.standard_qty || m.quantity_required || 1),
        uom_id: m.uom_id || 'KG',
        scrap_allowance_pct: parseFloat(m.scrap_allowance_pct || m.scrap_factor_pct || 0),
      }));

      setCreateForm({
        finished_good_item_id: fullBom.finished_good_item_id,
        bom_code: fullBom.bom_code,
        version_number: (fullBom.version_number || fullBom.version || 1) + 1,
        standard_batch_size: parseFloat(fullBom.standard_batch_size || fullBom.output_quantity || 200),
        batch_uom_id: fullBom.batch_uom_id || fullBom.output_uom_name || 'PKT',
        tolerance_variance_pct: parseFloat(fullBom.tolerance_variance_pct || 3.0),
        effective_from: new Date().toISOString().split('T')[0],
        notes: `New revision based on ${fullBom.bom_code} v${fullBom.version_number || 1}`,
        materials: materials.length > 0 ? materials : [{ item_id: '', standard_qty: 1, uom_id: 'KG', scrap_allowance_pct: 0 }],
      });
      setCreateModalOpen(true);
    } catch (err) {
      alert(`Failed to load recipe for version cloning: ${err.message}`);
    }
  };

  const handleAddMaterialRow = () => {
    setCreateForm((prev) => ({
      ...prev,
      materials: [
        ...prev.materials,
        { item_id: '', standard_qty: 1, uom_id: 'KG', scrap_allowance_pct: 0 }
      ],
    }));
  };

  const handleRemoveMaterialRow = (index) => {
    setCreateForm((prev) => ({
      ...prev,
      materials: prev.materials.filter((_, idx) => idx !== index),
    }));
  };

  const handleMaterialChange = (index, field, value) => {
    setCreateForm((prev) => {
      const updated = [...prev.materials];
      updated[index] = { ...updated[index], [field]: value };

      // Auto update UOM if item_id changed
      if (field === 'item_id') {
        const itemObj = items.find((i) => i.id === value);
        if (itemObj && itemObj.base_uom_id) {
          updated[index].uom_id = itemObj.base_uom_id;
        }
      }
      return { ...prev, materials: updated };
    });
  };

  const handleSelectFinishedGood = (itemId) => {
    const itemObj = items.find((i) => i.id === itemId);
    if (!itemObj) return;

    // Suggest clean BOM code: e.g. BOM-PTC-100G
    const codeSuffix = itemObj.sku.replace(/^FG-/, '');
    const suggestedBomCode = `BOM-${codeSuffix}`;

    setCreateForm((prev) => ({
      ...prev,
      finished_good_item_id: itemId,
      bom_code: prev.bom_code || suggestedBomCode,
      batch_uom_id: itemObj.base_uom_id || 'PKT',
    }));
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    try {
      if (!createForm.finished_good_item_id) {
        alert('Please select a finished product');
        return;
      }
      if (!createForm.materials || createForm.materials.length === 0) {
        alert('Please add at least one ingredient / packaging material');
        return;
      }

      // Check for empty item_id or invalid quantity
      for (const m of createForm.materials) {
        if (!m.item_id) {
          alert('Please select an item for all recipe rows');
          return;
        }
        if (Number(m.standard_qty) <= 0) {
          alert('Material standard quantity must be greater than zero');
          return;
        }
      }

      setSubmitting(true);
      const payload = {
        finished_good_item_id: createForm.finished_good_item_id,
        bom_code: createForm.bom_code.trim().toUpperCase(),
        version_number: Number(createForm.version_number || 1),
        standard_batch_size: Number(createForm.standard_batch_size || 200),
        batch_uom_id: createForm.batch_uom_id || 'PKT',
        tolerance_variance_pct: Number(createForm.tolerance_variance_pct || 3.0),
        effective_from: createForm.effective_from,
        notes: createForm.notes,
        materials: createForm.materials.map((m) => ({
          item_id: m.item_id,
          standard_qty: Number(m.standard_qty),
          uom_id: m.uom_id,
          scrap_allowance_pct: Number(m.scrap_allowance_pct || 0),
        })),
      };

      await api.post('/boms', payload);
      alert('BOM Recipe saved successfully.');
      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Error saving BOM: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered & Sorted List (Murukku is always listed first)
  const filteredBoms = boms
    .filter((b) => {
      const q = search.toLowerCase();
      const name = (b.finished_good_name || b.item_name || '').toLowerCase();
      const sku = (b.finished_good_sku || b.item_sku || '').toLowerCase();
      const code = (b.bom_code || '').toLowerCase();
      const matchesSearch = !q || name.includes(q) || sku.includes(q) || code.includes(q);

      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
          ? b.is_active === true
          : b.is_active === false;

      const matchesCategory =
        categoryFilter === 'all'
          ? true
          : categoryFilter === '100g'
          ? name.includes('100g') || sku.includes('100g')
          : categoryFilter === '200g'
          ? name.includes('200g') || sku.includes('200g')
          : true;

      return matchesSearch && matchesStatus && matchesCategory;
    })
    .sort((a, b) => {
      const aName = (a.finished_good_name || a.item_name || '').toLowerCase();
      const bName = (b.finished_good_name || b.item_name || '').toLowerCase();
      const isMurukkuA = a.bom_code === 'BOM-MRK-200G' || a.finished_good_sku === 'FG-MRK-200G' || aName.includes('murukku');
      const isMurukkuB = b.bom_code === 'BOM-MRK-200G' || b.finished_good_sku === 'FG-MRK-200G' || bName.includes('murukku');
      if (isMurukkuA && !isMurukkuB) return -1;
      if (!isMurukkuA && isMurukkuB) return 1;
      return 0;
    });

  // KPI Calculations
  const totalBoms = boms.length;
  const activeBoms = boms.filter((b) => b.is_active).length;
  const avgCostPerUnit =
    boms.length > 0
      ? (
          boms.reduce((acc, b) => acc + (parseFloat(b.estimated_cost_per_unit || 0) || 0), 0) /
          boms.length
        ).toFixed(2)
      : '0.00';

  const finishedGoodsItems = items.filter((i) => i.item_type === 'finished_good');
  const materialItems = items.filter((i) => i.item_type === 'raw_material' || i.item_type === 'packaging');

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg border border-blue-100">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Bill of Materials (BOM) & Recipes
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Standard manufacturing recipes, ingredient ratios, scrap allowances, and packaging specifications
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setViewMode('catalogue')}
              className={`p-1.5 rounded-md transition-all text-xs flex items-center gap-1.5 ${
                viewMode === 'catalogue'
                  ? 'bg-white text-blue-600 font-semibold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Catalogue Cards View"
            >
              <Grid className="w-4 h-4" />
              <span className="hidden sm:inline">Catalogue</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md transition-all text-xs flex items-center gap-1.5 ${
                viewMode === 'table'
                  ? 'bg-white text-blue-600 font-semibold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Tabular List View"
            >
              <List className="w-4 h-4" />
              <span className="hidden sm:inline">Table</span>
            </button>
          </div>

          {canManage && (
            <Button onClick={handleOpenCreateNew} icon={Plus} size="sm">
              Create New Recipe (BOM)
            </Button>
          )}
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Standard Recipes"
          value={totalBoms}
          subtitle="Configured in catalogue"
          icon={Boxes}
          color="blue"
        />
        <StatCard
          title="Active Manufacturing BOMs"
          value={activeBoms}
          subtitle="Ready for factory floor runs"
          icon={PackageCheck}
          color="green"
        />
        <StatCard
          title="Standard Batch Output"
          value="200 PKT"
          subtitle="Fixed standard batch volume"
          icon={Scale}
          color="purple"
        />
        <StatCard
          title="Avg Material Cost / Packet"
          value={`₹${avgCostPerUnit}`}
          subtitle="Raw materials & packaging WAC"
          icon={IndianRupee}
          color="amber"
        />
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search recipes by product name, SKU, or BOM code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-200">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent border-none text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="archived">Archived Only</option>
            </select>
          </div>

          {/* Pack size filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-200">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent border-none text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
            >
              <option value="all">All Pack Sizes</option>
              <option value="100g">100g Packs Only</option>
              <option value="200g">200g Packs Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Content Area: Catalogue Grid or Table */}
      {loading ? (
        <Card>
          <LoadingSpinner text="Loading product recipes and BOM master catalogue..." />
        </Card>
      ) : error ? (
        <Card>
          <div className="text-rose-600 text-xs p-6 text-center">{error}</div>
        </Card>
      ) : filteredBoms.length === 0 ? (
        <Card>
          <EmptyState
            message="No recipes match your filter criteria"
            action={
              canManage && (
                <Button onClick={handleOpenCreateNew} icon={Plus} size="sm">
                  Create First Recipe
                </Button>
              )
            }
          />
        </Card>
      ) : viewMode === 'catalogue' ? (
        /* ========================================================================= */
        /* VISUAL PRODUCT RECIPE CATALOGUE GRID                                      */
        /* ========================================================================= */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredBoms.map((bom) => {
            const productName = bom.finished_good_name || bom.item_name || 'Manufactured Item';
            const productSku = bom.finished_good_sku || bom.item_sku || 'FG-SKU';
            const versionNum = bom.version_number || bom.version || 1;
            const batchSize = parseFloat(bom.standard_batch_size || bom.output_quantity || 200);
            const batchUom = bom.batch_uom_id || bom.output_uom_name || 'PKT';
            const ingredientCount = bom.material_count || bom.materials_count || 0;
            const batchCost = parseFloat(bom.estimated_material_cost || 0);
            const unitCost = parseFloat(bom.estimated_cost_per_unit || (batchCost > 0 ? batchCost / batchSize : 0));
            const imgSrc = getProductImage(bom);

            return (
              <div
                key={bom.id}
                className="group bg-white rounded-xl border border-slate-200/90 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden"
              >
                {/* Product Photograph Header */}
                <div className="relative h-44 w-full bg-slate-100 overflow-hidden">
                  <img
                    src={imgSrc}
                    alt={productName}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => {
                      e.currentTarget.src = '/hero.png';
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-black/20" />

                  {/* Badges on Image */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    <span className="bg-slate-900/80 backdrop-blur-md text-white px-2 py-0.5 rounded-md text-[10px] font-mono font-bold tracking-wide border border-white/20">
                      v{versionNum}
                    </span>
                    <span className="bg-blue-600/90 backdrop-blur-md text-white px-2 py-0.5 rounded-md text-[10px] font-mono font-medium border border-blue-400/30">
                      {bom.bom_code}
                    </span>
                  </div>

                  <div className="absolute top-2.5 right-2.5">
                    <Badge variant={bom.is_active ? 'success' : 'default'}>
                      {bom.is_active ? 'Active' : 'Archived'}
                    </Badge>
                  </div>

                  {/* Overlay text on image */}
                  <div className="absolute bottom-2.5 left-2.5 right-2.5 text-white">
                    <span className="text-[10px] font-mono tracking-wider uppercase text-slate-200 block drop-shadow-sm">
                      {productSku}
                    </span>
                    <h3 className="font-bold text-sm text-white drop-shadow-sm line-clamp-1">
                      {productName}
                    </h3>
                  </div>
                </div>

                {/* Card Body & Metrics */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3.5">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                        Batch Yield
                      </span>
                      <span className="font-bold text-slate-900 font-mono">
                        {batchSize.toLocaleString('en-IN')}{' '}
                        <span className="text-[11px] font-normal text-slate-500">{batchUom}</span>
                      </span>
                    </div>

                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                        Ingredients
                      </span>
                      <span className="font-bold text-slate-900 font-mono">
                        {ingredientCount}{' '}
                        <span className="text-[11px] font-normal text-slate-500">items</span>
                      </span>
                    </div>

                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                        Batch Cost
                      </span>
                      <span className="font-bold text-blue-700 font-mono">
                        ₹{batchCost > 0 ? batchCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </span>
                    </div>

                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                        Cost / Packet
                      </span>
                      <span className="font-bold text-emerald-700 font-mono">
                        ₹{unitCost > 0 ? unitCost.toFixed(2) : '—'}{' '}
                        <span className="text-[10px] font-normal text-slate-500">/pkt</span>
                      </span>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-2 border-t border-slate-100 flex items-center gap-1.5">
                    <Button
                      variant="primary"
                      size="sm"
                      icon={Eye}
                      onClick={() => handleViewBom(bom.id)}
                      className="flex-1 text-xs"
                    >
                      View Recipe
                    </Button>

                    {canManage && (
                      <>
                        <button
                          onClick={(e) => handleCloneAsNewVersion(bom, e)}
                          title="Create New Version from this Recipe"
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => handleToggleStatus(bom, e)}
                          title={bom.is_active ? 'Archive Recipe' : 'Activate Recipe'}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            bom.is_active
                              ? 'border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200'
                              : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                          }`}
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ========================================================================= */
        /* TABULAR LIST VIEW                                                         */
        /* ========================================================================= */
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Photo</th>
                  <th className="py-3 px-4">BOM Code</th>
                  <th className="py-3 px-4">Manufactured Item</th>
                  <th className="py-3 px-4 text-center">Version</th>
                  <th className="py-3 px-4 text-right">Standard Batch</th>
                  <th className="py-3 px-4 text-center">Components</th>
                  <th className="py-3 px-4 text-right">Batch Est. Cost</th>
                  <th className="py-3 px-4 text-right">Cost / Packet</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBoms.map((bom) => {
                  const batchCost = parseFloat(bom.estimated_material_cost || 0);
                  const batchSize = parseFloat(bom.standard_batch_size || bom.output_quantity || 200);
                  const unitCost = parseFloat(bom.estimated_cost_per_unit || (batchCost > 0 ? batchCost / batchSize : 0));

                  return (
                    <tr key={bom.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2 px-4">
                        <img
                          src={getProductImage(bom)}
                          alt=""
                          className="w-10 h-10 object-cover rounded-lg border border-slate-200"
                          onError={(e) => {
                            e.currentTarget.src = '/hero.png';
                          }}
                        />
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                        {bom.bom_code}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {bom.finished_good_name || bom.item_name}
                        <span className="text-[11px] text-slate-400 block font-mono">
                          {bom.finished_good_sku || bom.item_sku}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono">
                        v{bom.version_number || bom.version}
                      </td>
                      <td className="py-3 px-4 text-right font-medium font-mono">
                        {batchSize.toLocaleString('en-IN')}{' '}
                        <span className="text-slate-400 text-[10px]">{bom.batch_uom_id || 'PKT'}</span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-medium">
                        {bom.material_count || bom.materials_count || 0}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900">
                        ₹{batchCost.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                        ₹{unitCost.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant={bom.is_active ? 'success' : 'default'}>
                          {bom.is_active ? 'Active' : 'Archived'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            icon={Eye}
                            onClick={() => handleViewBom(bom.id)}
                          >
                            Inspect
                          </Button>
                          {canManage && (
                            <button
                              onClick={(e) => handleCloneAsNewVersion(bom, e)}
                              title="Create Version"
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-blue-50"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ========================================================================= */}
      {/* RECIPE DETAILS & INGREDIENT INSPECTION MODAL                              */}
      {/* ========================================================================= */}
      <Modal
        isOpen={viewModalOpen}
        onClose={() => setViewModalOpen(false)}
        title={`Recipe Specification — ${selectedBom?.bom_code} (v${selectedBom?.version_number || selectedBom?.version})`}
        maxWidth="max-w-4xl"
      >
        {selectedBom && (
          <div className="space-y-5 text-xs">
            {/* Header Banner */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
              <img
                src={getProductImage(selectedBom)}
                alt=""
                className="w-20 h-20 object-cover rounded-xl border border-slate-200 shadow-sm"
                onError={(e) => {
                  e.currentTarget.src = '/hero.png';
                }}
              />
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {selectedBom.bom_code}
                  </span>
                  <span className="font-mono text-xs font-bold bg-slate-200 px-2 py-0.5 rounded text-slate-800">
                    v{selectedBom.version_number || selectedBom.version}
                  </span>
                  <Badge variant={selectedBom.is_active ? 'success' : 'default'}>
                    {selectedBom.is_active ? 'Active Standard' : 'Archived'}
                  </Badge>
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedBom.finished_good_name || selectedBom.item_name}
                </h3>
                <p className="text-slate-500 font-mono text-[11px]">
                  SKU: {selectedBom.finished_good_sku || selectedBom.item_sku} • Standard Batch Output:{' '}
                  <strong className="text-slate-800">
                    {selectedBom.standard_batch_size || selectedBom.output_quantity || 200}{' '}
                    {selectedBom.batch_uom_id || 'PKT'}
                  </strong>
                </p>
              </div>

              {/* Recipe Cost Summary */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 text-right min-w-[140px]">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  Est. Batch Material Cost
                </span>
                <span className="text-base font-bold text-blue-700 font-mono block">
                  ₹{parseFloat(selectedBom.estimated_material_cost || 0).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-[11px] text-emerald-700 font-semibold font-mono">
                  ₹{parseFloat(selectedBom.estimated_cost_per_unit || 0).toFixed(2)} / packet
                </span>
              </div>
            </div>

            {/* Structured Recipe Components Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                  Configured BOM Ingredients & Packaging Materials
                </h4>
                <span className="text-slate-400 text-[11px]">
                  {(selectedBom.materials || selectedBom.items || []).length} items
                </span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Ingredient / Material</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3 text-right">Standard Qty</th>
                      <th className="py-2.5 px-3">UOM</th>
                      <th className="py-2.5 px-3 text-right">Scrap %</th>
                      <th className="py-2.5 px-3 text-right">Unit WAC Rate</th>
                      <th className="py-2.5 px-3 text-right">Line Est. Cost</th>
                      <th className="py-2.5 px-3 text-center">Available Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(selectedBom.materials || selectedBom.items || []).map((mat, idx) => {
                      const stdQty = parseFloat(mat.standard_qty || mat.quantity_required || 0);
                      const scrapPct = parseFloat(mat.scrap_allowance_pct || mat.scrap_factor_pct || 0);
                      const unitCost = parseFloat(mat.unit_cost || mat.unit_moving_wac || 0);
                      const lineCost = parseFloat(
                        mat.line_estimated_cost || stdQty * (1 + scrapPct / 100) * unitCost
                      );
                      const stockQty = parseFloat(mat.available_stock_qty || 0);
                      const isShortage = stockQty < stdQty;

                      return (
                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {mat.item_name || mat.name || '—'}
                            <span className="text-[10px] text-slate-400 block font-mono">
                              {mat.item_sku || mat.sku || ''}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <Badge
                              variant={mat.item_type === 'packaging' ? 'warning' : 'primary'}
                            >
                              {mat.item_type || 'raw_material'}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                            {stdQty.toFixed(4)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-500">
                            {mat.uom_id || mat.uom_name || 'KG'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                            {scrapPct > 0 ? `${scrapPct}%` : '0%'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            ₹{unitCost.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-700">
                            ₹{lineCost.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] font-semibold border ${
                                isShortage
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }`}
                            >
                              {isShortage ? (
                                <AlertTriangle className="w-3 h-3 text-rose-500" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              )}
                              {stockQty.toLocaleString('en-IN', { maximumFractionDigits: 2 })}{' '}
                              {mat.uom_id || 'KG'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <div className="text-[11px] text-slate-500">
                Effective from: <strong>{selectedBom.effective_from || 'Active'}</strong> • Tolerance:{' '}
                <strong>±{selectedBom.tolerance_variance_pct || 3}%</strong>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setViewModalOpen(false)}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  icon={Factory}
                  onClick={() => {
                    setViewModalOpen(false);
                    navigate('/production', { state: { selectedBomId: selectedBom.id } });
                  }}
                >
                  Schedule Production Run
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ========================================================================= */}
      {/* CREATE NEW BOM / CLONE RECIPE MODAL                                       */}
      {/* ========================================================================= */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create / Author Recipe (Bill of Materials)"
        maxWidth="max-w-4xl"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
          {/* Header Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Finished Good Item *
              </label>
              <select
                required
                value={createForm.finished_good_item_id}
                onChange={(e) => handleSelectFinishedGood(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 bg-white"
              >
                <option value="">Select Finished Product...</option>
                {finishedGoodsItems.map((fg) => (
                  <option key={fg.id} value={fg.id}>
                    {fg.sku} — {fg.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                BOM Code *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. BOM-PTC-100G"
                value={createForm.bom_code}
                onChange={(e) => setCreateForm({ ...createForm, bom_code: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 font-mono uppercase bg-white"
              >
              </input>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Version Number *
              </label>
              <input
                type="number"
                min="1"
                required
                value={createForm.version_number}
                onChange={(e) => setCreateForm({ ...createForm, version_number: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Standard Batch Output Quantity *
              </label>
              <input
                type="number"
                step="1"
                min="1"
                required
                value={createForm.standard_batch_size}
                onChange={(e) => setCreateForm({ ...createForm, standard_batch_size: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Batch Output Unit (UOM) *
              </label>
              <select
                required
                value={createForm.batch_uom_id}
                onChange={(e) => setCreateForm({ ...createForm, batch_uom_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 bg-white"
              >
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.id} ({u.name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Tolerance Variance (%) *
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="25"
                required
                value={createForm.tolerance_variance_pct}
                onChange={(e) => setCreateForm({ ...createForm, tolerance_variance_pct: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 font-mono bg-white"
              />
            </div>
          </div>

          {/* Dynamic Recipe Ingredients Rows */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Recipe Materials & Packaging Ratios ({createForm.materials.length} components)
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={Plus}
                onClick={handleAddMaterialRow}
              >
                Add Ingredient
              </Button>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Item / Material *</th>
                    <th className="py-2.5 px-3 text-right">Standard Qty *</th>
                    <th className="py-2.5 px-3">UOM</th>
                    <th className="py-2.5 px-3 text-right">Scrap Allowance (%)</th>
                    <th className="py-2.5 px-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {createForm.materials.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <select
                          required
                          value={row.item_id}
                          onChange={(e) => handleMaterialChange(idx, 'item_id', e.target.value)}
                          className="w-full border border-slate-300 rounded-md p-1.5 bg-white text-xs"
                        >
                          <option value="">Select Raw Material / Packaging...</option>
                          {materialItems.map((m) => (
                            <option key={m.id} value={m.id}>
                              [{m.item_type === 'packaging' ? 'PKG' : 'RAW'}] {m.sku} — {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          step="0.0001"
                          min="0.0001"
                          required
                          value={row.standard_qty}
                          onChange={(e) => handleMaterialChange(idx, 'standard_qty', e.target.value)}
                          className="w-24 border border-slate-300 rounded-md p-1.5 text-right font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <select
                          required
                          value={row.uom_id}
                          onChange={(e) => handleMaterialChange(idx, 'uom_id', e.target.value)}
                          className="w-20 border border-slate-300 rounded-md p-1.5 bg-white text-xs font-mono"
                        >
                          {uoms.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.id}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="50"
                          value={row.scrap_allowance_pct}
                          onChange={(e) =>
                            handleMaterialChange(idx, 'scrap_allowance_pct', e.target.value)
                          }
                          className="w-20 border border-slate-300 rounded-md p-1.5 text-right font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          disabled={createForm.materials.length === 1}
                          onClick={() => handleRemoveMaterialRow(idx)}
                          className="text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed p-1 rounded"
                          title="Remove row"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Manufacturing Instructions & Notes
            </label>
            <textarea
              rows={2}
              value={createForm.notes}
              onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              placeholder="e.g. Frying temperature 175°C, slice thickness 1.2mm, nitrogen flush sealing"
              className="w-full border border-slate-300 rounded-lg p-2 text-xs"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Save Recipe Version
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
