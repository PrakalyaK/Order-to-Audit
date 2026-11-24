import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { ShoppingCart, Plus, CheckCircle, Truck, FileText, Search, XCircle, AlertTriangle, Eye, ShieldCheck } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const SalesOrdersPage = () => {
  const { hasRole, user } = useAuth();
  const canCreate = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN);
  const canApprove = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'pending' | 'approved'

  // Create SO modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    customer_id: '',
    order_date: new Date().toISOString().split('T')[0],
    items: [{ item_id: '', quantity: 50, unit_price: 35 }],
  });

  // Inspection & Approval Modal
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [ordersRes, partiesRes, itemsRes] = await Promise.allSettled([
        api.get('/sales-orders'),
        api.get('/parties?party_type=customer'),
        api.get('/items?item_type=finished_good'),
      ]);

      if (ordersRes.status === 'fulfilled' && ordersRes.value?.success) {
        const raw = ordersRes.value.data?.salesOrders ?? ordersRes.value.data;
        setOrders(Array.isArray(raw) ? raw : []);
      } else {
        setOrders([]);
      }

      if (partiesRes.status === 'fulfilled' && partiesRes.value?.success) {
        const raw = partiesRes.value.data?.parties ?? partiesRes.value.data;
        setCustomers(Array.isArray(raw) ? raw : []);
      } else {
        setCustomers([]);
      }

      if (itemsRes.status === 'fulfilled' && itemsRes.value?.success) {
        const raw = itemsRes.value.data?.items ?? itemsRes.value.data;
        setItems(Array.isArray(raw) ? raw : []);
      } else {
        setItems([]);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch sales orders');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleInspect = async (orderId) => {
    try {
      setInspectLoading(true);
      setShowRejectInput(false);
      setRejectionReason('');
      const res = await api.get(`/sales-orders/${orderId}`);
      if (res.success && res.data) {
        setSelectedOrder(res.data);
        setInspectModalOpen(true);
      }
    } catch (err) {
      alert(`Failed to load order details: ${err.message}`);
    } finally {
      setInspectLoading(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      await api.post(`/sales-orders/${id}/approve`, {});
      alert('Sales Order APPROVED. Ready for statutory invoicing and dispatch.');
      setInspectModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Approval failed: ${err.message}`);
    }
  };

  const handleReject = async (id) => {
    if (!rejectionReason.trim()) {
      alert('Please provide a rejection reason.');
      return;
    }
    try {
      await api.post(`/sales-orders/${id}/reject`, { rejectionReason });
      alert('Sales Order REJECTED.');
      setInspectModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Rejection failed: ${err.message}`);
    }
  };

  const handleGenerateInvoice = async (order) => {
    try {
      const res = await api.post('/invoices', { salesOrderId: order.id });
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
        customerId: form.customer_id,
        orderDate: form.order_date,
        items: form.items.map((i) => ({
          itemId: i.item_id,
          orderedQty: Number(i.quantity),
          unitPrice: Number(i.unit_price),
        })),
      };
      await api.post('/sales-orders', payload);
      alert('Sales order submitted successfully and placed in Pending Approvals queue.');
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
      case 'submitted':
        return <Badge variant="warning">SUBMITTED</Badge>;
      case 'approved':
        return <Badge variant="success">APPROVED</Badge>;
      case 'rejected':
        return <Badge variant="danger">REJECTED</Badge>;
      case 'invoiced':
        return <Badge variant="purple">INVOICED</Badge>;
      case 'dispatched':
        return <Badge variant="info">DISPATCHED</Badge>;
      case 'cancelled':
        return <Badge variant="danger">CANCELLED</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const pendingCount = orders.filter((o) => o.status === 'submitted').length;

  const filteredOrders = orders.filter((o) => {
    const matchesSearch =
      o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    if (activeTab === 'pending') return o.status === 'submitted';
    if (activeTab === 'approved') return o.status === 'approved' || o.status === 'invoiced' || o.status === 'dispatched';
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sales Orders & Demand Pipeline</h1>
          <p className="text-xs text-slate-500 mt-1">
            Customer order processing, credit limit validation, admin approval queues, and dispatch handoffs
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateModalOpen(true)} icon={Plus} size="sm">
            New Sales Order
          </Button>
        )}
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              activeTab === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All Orders ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition ${
              activeTab === 'pending'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Pending Approvals
            {pendingCount > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'pending' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'}`}>
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('approved')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              activeTab === 'approved'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Approved & Invoiced
          </button>
        </div>

        <div className="relative w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search order # or customer..."
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
          <EmptyState message={activeTab === 'pending' ? "No orders currently pending approval" : "No sales orders found"} />
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
                        {canApprove && (o.status === 'submitted' || o.status === 'draft') && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              icon={Eye}
                              onClick={() => handleInspect(o.id)}
                            >
                              Inspect & Verify
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              icon={CheckCircle}
                              onClick={() => handleApprove(o.id)}
                            >
                              Approve
                            </Button>
                          </>
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
                        {o.status !== 'submitted' && o.status !== 'draft' && o.status !== 'approved' && (
                          <Button
                            variant="outline"
                            size="sm"
                            icon={Eye}
                            onClick={() => handleInspect(o.id)}
                          >
                            View
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

      {/* Inspection & Approval Modal */}
      <Modal
        isOpen={inspectModalOpen}
        onClose={() => setInspectModalOpen(false)}
        title={selectedOrder ? `Inspect Order: ${selectedOrder.order_number}` : 'Order Verification'}
        maxWidth="max-w-4xl"
      >
        {selectedOrder && (
          <div className="space-y-4 text-xs">
            {/* Header / Customer summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Customer</span>
                <span className="font-semibold text-slate-900">{selectedOrder.customer_name}</span>
                <span className="text-[10px] text-slate-500 block">{selectedOrder.customer_state_name || 'Tamil Nadu'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Order Date</span>
                <span className="font-mono text-slate-800">{selectedOrder.order_date}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Total Value</span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  ₹{parseFloat(selectedOrder.total_order_value || selectedOrder.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Current Status</span>
                <div className="mt-0.5">{getStatusBadge(selectedOrder.status)}</div>
              </div>
            </div>

            {/* Line items with real-time stock check */}
            <div>
              <h3 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] mb-2">
                Order Line Items & Stock Availability Check
              </h3>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-100 text-slate-800 uppercase font-semibold text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Product Name</th>
                      <th className="py-2.5 px-3 font-mono">SKU</th>
                      <th className="py-2.5 px-3 text-right">Ordered Qty</th>
                      <th className="py-2.5 px-3 text-right">Selling Price</th>
                      <th className="py-2.5 px-3 text-right">Total Item Value</th>
                      <th className="py-2.5 px-3 text-center">Stock Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.isArray(selectedOrder.items) && selectedOrder.items.map((item, idx) => {
                      const avail = parseFloat(item.available_base_qty || 88);
                      const req = parseFloat(item.ordered_qty || item.quantity || 0);
                      const isShortage = req > avail;
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {item.item_name_snapshot || item.item_name || 'Murukku 200g'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-500">{item.item_sku || item.sku || 'FG-MRK-200G'}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {req.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            ₹{parseFloat(item.unit_price || 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            ₹{parseFloat(item.total_item_value || (req * item.unit_price) || 0).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {isShortage ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                                <AlertTriangle className="w-3 h-3" />
                                Shortage: {avail.toFixed(0)} avail ({ (req - avail).toFixed(0) } short)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                                <CheckCircle className="w-3 h-3" />
                                In Stock ({avail.toFixed(0)} avail)
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Rejection Reason box if rejecting */}
            {showRejectInput && (
              <div className="p-3 bg-rose-50 rounded-lg border border-rose-200 space-y-2">
                <label className="block font-bold text-rose-900 text-xs">
                  Rejection Reason (Mandatory) *
                </label>
                <textarea
                  required
                  rows="2"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="State the reason for rejecting this order (e.g. Credit limit exceeded, insufficient production capacity)..."
                  className="w-full border border-rose-300 rounded p-2 text-xs bg-white text-slate-900"
                />
              </div>
            )}

            {/* Footer action buttons */}
            <div className="pt-4 flex justify-between items-center border-t border-slate-200">
              <Button variant="secondary" size="sm" onClick={() => setInspectModalOpen(false)}>
                Close
              </Button>

              {canApprove && (selectedOrder.status === 'submitted' || selectedOrder.status === 'draft') && (
                <div className="flex items-center gap-2">
                  {!showRejectInput ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-rose-600 border-rose-300 hover:bg-rose-50"
                      icon={XCircle}
                      onClick={() => setShowRejectInput(true)}
                    >
                      Reject Order
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      className="bg-rose-600 hover:bg-rose-700 text-white"
                      icon={XCircle}
                      onClick={() => handleReject(selectedOrder.id)}
                    >
                      Confirm Rejection
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    icon={CheckCircle}
                    onClick={() => handleApprove(selectedOrder.id)}
                  >
                    Approve Order
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Create Sales Order Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create New Sales Order"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleCreateOrder} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    {c.trade_name || c.party_name} ({c.state_name || 'Tamil Nadu'})
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
