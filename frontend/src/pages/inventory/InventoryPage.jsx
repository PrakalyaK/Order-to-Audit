import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api/client';
import { Card, StatCard, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import {
  Boxes,
  ArrowRightLeft,
  SlidersHorizontal,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Search,
  Filter,
  Package,
  Layers,
  Scale,
  Sparkles,
  TrendingUp,
  Warehouse
} from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const InventoryPage = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR);

  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'batches'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all'); // 'all' | 'raw_material' | 'finished_good' | 'packaging'
  const [quickFilter, setQuickFilter] = useState('all'); // 'all' | 'flour' | 'murukku' | 'low_stock'

  const [stock, setStock] = useState(() => {
    const cached = api.getCached?.('/inventory/stock');
    const raw = cached?.data?.stock || cached?.data;
    return Array.isArray(raw) ? raw : [];
  });
  const [batches, setBatches] = useState(() => {
    const cached = api.getCached?.('/batches');
    const raw = cached?.data?.batches || cached?.data;
    return Array.isArray(raw) ? raw : [];
  });
  const [warehouses, setWarehouses] = useState(() => {
    const cached = api.getCached?.('/warehouses');
    const raw = cached?.data?.warehouses || cached?.data;
    return Array.isArray(raw) ? raw : [];
  });
  const [items, setItems] = useState(() => {
    const cached = api.getCached?.('/items');
    const raw = cached?.data?.items || cached?.data;
    return Array.isArray(raw) ? raw : [];
  });
  const [loading, setLoading] = useState(() => {
    const cached = api.getCached?.('/inventory/stock');
    const raw = cached?.data?.stock || cached?.data;
    return !Array.isArray(raw) || raw.length === 0;
  });
  const [error, setError] = useState('');

  // Transfer modal
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    from_warehouse_id: '',
    to_warehouse_id: '',
    notes: 'Standard stock replenishment',
    items: [{ item_id: '', quantity: 10 }],
  });

  // Adjustment modal
  const [adjModalOpen, setAdjModalOpen] = useState(false);
  const [adjForm, setAdjForm] = useState({
    warehouse_id: '',
    item_id: '',
    physical_count: 0,
    system_count: 0,
    reason: 'physical_count',
    notes: 'Quarterly physical stock audit',
  });

  const fetchData = async () => {
    try {
      if (stock.length === 0) setLoading(true);
      setError('');
      const results = await Promise.allSettled([
        api.get('/inventory/stock'),
        api.get('/batches'),
        api.get('/warehouses'),
        api.get('/items', { params: { limit: 200 } }),
      ]);

      const [stockRes, batchRes, whRes, itemsRes] = results.map((r) =>
        r.status === 'fulfilled' ? r.value : null
      );

      if (stockRes?.success) {
        const raw = stockRes.data?.stock || stockRes.data;
        setStock(Array.isArray(raw) ? raw : []);
      }
      if (batchRes?.success) {
        const raw = batchRes.data?.batches || batchRes.data;
        setBatches(Array.isArray(raw) ? raw : []);
      }
      if (whRes?.success) {
        const raw = whRes.data?.warehouses || whRes.data;
        setWarehouses(Array.isArray(raw) ? raw : []);
      }
      if (itemsRes?.success) {
        const raw = itemsRes.data?.items || itemsRes.data;
        setItems(Array.isArray(raw) ? raw : []);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch inventory balances');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Compute top-level summary metrics
  const summary = useMemo(() => {
    let totalValuation = 0;
    let rawMaterialQty = 0;
    let finishedGoodQty = 0;
    let lowStockCount = 0;

    (Array.isArray(stock) ? stock : []).forEach((item) => {
      const qty = parseFloat(item.closing_stock_base_qty ?? item.quantity_on_hand ?? item.current_stock ?? 0);
      const val = parseFloat(item.total_stock_valuation ?? (qty * (parseFloat(item.current_moving_wac ?? item.moving_avg_cost ?? 0))));
      totalValuation += val;

      if (item.item_type === 'raw_material') {
        rawMaterialQty += qty;
      } else if (item.item_type === 'finished_good' || item.item_type === 'finished_goods') {
        finishedGoodQty += qty;
      }

      if (item.is_low_stock_alert) {
        lowStockCount++;
      }
    });

    return {
      totalValuation,
      rawMaterialQty,
      finishedGoodQty,
      lowStockCount,
      totalSkus: stock.length,
    };
  }, [stock]);

  // Filtered Stock list based on search and category filters
  const filteredStock = useMemo(() => {
    return (Array.isArray(stock) ? stock : []).filter((item) => {
      const name = (item.item_name || item.name || '').toLowerCase();
      const sku = (item.sku || '').toLowerCase();
      const query = searchQuery.toLowerCase().trim();

      // Quick filter pill logic
      if (quickFilter === 'flour' && !name.includes('flour') && !name.includes('besan') && !sku.includes('flour')) {
        return false;
      }
      if (quickFilter === 'murukku' && !name.includes('murukku') && !sku.includes('mrk')) {
        return false;
      }
      if (quickFilter === 'low_stock' && !item.is_low_stock_alert) {
        return false;
      }

      // Category filter dropdown
      if (selectedCategory !== 'all') {
        const type = (item.item_type || '').toLowerCase();
        if (selectedCategory === 'finished_good' && !type.includes('finished')) return false;
        if (selectedCategory === 'raw_material' && !type.includes('raw')) return false;
        if (selectedCategory === 'packaging' && !type.includes('pack')) return false;
      }

      // Search query filter
      if (query && !name.includes(query) && !sku.includes(query)) {
        return false;
      }

      return true;
    });
  }, [stock, searchQuery, selectedCategory, quickFilter]);

  // Filtered Batches list
  const filteredBatches = useMemo(() => {
    return (Array.isArray(batches) ? batches : []).filter((b) => {
      const name = (b.item_name || b.name || '').toLowerCase();
      const batchNo = (b.batch_number || '').toLowerCase();
      const query = searchQuery.toLowerCase().trim();

      if (query && !name.includes(query) && !batchNo.includes(query)) {
        return false;
      }
      return true;
    });
  }, [batches, searchQuery]);

  const handleStockTransfer = async (e) => {
    e.preventDefault();
    if (transferForm.from_warehouse_id === transferForm.to_warehouse_id) {
      alert('Source and destination warehouses cannot be the same.');
      return;
    }
    try {
      const payload = {
        source_warehouse_id: transferForm.from_warehouse_id,
        destination_warehouse_id: transferForm.to_warehouse_id,
        transfer_date: new Date().toISOString().split('T')[0],
        notes: transferForm.notes,
        items: transferForm.items.map((i) => ({
          item_id: i.item_id,
          requested_qty: Number(i.quantity),
        })),
      };
      const res = await api.post('/warehouses/transfers', payload);
      const transfer = res.data?.transfer || res.data;
      if (transfer?.id && hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN)) {
        try {
          await api.post(`/warehouses/transfers/${transfer.id}/approve`);
          await api.post(`/warehouses/transfers/${transfer.id}/dispatch`);
          const transferItemId =
            transfer.items?.[0]?.id || transfer.transfer_items?.[0]?.id;
          if (transferItemId) {
            await api.post(`/warehouses/transfers/${transfer.id}/receive`, {
              items: [
                {
                  transfer_item_id: transferItemId,
                  received_qty: Number(transferForm.items[0]?.quantity),
                },
              ],
            });
          }
        } catch (flowErr) {
          console.warn('Auto transfer dispatch/receive note:', flowErr.message);
        }
      }
      alert('Warehouse stock transfer recorded successfully!');
      setTransferModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Transfer failed: ${err.message}`);
    }
  };

  const handleStockAdjustment = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        warehouse_id: adjForm.warehouse_id,
        item_id: adjForm.item_id,
        adjustment_date: new Date().toISOString().split('T')[0],
        adjustment_type: adjForm.reason || 'physical_count',
        physical_count: Number(adjForm.physical_count),
        reason: adjForm.notes || 'Quarterly physical stock audit',
      };
      await api.post('/inventory/adjustments', payload);
      alert('Stock adjustment recorded. Immutable ledger transaction posted.');
      setAdjModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Adjustment failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Real-Time Inventory & Stock Ledger</h1>
          <p className="text-xs text-slate-500 mt-1">
            Live physical balances on hand, Moving Weighted Average Cost (WAC) valuation, and FEFO batch traceability
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button
              onClick={() => setTransferModalOpen(true)}
              variant="outline"
              size="sm"
              icon={ArrowRightLeft}
            >
              Stock Transfer
            </Button>
            <Button
              onClick={() => setAdjModalOpen(true)}
              variant="primary"
              size="sm"
              icon={SlidersHorizontal}
            >
              Adjust Stock
            </Button>
          </div>
        )}
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Stock Valuation"
          value={`₹${summary.totalValuation.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={TrendingUp}
          color="green"
          subtitle={`${summary.totalSkus} tracked products across all warehouses`}
        />
        <StatCard
          title="Raw Materials On Hand"
          value={`${summary.rawMaterialQty.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KG`}
          icon={Boxes}
          color="blue"
          subtitle="Flours, Cooking Oils, Spices & Ingredients"
        />
        <StatCard
          title="Finished Goods Ready"
          value={`${summary.finishedGoodQty.toLocaleString('en-IN', { minimumFractionDigits: 0 })} PKT`}
          icon={Package}
          color="purple"
          subtitle="Packaged Murukku, Chips & Savouries"
        />
        <StatCard
          title="Low-Stock Alerts"
          value={`${summary.lowStockCount} Items`}
          icon={AlertTriangle}
          color={summary.lowStockCount > 0 ? 'rose' : 'emerald'}
          subtitle={summary.lowStockCount > 0 ? 'Items at or below reorder threshold' : 'All raw material stocks healthy'}
        />
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search stock by item name (e.g. Flour, Murukku, Oil, SKU)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Quick Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setQuickFilter('all'); setSelectedCategory('all'); }}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
              quickFilter === 'all' && selectedCategory === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Items
          </button>
          <button
            type="button"
            onClick={() => { setQuickFilter('flour'); }}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 ${
              quickFilter === 'flour'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            🌾 Flours & Grains
          </button>
          <button
            type="button"
            onClick={() => { setQuickFilter('murukku'); }}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 ${
              quickFilter === 'murukku'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200'
            }`}
          >
            🥨 Murukku & Snacks
          </button>
          <button
            type="button"
            onClick={() => { setQuickFilter('low_stock'); }}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1 ${
              quickFilter === 'low_stock'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200'
            }`}
          >
            ⚠️ Low Stock
          </button>
        </div>

        {/* Category Dropdown */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={selectedCategory}
            onChange={(e) => { setSelectedCategory(e.target.value); setQuickFilter('all'); }}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Categories</option>
            <option value="raw_material">Raw Materials (Flours, Oils, Spices)</option>
            <option value="finished_good">Finished Goods (Murukku, Chips, Snacks)</option>
            <option value="packaging">Packaging (Pouches, Cartons)</option>
          </select>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('stock')}
          className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'stock'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Valuation & SKU Stock ({filteredStock.length})
        </button>
        <button
          onClick={() => setActiveTab('batches')}
          className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'batches'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          FEFO Batch Inspector ({filteredBatches.length})
        </button>
      </div>

      {/* 1. Valuation & Stock Tab */}
      {activeTab === 'stock' && (
        <Card>
          {loading ? (
            <LoadingSpinner text="Computing inventory moving averages..." />
          ) : error ? (
            <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
          ) : filteredStock.length === 0 ? (
            <EmptyState message={searchQuery ? `No items matched "${searchQuery}"` : "No inventory balances on hand"} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">SKU Code</th>
                    <th className="py-3 px-4">Item Name</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Available Stock</th>
                    <th className="py-3 px-4">UOM</th>
                    <th className="py-3 px-4 text-right">Moving WAC (₹)</th>
                    <th className="py-3 px-4 text-right">Total Valuation (₹)</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStock.map((item) => {
                    const qty = parseFloat(
                      item.closing_stock_base_qty ??
                      item.quantity_on_hand ??
                      item.current_stock ??
                      0
                    );
                    const cost = parseFloat(
                      item.current_moving_wac ??
                      item.moving_avg_cost ??
                      item.current_moving_avg_cost ??
                      0
                    );
                    const valuation = parseFloat(
                      item.total_stock_valuation ??
                      (qty * cost)
                    );
                    const uom = item.base_uom_id || item.base_uom_name || item.uom || 'Units';
                    const name = item.item_name || item.name || '';
                    const isMurukku = name.toLowerCase().includes('murukku') || (item.sku && item.sku.includes('MRK'));
                    const isFlour = name.toLowerCase().includes('flour') || name.toLowerCase().includes('besan');

                    return (
                      <tr
                        key={item.id || item.item_id || item.sku}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          isMurukku
                            ? 'bg-purple-50/40'
                            : isFlour
                            ? 'bg-amber-50/30'
                            : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                          {item.sku}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{name}</span>
                            {isMurukku && (
                              <Badge variant="purple" size="xs">
                                Murukku
                              </Badge>
                            )}
                            {isFlour && (
                              <Badge variant="warning" size="xs">
                                Flour Mix
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={
                              item.item_type === 'finished_goods' || item.item_type === 'finished_good'
                                ? 'purple'
                                : item.item_type === 'raw_material'
                                ? 'primary'
                                : 'warning'
                            }
                          >
                            {(item.item_type || 'Product').replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 text-sm">
                          <span
                            className={
                              qty > 0
                                ? 'bg-emerald-50 text-emerald-800 px-2.5 py-1 rounded-lg border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 px-2 py-0.5 rounded-md'
                            }
                          >
                            {qty.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-600">
                          {uom}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-medium">
                          ₹{cost.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          ₹{valuation.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {item.is_low_stock_alert ? (
                            <Badge variant="danger">Low Stock</Badge>
                          ) : qty > 0 ? (
                            <Badge variant="success">In Stock</Badge>
                          ) : (
                            <Badge variant="default">Zero Stock</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* 2. Batches FEFO Tab */}
      {activeTab === 'batches' && (
        <Card>
          {loading ? (
            <LoadingSpinner text="Querying FEFO batches..." />
          ) : filteredBatches.length === 0 ? (
            <EmptyState message="No active batches in stock" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Batch Number</th>
                    <th className="py-3 px-4">Product / Item</th>
                    <th className="py-3 px-4">Warehouse</th>
                    <th className="py-3 px-4 text-right">Current Balance</th>
                    <th className="py-3 px-4">UOM</th>
                    <th className="py-3 px-4">Expiry Date</th>
                    <th className="py-3 px-4 text-center">FEFO Expiry Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBatches.map((b, idx) => {
                    const expiry = b.expiry_date ? new Date(b.expiry_date) : null;
                    const now = new Date();
                    const daysLeft = expiry ? Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)) : null;

                    let expiryBadge = <Badge variant="success">Safe</Badge>;
                    if (daysLeft !== null) {
                      if (daysLeft < 0) {
                        expiryBadge = <Badge variant="danger">Expired</Badge>;
                      } else if (daysLeft <= 30) {
                        expiryBadge = (
                          <Badge variant="warning">
                            Expiring in {daysLeft}d
                          </Badge>
                        );
                      }
                    }

                    const batchQty = parseFloat(b.available_qty ?? b.current_balance ?? b.quantity ?? 0);
                    const isMurukku = (b.item_name || '').toLowerCase().includes('murukku');

                    return (
                      <tr key={idx} className={`hover:bg-slate-50/80 transition-colors ${isMurukku ? 'bg-purple-50/40' : ''}`}>
                        <td className="py-3 px-4 font-mono font-semibold text-blue-600">{b.batch_number}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{b.item_name}</td>
                        <td className="py-3 px-4 text-slate-600">{b.warehouse_name || 'Central Warehouse'}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          {batchQty.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-slate-500">{b.base_uom_id || 'Units'}</td>
                        <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                          {b.expiry_date || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-center">{expiryBadge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Inter-Warehouse Transfer Modal */}
      <Modal
        isOpen={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        title="Inter-Warehouse Stock Transfer"
      >
        <form onSubmit={handleStockTransfer} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Source Warehouse *</label>
              <select
                required
                value={transferForm.from_warehouse_id}
                onChange={(e) => setTransferForm({ ...transferForm, from_warehouse_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Source...</option>
                {(Array.isArray(warehouses) ? warehouses : []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code || w.warehouse_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Destination Warehouse *</label>
              <select
                required
                value={transferForm.to_warehouse_id}
                onChange={(e) => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Destination...</option>
                {(Array.isArray(warehouses) ? warehouses : []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code || w.warehouse_code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Stock Item *</label>
            <select
              required
              value={transferForm.items[0]?.item_id}
              onChange={(e) => {
                const updated = [...transferForm.items];
                updated[0].item_id = e.target.value;
                setTransferForm({ ...transferForm, items: updated });
              }}
              className="w-full border border-slate-300 rounded-lg p-2"
            >
              <option value="">Select Item to Move...</option>
              {(Array.isArray(items) ? items : []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.sku} — {i.name} ({i.base_uom_id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Transfer Quantity *</label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={transferForm.items[0]?.quantity}
              onChange={(e) => {
                const updated = [...transferForm.items];
                updated[0].quantity = e.target.value;
                setTransferForm({ ...transferForm, items: updated });
              }}
              className="w-full border border-slate-300 rounded-lg p-2 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Transfer Purpose / Notes</label>
            <input
              type="text"
              value={transferForm.notes}
              onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setTransferModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Dispatch & Post Transfer
            </Button>
          </div>
        </form>
      </Modal>

      {/* Physical Stock Audit & Adjustment Modal */}
      <Modal
        isOpen={adjModalOpen}
        onClose={() => setAdjModalOpen(false)}
        title="Physical Inventory Audit & Variance Adjustment"
      >
        <form onSubmit={handleStockAdjustment} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Warehouse Location *</label>
            <select
              required
              value={adjForm.warehouse_id}
              onChange={(e) => setAdjForm({ ...adjForm, warehouse_id: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            >
              <option value="">Select Warehouse...</option>
              {(Array.isArray(warehouses) ? warehouses : []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code || w.warehouse_code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Counted Item *</label>
            <select
              required
              value={adjForm.item_id}
              onChange={(e) => {
                const selected = stock.find((s) => s.item_id === e.target.value);
                const currentQty = selected ? parseFloat(selected.closing_stock_base_qty || 0) : 0;
                setAdjForm({
                  ...adjForm,
                  item_id: e.target.value,
                  system_count: currentQty,
                  physical_count: currentQty,
                });
              }}
              className="w-full border border-slate-300 rounded-lg p-2"
            >
              <option value="">Select Item for Audit...</option>
              {(Array.isArray(stock) ? stock : []).map((s) => (
                <option key={s.item_id} value={s.item_id}>
                  {s.sku} — {s.item_name} (System: {parseFloat(s.closing_stock_base_qty || 0)} {s.base_uom_id})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">System Book Balance</label>
              <input
                type="number"
                disabled
                value={adjForm.system_count}
                className="w-full bg-slate-100 border border-slate-300 rounded-lg p-2 font-mono text-slate-600"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Actual Physical Count *</label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={adjForm.physical_count}
                onChange={(e) => setAdjForm({ ...adjForm, physical_count: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 font-mono"
              />
            </div>
          </div>

          {adjForm.item_id && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
              <span className="text-slate-600">Calculated Variance:</span>
              <span className={`font-mono font-bold ${
                Number(adjForm.physical_count) - Number(adjForm.system_count) < 0
                  ? 'text-rose-600'
                  : Number(adjForm.physical_count) - Number(adjForm.system_count) > 0
                  ? 'text-emerald-600'
                  : 'text-slate-700'
              }`}>
                {(Number(adjForm.physical_count) - Number(adjForm.system_count)).toFixed(2)} units
              </span>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Reason for Adjustment</label>
            <select
              value={adjForm.reason}
              onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            >
              <option value="physical_count">Quarterly Physical Verification Count</option>
              <option value="damage">Spillage / Bag Damage / Breakage</option>
              <option value="spoilage">Quality Rejection / Moisture Spoilage</option>
              <option value="opening_balance">Opening Balance Calibration</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Auditor Notes</label>
            <input
              type="text"
              value={adjForm.notes}
              onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setAdjModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Post Physical Adjustment
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
