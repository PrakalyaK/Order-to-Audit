import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { Warehouse, Plus, Boxes, MapPin, Eye } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const WarehousesPage = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedStock, setSelectedStock] = useState(null);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [stockLoading, setStockLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    warehouse_type: 'finished_goods',
    address: 'Factory Premises, Phase 2, SIPCOT',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600001',
    is_active: true,
  });

  const fetchWarehouses = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/warehouses');
      if (res.success && res.data) {
        const raw = res.data?.warehouses || res.data;
        setWarehouses(Array.isArray(raw) ? raw : []);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch warehouses');
    } finally {
      setLoading(false);
    }
  };

  const handleInspectStock = async (w) => {
    try {
      setStockLoading(true);
      setStockModalOpen(true);
      const res = await api.get(`/warehouses/${w.id}/stock`);
      if (res.success && res.data) {
        const rawStock = res.data?.stock || res.data;
        setSelectedStock({ warehouse: w, stock: Array.isArray(rawStock) ? rawStock : [] });
      }
    } catch (err) {
      alert(`Failed to load warehouse stock: ${err.message}`);
    } finally {
      setStockLoading(false);
    }
  };

  const handleCreateWarehouse = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        warehouse_code: form.code,
        name: form.name,
        address: form.address,
        city: form.city,
        state_code: form.state || 'TN',
        is_active: form.is_active ?? true,
      };
      await api.post('/warehouses', payload);
      setIsModalOpen(false);
      setForm({
        code: '',
        name: '',
        warehouse_type: 'finished_goods',
        address: 'Factory Premises, Phase 2, SIPCOT',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
        is_active: true,
      });
      fetchWarehouses();
    } catch (err) {
      alert(`Error creating warehouse: ${err.message}`);
    }
  };

  useEffect(() => {
    fetchWarehouses();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Warehouses & Storage Depots</h1>
          <p className="text-xs text-slate-500 mt-1">
            Physical manufacturing plants, cold stores, and finished goods distribution warehouses
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setIsModalOpen(true)} icon={Plus} size="sm">
            Add Warehouse
          </Button>
        )}
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching warehouse registry..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : (!Array.isArray(warehouses) || warehouses.length === 0) ? (
          <EmptyState message="No warehouses found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Warehouse Code</th>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Inventory</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(Array.isArray(warehouses) ? warehouses : []).map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">{w.code || w.warehouse_code}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{w.name}</td>
                    <td className="py-3 px-4">
                      <Badge variant="primary">{w.warehouse_type || 'General'}</Badge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>{w.city ? `${w.city}, ${w.state}` : w.address || '-'}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={w.is_active ? 'success' : 'default'}>
                        {w.is_active ? 'Operational' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        icon={Eye}
                        onClick={() => handleInspectStock(w)}
                      >
                        Inspect Stock
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Stock Modal */}
      <Modal
        isOpen={stockModalOpen}
        onClose={() => setStockModalOpen(false)}
        title={`Live Stock — ${selectedStock?.warehouse?.name} (${selectedStock?.warehouse?.code})`}
        maxWidth="max-w-3xl"
      >
        {stockLoading ? (
          <LoadingSpinner text="Loading warehouse balance..." />
        ) : selectedStock?.stock?.length > 0 ? (
          <div className="space-y-3 text-xs">
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Item / SKU</th>
                    <th className="py-2.5 px-3 text-right">Quantity On Hand</th>
                    <th className="py-2.5 px-3">UOM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(Array.isArray(selectedStock?.stock) ? selectedStock.stock : []).map((s, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium text-slate-900">
                        {s.item_name}
                        <span className="text-[10px] text-slate-400 block font-mono">{s.item_sku}</span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {parseFloat(s.current_stock || s.quantity_on_hand || 0).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2 px-3 text-slate-500">{s.uom_name || 'units'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pt-2 flex justify-end">
              <Button variant="secondary" onClick={() => setStockModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState message="No physical stock currently stored in this warehouse." />
        )}
      </Modal>

      {/* Create Warehouse Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Register Storage Warehouse">
        <form onSubmit={handleCreateWarehouse} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Warehouse Code *</label>
              <input
                type="text"
                required
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. WH-SOUTH-01"
                className="w-full border border-slate-300 rounded-lg p-2 font-mono uppercase"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Warehouse Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Madurai Finished Goods Hub"
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Storage Type *</label>
              <select
                value={form.warehouse_type}
                onChange={(e) => setForm({ ...form, warehouse_type: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="finished_goods">Finished Goods Depot</option>
                <option value="raw_material">Raw Material Store</option>
                <option value="transit">In-Transit Storage</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">City *</label>
              <input
                type="text"
                required
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Register Warehouse</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
