import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { CreditCard, Plus, RotateCcw, Search, Eye } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const CustomerPaymentsPage = () => {
  const { hasRole } = useAuth();
  const canRecord = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN);
  const canReverse = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);

  const [form, setForm] = useState({
    customer_id: '',
    payment_date: new Date().toISOString().split('T')[0],
    amount: 5000,
    payment_method: 'bank_transfer',
    reference_number: '',
    notes: 'Payment received via RTGS',
    invoice_id: '',
    allocated_amount: 5000,
  });

  const [allocForm, setAllocForm] = useState({
    invoice_id: '',
    allocated_amount: 1000,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [paymentsRes, partiesRes, invRes] = await Promise.all([
        api.get('/payments'),
        api.get('/parties?party_type=customer'),
        api.get('/invoices'),
      ]);

      if (paymentsRes.success) setPayments(paymentsRes.data || []);
      if (partiesRes.success) setCustomers(partiesRes.data || []);
      if (invRes.success) setInvoices(invRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch customer payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        customer_id: form.customer_id,
        payment_date: form.payment_date,
        amount: Number(form.amount),
        payment_method: form.payment_method,
        reference_number: form.reference_number || undefined,
        notes: form.notes,
        allocations: form.invoice_id
          ? [{ invoice_id: form.invoice_id, amount: Number(form.allocated_amount || form.amount) }]
          : undefined,
      };
      await api.post('/payments', payload);
      alert('Customer receipt recorded successfully.');
      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Error recording payment: ${err.message}`);
    }
  };

  const handleReversePayment = async (payment) => {
    const reason = window.prompt(`Enter reason for reversing payment ${payment.reference_number || payment.id}:`);
    if (!reason) return;
    try {
      await api.post(`/payments/${payment.id}/reverse`, { reason });
      alert('Payment reversed atomically and invoice balances restored.');
      fetchData();
    } catch (err) {
      alert(`Reversal failed: ${err.message}`);
    }
  };

  const handleOpenAllocate = (payment) => {
    setSelectedPayment(payment);
    const unallocated =
      parseFloat(payment.amount || 0) - parseFloat(payment.allocated_amount || 0);
    setAllocForm({
      invoice_id: '',
      allocated_amount: unallocated > 0 ? unallocated : 0,
    });
    setAllocateModalOpen(true);
  };

  const handleAllocate = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/payments/${selectedPayment.id}/allocate`, {
        invoice_id: allocForm.invoice_id,
        amount: Number(allocForm.allocated_amount),
      });
      alert('Advance payment allocated to invoice successfully.');
      setAllocateModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Allocation failed: ${err.message}`);
    }
  };

  const filteredPayments = payments.filter(
    (p) =>
      p.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.reference_number?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customer Receipts & Accounts Receivable</h1>
          <p className="text-xs text-slate-500 mt-1">
            Incoming client payments, invoice balance allocations, advance tracking, and atomic statutory reversals
          </p>
        </div>
        {canRecord && (
          <Button onClick={() => setCreateModalOpen(true)} icon={Plus} size="sm">
            Record Customer Receipt
          </Button>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by customer or reference..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching payments..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : filteredPayments.length === 0 ? (
          <EmptyState message="No customer payments recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Payment Ref</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Receipt Date</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4 text-right">Amount Received</th>
                  <th className="py-3 px-4 text-right">Allocated to Invoices</th>
                  <th className="py-3 px-4 text-right">Unallocated Advance</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPayments.map((p) => {
                  const amount = parseFloat(p.amount || 0);
                  const allocated = parseFloat(p.allocated_amount || 0);
                  const unallocated = amount - allocated;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                        {p.reference_number || `REC-${p.id.substring(0, 8)}`}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">{p.customer_name}</td>
                      <td className="py-3 px-4 text-slate-500">{p.payment_date}</td>
                      <td className="py-3 px-4 uppercase text-[10px] font-bold text-slate-600">
                        {p.payment_method?.replace('_', ' ')}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-emerald-600">
                        ₹{allocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-amber-600">
                        ₹{unallocated > 0 ? unallocated.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant={p.is_reversed ? 'danger' : 'success'}>
                          {p.is_reversed ? 'REVERSED' : 'CONFIRMED'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {unallocated > 0 && !p.is_reversed && canRecord && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAllocate(p)}
                            >
                              Allocate
                            </Button>
                          )}
                          {canReverse && !p.is_reversed && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={RotateCcw}
                              className="text-rose-600 hover:bg-rose-50"
                              onClick={() => handleReversePayment(p)}
                            >
                              Reverse
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

      {/* Record Payment Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Record Customer Payment">
        <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
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
                    {c.party_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Date *</label>
              <input
                type="date"
                required
                value={form.payment_date}
                onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Method *</label>
              <select
                value={form.payment_method}
                onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="bank_transfer">Bank Transfer / NEFT / RTGS</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI / Online</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Total Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">UTR / Cheque Ref No</label>
              <input
                type="text"
                value={form.reference_number}
                onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                placeholder="e.g. UTR-HDFC-99120"
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Allocate to Open Invoice (Optional)</label>
              <select
                value={form.invoice_id}
                onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Leave as Unallocated Advance</option>
                {invoices
                  .filter((i) => !form.customer_id || i.customer_id === form.customer_id)
                  .map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} (Total: ₹{parseFloat(inv.total_amount).toFixed(2)})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Post Receipt</Button>
          </div>
        </form>
      </Modal>

      {/* Allocate Advance Modal */}
      <Modal
        isOpen={allocateModalOpen}
        onClose={() => setAllocateModalOpen(false)}
        title={`Allocate Advance — ${selectedPayment?.reference_number || 'Receipt'}`}
      >
        <form onSubmit={handleAllocate} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Target Open Invoice *</label>
            <select
              required
              value={allocForm.invoice_id}
              onChange={(e) => setAllocForm({ ...allocForm, invoice_id: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            >
              <option value="">Select Invoice...</option>
              {invoices
                .filter((i) => i.customer_id === selectedPayment?.customer_id)
                .map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} (Total: ₹{parseFloat(inv.total_amount).toFixed(2)})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Allocation Amount (₹) *</label>
            <input
              type="number"
              step="0.01"
              required
              value={allocForm.allocated_amount}
              onChange={(e) => setAllocForm({ ...allocForm, allocated_amount: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2 font-bold"
            />
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setAllocateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Allocate to Invoice</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
