import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { ShoppingBag, Plus, Eye, CheckCircle2, Printer, Search } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const PurchasesPage = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [bills, setBills] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [items, setItems] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [selectedBill, setSelectedBill] = useState(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Bill creation form
  const [form, setForm] = useState({
    supplier_id: '',
    warehouse_id: '',
    bill_number: '',
    bill_date: new Date().toISOString().split('T')[0],
    items: [
      { item_id: '', quantity: 10, rate: 100, batch_number: 'BAT-RM-01', expiry_date: '' },
    ],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [billsRes, partiesRes, itemsRes, whRes] = await Promise.all([
        api.get('/purchases'),
        api.get('/parties?party_type=supplier'),
        api.get('/items'),
        api.get('/warehouses'),
      ]);

      if (billsRes.success) setBills(billsRes.data || []);
      if (partiesRes.success) setSuppliers(partiesRes.data || []);
      if (itemsRes.success) setItems(itemsRes.data || []);
      if (whRes.success) setWarehouses(whRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch purchases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleViewBill = async (id) => {
    try {
      const res = await api.get(`/purchases/${id}`);
      if (res.success && res.data) {
        setSelectedBill(res.data);
        setViewModalOpen(true);
      }
    } catch (err) {
      alert(`Error loading bill details: ${err.message}`);
    }
  };

  const handleReceiveBill = async (id) => {
    if (!window.confirm('Receive goods into inventory ledger and post Moving Weighted Average Cost?')) {
      return;
    }
    try {
      await api.post(`/purchases/${id}/receive`);
      alert('Purchase bill marked as RECEIVED. Stock ledger updated successfully.');
      fetchData();
      if (viewModalOpen) setViewModalOpen(false);
    } catch (err) {
      alert(`Error receiving shipment: ${err.message}`);
    }
  };

  const handleAddItemRow = () => {
    setForm({
      ...form,
      items: [
        ...form.items,
        { item_id: '', quantity: 1, rate: 0, batch_number: '', expiry_date: '' },
      ],
    });
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...form.items];
    updated[index][field] = value;
    if (field === 'item_id') {
      const found = items.find((i) => i.id === value);
      if (found) {
        updated[index].rate = found.standard_purchase_rate || 0;
      }
    }
    setForm({ ...form, items: updated });
  };

  const handleCreateBill = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        supplier_id: form.supplier_id,
        warehouse_id: form.warehouse_id || warehouses[0]?.id,
        bill_number: form.bill_number,
        bill_date: form.bill_date,
        items: form.items.map((i) => {
          const itemMaster = items.find((itm) => itm.id === i.item_id);
          return {
            item_id: i.item_id,
            quantity: Number(i.quantity),
            uom_id: (i.uom_id || itemMaster?.base_uom_id || 'KG').toUpperCase(),
            unit_rate: Number(i.rate || i.unit_rate),
            supplier_batch_no: i.batch_number || i.supplier_batch_no || undefined,
            expiry_date: i.expiry_date || undefined,
          };
        }),
      };
      await api.post('/purchases', payload);
      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Error creating purchase bill: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredBills = bills.filter(
    (b) =>
      b.bill_number?.toLowerCase().includes(search.toLowerCase()) ||
      b.supplier_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Purchase Bills & Inbound Logistics</h1>
          <p className="text-xs text-slate-500 mt-1">
            Supplier invoices, tax breakdowns, and automated Moving WAC inventory receipts
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateModalOpen(true)} icon={Plus} size="sm">
            Create Purchase Bill
          </Button>
        )}
      </div>

      {/* Filter / Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by bill number or supplier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching purchase bills..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : filteredBills.length === 0 ? (
          <EmptyState message="No purchase bills found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Bill Number</th>
                  <th className="py-3 px-4">Supplier</th>
                  <th className="py-3 px-4">Bill Date</th>
                  <th className="py-3 px-4 text-right">Taxable Subtotal</th>
                  <th className="py-3 px-4 text-right">Total Tax (GST)</th>
                  <th className="py-3 px-4 text-right">Bill Total</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBills.map((b) => {
                  const totalTax =
                    parseFloat(b.cgst_amount || 0) +
                    parseFloat(b.sgst_amount || 0) +
                    parseFloat(b.igst_amount || 0);
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">{b.bill_number}</td>
                      <td className="py-3 px-4 font-semibold text-slate-900">{b.supplier_name}</td>
                      <td className="py-3 px-4 text-slate-500">{b.bill_date}</td>
                      <td className="py-3 px-4 text-right font-medium">
                        ₹{parseFloat(b.subtotal_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-500">
                        ₹{totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        ₹{parseFloat(b.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant={b.status === 'received' ? 'success' : 'default'}>
                          {b.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button variant="outline" size="sm" icon={Eye} onClick={() => handleViewBill(b.id)}>
                            Inspect
                          </Button>
                          {canManage && b.status === 'draft' && (
                            <Button
                              variant="primary"
                              size="sm"
                              icon={CheckCircle2}
                              onClick={() => handleReceiveBill(b.id)}
                            >
                              Receive
                            </Button>
                          )}
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

      {/* Bill Details Modal */}
      <Modal
        isOpen={viewModalOpen}
        onClose={() => setViewModalOpen(false)}
        title={`Purchase Bill #${selectedBill?.bill_number}`}
        maxWidth="max-w-3xl"
      >
        {selectedBill && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Supplier</span>
                <span className="font-semibold text-slate-900">{selectedBill.supplier_name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Date</span>
                <span className="font-semibold text-slate-900">{selectedBill.bill_date}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Status</span>
                <Badge variant={selectedBill.status === 'received' ? 'success' : 'default'}>
                  {selectedBill.status.toUpperCase()}
                </Badge>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Total Payable</span>
                <span className="font-bold text-slate-900">
                  ₹{parseFloat(selectedBill.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div>
              <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] mb-2">
                Invoiced Line Items
              </h4>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-semibold text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Item / SKU</th>
                      <th className="py-2.5 px-3">Batch Number</th>
                      <th className="py-2.5 px-3 text-right">Quantity</th>
                      <th className="py-2.5 px-3 text-right">Rate (₹)</th>
                      <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedBill.items?.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-medium text-slate-900">{item.item_name}</td>
                        <td className="py-2 px-3 font-mono text-[11px]">{item.batch_number || '-'}</td>
                        <td className="py-2 px-3 text-right font-mono font-medium">
                          {parseFloat(item.quantity).toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          ₹{parseFloat(item.rate).toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                          ₹{parseFloat(item.total_amount || item.quantity * item.rate).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
              <Button
                variant="outline"
                size="sm"
                icon={Printer}
                onClick={() => window.print()}
              >
                Print Voucher
              </Button>
              <div className="flex gap-2">
                {canManage && selectedBill.status === 'draft' && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={CheckCircle2}
                    onClick={() => handleReceiveBill(selectedBill.id)}
                  >
                    Receive Stock
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setViewModalOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Purchase Bill Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Record New Purchase Bill"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleCreateBill} className="space-y-4 text-xs">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier *</label>
              <select
                required
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Supplier...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.party_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Bill Number *</label>
              <input
                type="text"
                required
                value={form.bill_number}
                onChange={(e) => setForm({ ...form, bill_number: e.target.value.toUpperCase() })}
                placeholder="e.g. INV-AGRO-901"
                className="w-full border border-slate-300 rounded-lg p-2 font-mono uppercase"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Bill Date *</label>
              <input
                type="date"
                required
                value={form.bill_date}
                onChange={(e) => setForm({ ...form, bill_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Item Lines
              </span>
              <Button type="button" variant="outline" size="sm" onClick={handleAddItemRow}>
                + Add Line
              </Button>
            </div>
            <div className="space-y-2">
              {form.items.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="col-span-4">
                    <label className="text-[10px] text-slate-400 block">Item</label>
                    <select
                      required
                      value={row.item_id}
                      onChange={(e) => handleItemChange(idx, 'item_id', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs"
                    >
                      <option value="">Select Item...</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block">Batch</label>
                    <input
                      type="text"
                      placeholder="BAT-01"
                      value={row.batch_number}
                      onChange={(e) => handleItemChange(idx, 'batch_number', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs font-mono"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block">Quantity</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={row.quantity}
                      onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block">Rate (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={row.rate}
                      onChange={(e) => handleItemChange(idx, 'rate', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] text-slate-400 block">Line Total</label>
                    <div className="py-1.5 font-bold text-slate-900">
                      ₹{((Number(row.quantity) || 0) * (Number(row.rate) || 0)).toFixed(2)}
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
              Post Bill
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
