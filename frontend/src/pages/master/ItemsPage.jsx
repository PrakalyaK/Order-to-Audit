import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { Package, Plus, Search, Filter } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const ItemsPage = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [items, setItems] = useState([]);
  const [uoms, setUoms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [itemType, setItemType] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [form, setForm] = useState({
    sku: '',
    name: '',
    item_type: 'raw_material',
    base_uom_id: '',
    hsn_code: '1905',
    gst_rate_pct: 12,
    standard_purchase_rate: 0,
    standard_selling_price: 0,
    min_reorder_level: 10,
    packets_per_carton: 1,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const params = {};
      if (search) params.search = search;
      if (itemType) params.item_type = itemType;

      const [itemsRes, uomsRes] = await Promise.allSettled([
        api.get('/items', { params }),
        api.get('/units'),
      ]);

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
      setError(err.message || 'Failed to fetch items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [search, itemType]);

  const handleCreateItem = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        gst_rate_pct: Number(form.gst_rate_pct),
        standard_purchase_rate: Number(form.standard_purchase_rate),
        standard_selling_price: Number(form.standard_selling_price),
        min_reorder_level: Number(form.min_reorder_level),
        packets_per_carton: Number(form.packets_per_carton),
      };
      await api.post('/items', payload);
      setIsModalOpen(false);
      setForm({
        sku: '',
        name: '',
        item_type: 'raw_material',
        base_uom_id: '',
        hsn_code: '1905',
        gst_rate_pct: 12,
        standard_purchase_rate: 0,
        standard_selling_price: 0,
        min_reorder_level: 10,
        packets_per_carton: 1,
      });
      fetchData();
    } catch (err) {
      alert(`Error creating item: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Items & Master Catalog</h1>
          <p className="text-xs text-slate-500 mt-1">
            Raw materials, packaging, and finished food products with GST HSN classifications
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setIsModalOpen(true)} icon={Plus} size="sm">
            Add New Item
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by SKU, name or HSN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value)}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Categories</option>
            <option value="finished_good">Finished Goods</option>
            <option value="raw_material">Raw Materials</option>
            <option value="packaging">Packaging</option>
            <option value="work_in_progress">Work in Progress</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <Card>
        {loading ? (
          <LoadingSpinner text="Loading item records..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : items.length === 0 ? (
          <EmptyState message="No items matched your search filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">SKU / Code</th>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">HSN / GST</th>
                  <th className="py-3 px-4">Base UOM</th>
                  <th className="py-3 px-4 text-right">Standard Rate</th>
                  <th className="py-3 px-4 text-right">Selling Price</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">{item.sku}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{item.name}</td>
                    <td className="py-3 px-4">
                      <Badge
                        variant={
                          item.item_type === 'finished_good' || item.item_type === 'finished_goods'
                            ? 'purple'
                            : item.item_type === 'raw_material'
                            ? 'primary'
                            : 'warning'
                        }
                      >
                        {item.item_type.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px]">
                      {item.hsn_code} <span className="text-slate-400">({item.gst_rate_pct}%)</span>
                    </td>
                    <td className="py-3 px-4 font-medium">{item.base_uom_name || 'Units'}</td>
                    <td className="py-3 px-4 text-right font-medium">
                      ₹{parseFloat(item.standard_purchase_rate || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">
                      ₹{parseFloat(item.standard_selling_price || 0).toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={item.is_active ? 'success' : 'default'}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Item Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create Master Catalog Item">
        <form onSubmit={handleCreateItem} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">SKU Code *</label>
              <input
                type="text"
                required
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                placeholder="e.g. FG-MRK-500G"
                className="w-full border border-slate-300 rounded-lg p-2 uppercase"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Item Name *</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Murukku 500g Pouch"
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Item Category *</label>
              <select
                value={form.item_type}
                onChange={(e) => setForm({ ...form, item_type: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="raw_material">Raw Material</option>
                <option value="finished_good">Finished Good</option>
                <option value="packaging">Packaging</option>
                <option value="work_in_progress">Work in Progress</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Base UOM *</label>
              <select
                required
                value={form.base_uom_id}
                onChange={(e) => setForm({ ...form, base_uom_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select UOM...</option>
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.dimension})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">HSN Code *</label>
              <input
                type="text"
                required
                value={form.hsn_code}
                onChange={(e) => setForm({ ...form, hsn_code: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">GST Rate (%) *</label>
              <select
                value={form.gst_rate_pct}
                onChange={(e) => setForm({ ...form, gst_rate_pct: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="0">0% (Exempt)</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Standard Purchase Rate (₹)</label>
              <input
                type="number"
                step="0.01"
                value={form.standard_purchase_rate}
                onChange={(e) => setForm({ ...form, standard_purchase_rate: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Standard Selling Price (₹)</label>
              <input
                type="number"
                step="0.01"
                value={form.standard_selling_price}
                onChange={(e) => setForm({ ...form, standard_selling_price: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Min Reorder Level</label>
              <input
                type="number"
                value={form.min_reorder_level}
                onChange={(e) => setForm({ ...form, min_reorder_level: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Packets Per Carton</label>
              <input
                type="number"
                value={form.packets_per_carton}
                onChange={(e) => setForm({ ...form, packets_per_carton: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Save Item
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
