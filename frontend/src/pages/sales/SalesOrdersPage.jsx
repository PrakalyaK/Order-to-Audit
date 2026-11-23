import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { ShoppingCart, Plus, CheckCircle, Truck, FileText, Search } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const SalesOrdersPage = () => {
  const { hasRole } = useAuth();
  const canCreate = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN);
  const canApprove = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Create SO modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    customer_id: '',
    order_date: new Date().toISOString().split('T')[0],
    items: [{ item_id: '', quantity: 50, unit_price: 35 }],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [ordersRes, partiesRes, itemsRes] = await Promise.all([
        api.get('/sales-orders'),
        api.get('/parties?party_type=customer'),
        api.get('/items?item_type=finished_goods'),
      ]);

      if (ordersRes.success) setOrders(ordersRes.data || []);
      if (partiesRes.success) setCustomers(partiesRes.data || []);
      if (itemsRes.success) setItems(itemsRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch sales orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleApprove = async (id) => {
    try {
      await api.post(`/sales-orders/${id}/approve`);
      alert('Sales Order APPROVED. Ready for statutory invoicing and dispatch.');
      fetchData();
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    }
  };

  const handleGenerateInvoice = async (order) => {
    try {
      const res = await api.post('/invoices', { sales_order_id: order.id });
      alert(`GST Tax Invoice generated successfully: ${res.data?.invoice_number || 'Posted'}`);
      fetchData();
    } catch (err) {
      alert(`Invoice generation failed: ${err.message}`);
    }
  };

  const handleAddItemRow = () => {
    setForm({
      ...form,
      items: [...form.items, { item_id: '', quantity: 10, unit_price: 35 }],
    });
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...form.items];
    updated[index][field] = value;
    if (field === 'item_id') {
      const found = items.find((i) => i.id === value);
      if (found) {
        updated[index].unit_price = found.standard_selling_price || 35;
      }
    }
    setForm({ ...form, items: updated });
  };

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        customer_id: form.customer_id,
        order_date: form.order_date,
        items: form.items.map((i) => ({
          item_id: i.item_id,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
        })),
      };
      await api.post('/sales-orders', payload);
      alert('Sales order submitted successfully.');
      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Order creation failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'invoiced':
        return <Badge variant="purple">INVOICED</Badge>;
      case 'approved':
        return <Badge variant="success">APPROVED</Badge>;
      case 'draft':
        return <Badge variant="default">DRAFT</Badge>;
      case 'cancelled':
        return <Badge variant="danger">CANCELLED</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const filteredOrders = orders.filter(
    (o) =>
      o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sales Orders & Demand Pipeline</h1>
          <p className="text-xs text-slate-500 mt-1">
            Customer order processing, credit limit validation, approval workflows, and dispatch handoffs
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateModalOpen(true)} icon={Plus} size="sm">
            New Sales Order
          </Button>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by order # or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching sales orders..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : filteredOrders.length === 0 ? (
          <EmptyState message="No sales orders recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Order Number</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Order Date</th>
                  <th className="py-3 px-4 text-right">Order Subtotal</th>
                  <th className="py-3 px-4 text-right">Tax (GST)</th>
                  <th className="py-3 px-4 text-right">Total Value</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-blue-600">{o.order_number}</td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{o.customer_name}</td>
                    <td className="py-3 px-4 text-slate-500">{o.order_date}</td>
                    <td className="py-3 px-4 text-right font-medium">
                      ₹{parseFloat(o.subtotal_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-500">
                      ₹{(
                        parseFloat(o.cgst_amount || 0) +
                        parseFloat(o.sgst_amount || 0) +
                        parseFloat(o.igst_amount || 0)
                      ).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900">
                      ₹{parseFloat(o.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-center">{getStatusBadge(o.status)}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {canApprove && o.status === 'draft' && (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={CheckCircle}
                            onClick={() => handleApprove(o.id)}
                          >
                            Approve
                          </Button>
                        )}
                        {canApprove && o.status === 'approved' && (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={FileText}
                            onClick={() => handleGenerateInvoice(o)}
                          >
                            Generate Invoice
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

      {/* Create Sales Order Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create New Sales Order"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleCreateOrder} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Customer *</label>
              <select
                required
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.party_name} ({c.state_name})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Order Date *</label>
              <input
                type="date"
                required
                value={form.order_date}
                onChange={(e) => setForm({ ...form, order_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Order Items
              </span>
              <Button type="button" variant="outline" size="sm" onClick={handleAddItemRow}>
                + Add Item
              </Button>
            </div>
            <div className="space-y-2">
              {form.items.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="col-span-5">
                    <label className="text-[10px] text-slate-400 block">Product</label>
                    <select
                      required
                      value={row.item_id}
                      onChange={(e) => handleItemChange(idx, 'item_id', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs"
                    >
                      <option value="">Select Product...</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] text-slate-400 block">Quantity</label>
                    <input
                      type="number"
                      step="1"
                      required
                      value={row.quantity}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block">Unit Price (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={row.unit_price}
                      onChange={(e) => handleItemChange(idx, 'unit_price', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block">Subtotal</label>
                    <div className="py-1.5 font-bold text-slate-900">
                      ₹{((Number(row.quantity) || 0) * (Number(row.unit_price) || 0)).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit Order
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
