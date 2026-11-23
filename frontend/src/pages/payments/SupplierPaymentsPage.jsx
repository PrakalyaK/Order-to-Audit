import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { Building2, Plus, RotateCcw, Search } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const SupplierPaymentsPage = () => {
  const { hasRole } = useAuth();
  const canRecord = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);
  const canReverse = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [payments, setPayments] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);

  const [form, setForm] = useState({
    supplier_id: '',
    payment_date: new Date().toISOString().split('T')[0],
    amount: 2835,
    payment_method: 'bank_transfer',
    reference_number: '',
    notes: 'Disbursement to agro supplier',
    purchase_bill_id: '',
    allocated_amount: 2835,
  });

  const [allocForm, setAllocForm] = useState({
    purchase_bill_id: '',
    allocated_amount: 1000,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const results = await Promise.allSettled([
        api.get('/supplier-payments'),
        api.get('/parties?party_type=supplier'),
        api.get('/purchases'),
      ]);

      const [paymentsRes, partiesRes, billsRes] = results.map((r) =>
        r.status === 'fulfilled' ? r.value : null
      );

      if (paymentsRes?.success) {
        const raw = paymentsRes.data?.payments || paymentsRes.data;
        setPayments(Array.isArray(raw) ? raw : []);
      }
      if (partiesRes?.success) {
        const raw = partiesRes.data?.parties || partiesRes.data;
        setSuppliers(Array.isArray(raw) ? raw : []);
      }
      if (billsRes?.success) {
        const raw = billsRes.data?.purchases || billsRes.data;
        setBills(Array.isArray(raw) ? raw : []);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch supplier payments');
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
      const mode = form.payment_method === 'bank_transfer' ? 'bank_transfer' : form.payment_method;
      const payload = {
        supplier_id: form.supplier_id,
        payment_date: form.payment_date,
        total_amount: Number(form.amount),
        payment_mode: mode,
        reference_number: form.reference_number || undefined,
        notes: form.notes,
        allocations: form.purchase_bill_id
          ? [{ purchase_bill_id: form.purchase_bill_id, allocated_amount: Number(form.allocated_amount || form.amount) }]
          : undefined,
      };
      await api.post('/supplier-payments', payload);
      alert('Supplier payment recorded successfully.');
      setCreateModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Error recording disbursement: ${err.message}`);
    }
  };

  const handleReversePayment = async (payment) => {
    const reason = window.prompt(`Enter reason for reversing payment ${payment.payment_number || payment.id}:`);
    if (!reason) return;
    try {
      await api.post(`/supplier-payments/${payment.id}/reverse`, { reversal_reason: reason });
      alert('Supplier payment reversed and purchase bill liability restored.');
      fetchData();
    } catch (err) {
      alert(`Reversal failed: ${err.message}`);
    }
  };

  const handleOpenAllocate = (payment) => {
    setSelectedPayment(payment);
    const unallocated =
      parseFloat(payment.total_amount || payment.amount || 0) -
      parseFloat(payment.allocated_amount || 0);
    setAllocForm({
      purchase_bill_id: '',
      allocated_amount: unallocated > 0 ? unallocated : 0,
    });
    setAllocateModalOpen(true);
  };

  const handleAllocate = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/supplier-payments/${selectedPayment.id}/allocate`, {
        purchase_bill_id: allocForm.purchase_bill_id,
        allocated_amount: Number(allocForm.allocated_amount),
      });
      alert('Advance allocated to purchase bill successfully.');
      setAllocateModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Allocation failed: ${err.message}`);
    }
  };

  const filteredPayments = (Array.isArray(payments) ? payments : []).filter(
    (p) =>
      p.supplier_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.payment_number?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Supplier Payments & Accounts Payable</h1>
          <p className="text-xs text-slate-500 mt-1">
            Vendor disbursements, bill settlement, advance allocations, and bank reconciliations
          </p>
        </div>
        {canRecord && (
          <Button onClick={() => setCreateModalOpen(true)} icon={Plus} size="sm">
            Disburse Supplier Payment
          </Button>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by supplier or payment #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching supplier disbursements..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : filteredPayments.length === 0 ? (
          <EmptyState message="No supplier disbursements recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Payment Ref</th>
                  <th className="py-3 px-4">Supplier Name</th>
                  <th className="py-3 px-4">Disbursed Date</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4 text-right">Total Disbursed</th>
                  <th className="py-3 px-4 text-right">Allocated to Bills</th>
                  <th className="py-3 px-4 text-right">Unallocated Advance</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPayments.map((p) => {
                  const amount = parseFloat(p.total_amount || p.amount || 0);
                  const allocated = parseFloat(p.allocated_amount || 0);
                  const unallocated = amount - allocated;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">
                        {p.payment_number || `SPAY-${p.id.substring(0, 8)}`}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">{p.supplier_name}</td>
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
                        <Badge variant={p.status === 'REVERSED' ? 'danger' : 'success'}>
                          {p.status || 'POSTED'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {unallocated > 0 && p.status !== 'REVERSED' && canRecord && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAllocate(p)}
                            >
                              Allocate
                            </Button>
                          )}
                          {canReverse && p.status !== 'REVERSED' && (
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
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Record Supplier Disbursement">
        <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier *</label>
              <select
                required
                value={form.supplier_id}
                onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Select Supplier...</option>
                {(Array.isArray(suppliers) ? suppliers : []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.party_name || s.trade_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Disbursement Date *</label>
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
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Amount (₹) *</label>
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
              <label className="block font-semibold text-slate-700 mb-1">Payment Reference / UTR</label>
              <input
                type="text"
                value={form.reference_number}
                onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                placeholder="e.g. UTR-SBI-88190"
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Allocate to Open Bill (Optional)</label>
              <select
                value={form.purchase_bill_id}
                onChange={(e) => setForm({ ...form, purchase_bill_id: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="">Leave as Unallocated Advance</option>
                {(Array.isArray(bills) ? bills : [])
                  .filter((b) => !form.supplier_id || b.supplier_id === form.supplier_id)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bill_number} (Total: ₹{parseFloat(b.total_amount).toFixed(2)})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Disburse Payment</Button>
          </div>
        </form>
      </Modal>

      {/* Allocate Advance Modal */}
      <Modal
        isOpen={allocateModalOpen}
        onClose={() => setAllocateModalOpen(false)}
        title={`Allocate Advance — ${selectedPayment?.payment_number || 'Payment'}`}
      >
        <form onSubmit={handleAllocate} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Target Open Purchase Bill *</label>
            <select
              required
              value={allocForm.purchase_bill_id}
              onChange={(e) => setAllocForm({ ...allocForm, purchase_bill_id: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2"
            >
              <option value="">Select Purchase Bill...</option>
              {(Array.isArray(bills) ? bills : [])
                .filter((b) => b.supplier_id === selectedPayment?.supplier_id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bill_number} (Bal: ₹{parseFloat(b.total_amount || 0).toFixed(2)})
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
            <Button type="submit">Allocate to Bill</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
