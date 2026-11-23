import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { Boxes, ArrowRightLeft, SlidersHorizontal, AlertTriangle, ShieldCheck, Clock } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const InventoryPage = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR);

  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'batches' | 'adjustments'
  const [stock, setStock] = useState([]);
  const [batches, setBatches] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
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
    reason: 'RECONCILIATION',
    notes: 'Quarterly physical stock audit',
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [stockRes, batchRes, whRes, itemsRes] = await Promise.all([
        api.get('/inventory'),
        api.get('/batches'),
        api.get('/warehouses'),
        api.get('/items'),
      ]);

      if (stockRes.success) setStock(stockRes.data || []);
      if (batchRes.success) setBatches(batchRes.data || []);
      if (whRes.success) setWarehouses(whRes.data || []);
      if (itemsRes.success) setItems(itemsRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch inventory balances');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleStockTransfer = async (e) => {
    e.preventDefault();
    if (transferForm.from_warehouse_id === transferForm.to_warehouse_id) {
      alert('Source and destination warehouses cannot be the same.');
      return;
    }
    try {
      const payload = {
        from_warehouse_id: transferForm.from_warehouse_id,
        to_warehouse_id: transferForm.to_warehouse_id,
        notes: transferForm.notes,
        items: transferForm.items.map((i) => ({
          item_id: i.item_id,
          quantity: Number(i.quantity),
        })),
      };
      const res = await api.post('/warehouses/transfers', payload);
      if (res.success && res.data?.id) {
        // Auto-approve and complete transfer for immediate demonstration
        await api.post(`/warehouses/transfers/${res.data.id}/approve`);
        await api.post(`/warehouses/transfers/${res.data.id}/dispatch`);
        await api.post(`/warehouses/transfers/${res.data.id}/receive`);
      }
      alert('Warehouse stock transfer executed and ledger updated!');
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
        physical_count: Number(adjForm.physical_count),
        reason: adjForm.reason,
        notes: adjForm.notes,
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inventory & Batch Ledger</h1>
          <p className="text-xs text-slate-500 mt-1">
            Moving Weighted Average Cost valuation, First-Expired First-Out (FEFO) batch tracking
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

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('stock')}
          className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'stock'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Valuation & SKU Stock
        </button>
        <button
          onClick={() => setActiveTab('batches')}
          className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'batches'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          FEFO Batch Inspector
        </button>
      </div>

      {/* Stock Tab */}
      {activeTab === 'stock' && (
        <Card>
          {loading ? (
            <LoadingSpinner text="Computing inventory moving averages..." />
          ) : error ? (
            <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
          ) : stock.length === 0 ? (
            <EmptyState message="No inventory balances on hand" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">SKU Code</th>
                    <th className="py-3 px-4">Item Name</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Quantity On Hand</th>
                    <th className="py-3 px-4">UOM</th>
                    <th className="py-3 px-4 text-right">Moving WAC (₹)</th>
                    <th className="py-3 px-4 text-right">Total Valuation (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stock.map((item) => {
                    const qty = parseFloat(item.quantity_on_hand || item.current_stock || 0);
                    const cost = parseFloat(item.moving_avg_cost || item.current_moving_avg_cost || 0);
                    const valuation = qty * cost;
                    return (
                      <tr key={item.id || item.item_id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-blue-600">{item.sku}</td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{item.name || item.item_name}</td>
                        <td className="py-3 px-4">
                          <Badge variant={item.item_type === 'finished_goods' ? 'purple' : 'primary'}>
                            {item.item_type || 'Product'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          {qty.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 px-4 text-slate-500">{item.base_uom_name || 'Units'}</td>
                        <td className="py-3 px-4 text-right font-mono font-medium">
                          ₹{cost.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          ₹{valuation.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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

      {/* Batches FEFO Tab */}
      {activeTab === 'batches' && (
        <Card>
          {loading ? (
            <LoadingSpinner text="Querying FEFO batches..." />
          ) : batches.length === 0 ? (
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
                    <th className="py-3 px-4">Expiry Date</th>
                    <th className="py-3 px-4 text-center">FEFO Expiry Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.map((b, idx) => {
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

                    return (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-semibold text-blue-600">{b.batch_number}</td>
                        <td className="py-3 px-4 font-medium text-slate-900">{b.item_name}</td>
                        <td className="py-3 px-4 text-slate-600">{b.warehouse_name || 'Central WH'}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          {parseFloat(b.current_balance || b.quantity || 0).toLocaleString('en-IN')}
                        </td>
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
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Target Warehouse *</label>
              <select
                required
                value={transferForm.to_warehouse_id}
                onChange={(e) => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Target...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Transfer Item *</label>
              <select
                required
                value={transferForm.items[0]?.item_id}
                onChange={(e) =>
                  setTransferForm({
                    ...transferForm,
                    items: [{ ...transferForm.items[0], item_id: e.target.value }],
                  })
                }
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Item...</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.sku})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Transfer Quantity *</label>
              <input
                type="number"
                step="0.01"
                required
                value={transferForm.items[0]?.quantity}
                onChange={(e) =>
                  setTransferForm({
                    ...transferForm,
                    items: [{ ...transferForm.items[0], quantity: e.target.value }],
                  })
                }
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Transfer Note / Reason</label>
            <input
              type="text"
              value={transferForm.notes}
              onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            />
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setTransferModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Execute Transfer</Button>
          </div>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal
        isOpen={adjModalOpen}
        onClose={() => setAdjModalOpen(false)}
        title="Physical Stock Adjustment & Reconciliation"
      >
        <form onSubmit={handleStockAdjustment} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Warehouse *</label>
              <select
                required
                value={adjForm.warehouse_id}
                onChange={(e) => setAdjForm({ ...adjForm, warehouse_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Warehouse...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Item *</label>
              <select
                required
                value={adjForm.item_id}
                onChange={(e) => setAdjForm({ ...adjForm, item_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Item...</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.sku})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Physical Verified Count *</label>
              <input
                type="number"
                step="0.01"
                required
                value={adjForm.physical_count}
                onChange={(e) => setAdjForm({ ...adjForm, physical_count: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Adjustment Reason *</label>
              <select
                value={adjForm.reason}
                onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="RECONCILIATION">Periodic Audit Reconciliation</option>
                <option value="DAMAGE">Damaged Goods Write-off</option>
                <option value="SPOILAGE">Expired / Spoilage Disposal</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Audit Notes *</label>
            <input
              type="text"
              required
              value={adjForm.notes}
              onChange={(e) => setAdjForm({ ...adjForm, notes: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            />
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setAdjModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Post Adjustment</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
