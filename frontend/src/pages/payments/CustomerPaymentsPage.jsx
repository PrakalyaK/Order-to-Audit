import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import {
  CreditCard,
  Plus,
  RotateCcw,
  Search,
  Receipt,
  FileText,
  CheckCircle,
  AlertCircle,
  Wallet,
  Users,
  Calendar,
  Building2,
  TrendingDown,
  ArrowRight,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const CustomerPaymentsPage = () => {
  const { hasRole, user } = useAuth();
  const canRecord = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN);
  const canReverse = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [activeTab, setActiveTab] = useState('receipts'); // 'receipts' | 'invoices' | 'statement'
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [invoiceBalances, setInvoiceBalances] = useState([]);
  const [receivablesSummary, setReceivablesSummary] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerHistory, setCustomerHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Record Payment Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    customer_id: '',
    payment_date: new Date().toISOString().split('T')[0],
    amount: 4000,
    payment_mode: 'upi',
    reference_txn_id: 'UPI/20261119/992837461',
    notes: 'Payment received against order delivery',
    invoice_id: '',
    allocated_amount: 4000,
  });

  // Advance Allocation Modal State
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [allocForm, setAllocForm] = useState({
    invoice_id: '',
    allocated_amount: 1000,
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');

      const [paymentsRes, partiesRes, invBalancesRes, summaryRes] = await Promise.allSettled([
        api.get('/payments'),
        api.get('/parties', { params: { party_type: 'customer', limit: 100 } }),
        api.get('/payments/receivables/invoices', { params: { limit: 100 } }),
        api.get('/payments/receivables/summary'),
      ]);

      if (paymentsRes.status === 'fulfilled' && paymentsRes.value?.success) {
        const raw = paymentsRes.value.data?.payments || paymentsRes.value.data;
        setPayments(Array.isArray(raw) ? raw : []);
      } else {
        setPayments([]);
      }

      if (partiesRes.status === 'fulfilled' && partiesRes.value?.success) {
        const raw = partiesRes.value.data?.parties || partiesRes.value.data;
        setCustomers(Array.isArray(raw) ? raw : []);
      }

      if (invBalancesRes.status === 'fulfilled' && invBalancesRes.value?.success) {
        const raw = invBalancesRes.value.data?.invoices || invBalancesRes.value.data;
        setInvoiceBalances(Array.isArray(raw) ? raw : []);
      }

      if (summaryRes.status === 'fulfilled' && summaryRes.value?.success) {
        setReceivablesSummary(summaryRes.value.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to load customer receipts data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Fetch statement when customer changes in Statement tab
  const fetchCustomerHistory = async (custId) => {
    if (!custId) {
      setCustomerHistory(null);
      return;
    }
    try {
      setHistoryLoading(true);
      const res = await api.get(`/payments/customer/${custId}/history`);
      if (res.success && res.data) {
        setCustomerHistory(res.data);
      }
    } catch (err) {
      console.error('Failed to load customer history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'statement' && customers.length > 0 && !selectedCustomerId) {
      const firstCustId = customers[0].id;
      setSelectedCustomerId(firstCustId);
      fetchCustomerHistory(firstCustId);
    }
  }, [activeTab, customers]);

  // Handle open create modal from button or from invoice row
  const handleOpenCreateModal = (preselectedInvoice = null) => {
    if (preselectedInvoice) {
      const due = parseFloat(preselectedInvoice.outstanding_balance || 0);
      setForm({
        customer_id: preselectedInvoice.customer_id,
        payment_date: new Date().toISOString().split('T')[0],
        amount: due > 0 ? due : 4000,
        payment_mode: 'upi',
        reference_txn_id: `UPI/${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}/${Math.floor(100000 + Math.random() * 900000)}`,
        notes: `Receipt against invoice ${preselectedInvoice.invoice_number}`,
        invoice_id: preselectedInvoice.invoice_id || preselectedInvoice.id,
        allocated_amount: due > 0 ? due : 4000,
      });
    } else {
      const defaultCust = customers[0]?.id || '';
      const openInvs = invoiceBalances.filter((i) => i.customer_id === defaultCust && parseFloat(i.outstanding_balance || 0) > 0);
      const firstInv = openInvs[0];
      const due = firstInv ? parseFloat(firstInv.outstanding_balance || 0) : 4000;

      setForm({
        customer_id: defaultCust,
        payment_date: new Date().toISOString().split('T')[0],
        amount: due > 0 ? due : 4000,
        payment_mode: 'upi',
        reference_txn_id: 'UPI/20261119/992837461',
        notes: 'Payment received against customer order',
        invoice_id: firstInv ? (firstInv.invoice_id || firstInv.id) : '',
        allocated_amount: due > 0 ? due : 4000,
      });
    }
    setCreateModalOpen(true);
  };

  // When customer changes in create modal, auto-suggest first open invoice
  const handleCustomerChangeInForm = (custId) => {
    const custInvs = invoiceBalances.filter((i) => i.customer_id === custId && parseFloat(i.outstanding_balance || 0) > 0);
    const firstInv = custInvs[0];
    const due = firstInv ? parseFloat(firstInv.outstanding_balance || 0) : 4000;

    setForm({
      ...form,
      customer_id: custId,
      invoice_id: firstInv ? (firstInv.invoice_id || firstInv.id) : '',
      amount: due,
      allocated_amount: due,
    });
  };

  // When target invoice changes in modal, auto-fill amount
  const handleInvoiceChangeInForm = (invId) => {
    if (!invId) {
      setForm({ ...form, invoice_id: '', allocated_amount: 0 });
      return;
    }
    const inv = invoiceBalances.find((i) => (i.invoice_id || i.id) === invId);
    const due = inv ? parseFloat(inv.outstanding_balance || 0) : form.amount;
    setForm({
      ...form,
      invoice_id: invId,
      amount: due > 0 ? due : form.amount,
      allocated_amount: due > 0 ? due : form.amount,
    });
  };

  // Submit payment receipt
  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!form.customer_id) {
      alert('Please select a customer.');
      return;
    }
    if (Number(form.amount) <= 0) {
      alert('Payment amount must be greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      const mode = form.payment_mode || 'upi';
      const allocatedAmt = form.invoice_id ? Number(form.allocated_amount || form.amount) : 0;

      const payload = {
        customerId: form.customer_id,
        paymentDate: form.payment_date,
        totalAmount: Number(form.amount),
        paymentMode: mode,
        referenceTxnId: form.reference_txn_id || undefined,
        notes: form.notes || undefined,
        allocations: form.invoice_id && allocatedAmt > 0
          ? [{ invoiceId: form.invoice_id, amount: allocatedAmt }]
          : undefined,
      };

      const res = await api.post('/payments', payload);
      const receiptNo = res.data?.receipt_number || res.data?.reference_number || 'Receipt';
      alert(`Customer receipt ${receiptNo} recorded successfully!\nInvoice balances and accounts receivable have been updated.`);
      setCreateModalOpen(false);
      await fetchData();
      if (selectedCustomerId) {
        fetchCustomerHistory(selectedCustomerId);
      }
    } catch (err) {
      alert(`Error recording customer payment: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Reverse payment
  const handleReversePayment = async (payment) => {
    const ref = payment.receipt_number || payment.reference_number || payment.reference_txn_id || payment.id;
    const reason = window.prompt(`Enter statutory reason for reversing payment ${ref}:`);
    if (!reason || !reason.trim()) return;

    try {
      await api.post(`/payments/${payment.id}/reverse`, { reason: reason.trim() });
      alert('Payment reversed atomically. Invoice balances and customer ledger restored.');
      await fetchData();
      if (selectedCustomerId) {
        fetchCustomerHistory(selectedCustomerId);
      }
    } catch (err) {
      alert(`Reversal failed: ${err.message}`);
    }
  };

  // Open allocate advance modal
  const handleOpenAllocate = (payment) => {
    setSelectedPayment(payment);
    const total = parseFloat(payment.total_amount || payment.amount || 0);
    const allocated = parseFloat(payment.total_allocated || payment.allocated_amount || 0);
    const unallocated = total - allocated;
    setAllocForm({
      invoice_id: '',
      allocated_amount: unallocated > 0 ? unallocated : 0,
    });
    setAllocateModalOpen(true);
  };

  // Submit allocation
  const handleAllocate = async (e) => {
    e.preventDefault();
    if (!selectedPayment) return;
    try {
      await api.post(`/payments/${selectedPayment.id}/allocate`, {
        invoiceId: allocForm.invoice_id,
        amount: Number(allocForm.allocated_amount),
      });
      alert('Advance payment allocated to invoice successfully.');
      setAllocateModalOpen(false);
      await fetchData();
      if (selectedCustomerId) {
        fetchCustomerHistory(selectedCustomerId);
      }
    } catch (err) {
      alert(`Allocation failed: ${err.message}`);
    }
  };

  // Filtered payments list
  const filteredPayments = payments.filter((p) => {
    const q = search.toLowerCase();
    const ref = (p.receipt_number || p.reference_number || p.reference_txn_id || '').toLowerCase();
    const cust = (p.customer_name || '').toLowerCase();
    const mode = (p.payment_mode || p.payment_method || '').toLowerCase();
    const matchesSearch = !q || ref.includes(q) || cust.includes(q) || mode.includes(q);

    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'posted'
        ? p.status === 'posted' && !p.is_reversed
        : statusFilter === 'reversed'
        ? p.status === 'reversed' || p.is_reversed
        : true;

    return matchesSearch && matchesStatus;
  });

  // Calculate totals for UI banner
  const totalBilled = parseFloat(receivablesSummary?.total_invoiced_amount || 0);
  const totalReceived = parseFloat(receivablesSummary?.total_payments_received || 0);
  const totalOutstanding = parseFloat(receivablesSummary?.total_outstanding_amount || 0);
  const totalUnallocated = parseFloat(receivablesSummary?.total_unallocated_advances || 0);

  return (
    <div className="space-y-6">
      {/* Page Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-emerald-600" />
            <span>Customer Receipts & Accounts Receivable</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Record customer collections against GST invoices, manage advances, track real-time outstanding balances, and view customer ledger statements
          </p>
        </div>
        {canRecord && (
          <Button onClick={() => handleOpenCreateModal()} icon={Plus} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
            Record Customer Receipt
          </Button>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Total Collections</span>
            <span className="text-xl font-bold text-slate-900 font-mono">
              ₹{totalReceived.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-rose-50 text-rose-600">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Net Receivables Due</span>
            <span className="text-xl font-bold text-rose-600 font-mono">
              ₹{totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Total GST Invoiced</span>
            <span className="text-xl font-bold text-slate-900 font-mono">
              ₹{totalBilled.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Unallocated Advances</span>
            <span className="text-xl font-bold text-amber-600 font-mono">
              ₹{totalUnallocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-4 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('receipts')}
          className={`pb-3 border-b-2 flex items-center gap-2 transition ${
            activeTab === 'receipts'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Customer Receipts Register ({payments.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('invoices')}
          className={`pb-3 border-b-2 flex items-center gap-2 transition ${
            activeTab === 'invoices'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Open Invoices & Receivables Ledger ({invoiceBalances.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('statement')}
          className={`pb-3 border-b-2 flex items-center gap-2 transition ${
            activeTab === 'statement'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Customer Ledger Statement & Aging</span>
        </button>
      </div>

      {/* TAB 1: RECEIPTS REGISTER */}
      {activeTab === 'receipts' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search by receipt #, customer, UTR..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs border border-slate-300 rounded-lg p-1.5 bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="posted">Confirmed / Posted</option>
                <option value="reversed">Reversed</option>
              </select>
            </div>
          </div>

          <Card>
            {loading ? (
              <LoadingSpinner text="Fetching customer payment receipts..." />
            ) : error ? (
              <div className="text-rose-600 text-xs p-6 text-center">{error}</div>
            ) : filteredPayments.length === 0 ? (
              <EmptyState
                message="No customer receipts found. Record customer payment against open invoices above."
                action={canRecord ? { label: 'Record Customer Receipt', onClick: () => handleOpenCreateModal() } : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Receipt #</th>
                      <th className="py-3 px-4">Customer Name</th>
                      <th className="py-3 px-4">Payment Date</th>
                      <th className="py-3 px-4">Mode</th>
                      <th className="py-3 px-4">Reference / UTR</th>
                      <th className="py-3 px-4 text-right">Amount Received</th>
                      <th className="py-3 px-4 text-right">Allocated to Invoice</th>
                      <th className="py-3 px-4 text-right">Advance Balance</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPayments.map((p) => {
                      const amount = parseFloat(p.total_amount || p.amount || 0);
                      const allocated = parseFloat(p.total_allocated || p.allocated_amount || 0);
                      const unallocated = parseFloat(p.unallocated_amount !== undefined ? p.unallocated_amount : amount - allocated);
                      const isReversed = p.status === 'reversed' || p.is_reversed;
                      const receiptNo = p.receipt_number || p.reference_number || `REC-${p.id.substring(0, 8)}`;
                      const modeLabel = (p.payment_mode || p.payment_method || 'bank_transfer').toUpperCase().replace('_', ' ');

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-blue-600">{receiptNo}</td>
                          <td className="py-3 px-4 font-semibold text-slate-900">
                            {p.customer_name || 'Retailer A'}
                            {p.customer_gstin && <span className="block text-[10px] text-slate-400 font-mono">{p.customer_gstin}</span>}
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            {p.payment_date ? String(p.payment_date).split('T')[0] : '—'}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                              {modeLabel}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                            {p.reference_txn_id || p.reference_number || '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900 font-mono">
                            ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-emerald-600 font-mono">
                            ₹{allocated.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 px-4 text-right font-semibold text-amber-600 font-mono">
                            ₹{unallocated > 0 ? unallocated.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Badge variant={isReversed ? 'danger' : 'success'}>
                              {isReversed ? 'REVERSED' : 'CONFIRMED'}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {unallocated > 0 && !isReversed && canRecord && (
                                <Button variant="outline" size="sm" onClick={() => handleOpenAllocate(p)}>
                                  Allocate
                                </Button>
                              )}
                              {canReverse && !isReversed && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={RotateCcw}
                                  className="text-rose-600 hover:bg-rose-50"
                                  title="Statutory Reversal"
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
        </div>
      )}

      {/* TAB 2: OPEN INVOICES & RECEIVABLES LEDGER */}
      {activeTab === 'invoices' && (
        <Card title="Customer Invoices & Real-Time Receivables Balances">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Invoice Date</th>
                  <th className="py-3 px-4 text-right">Taxable Value</th>
                  <th className="py-3 px-4 text-right">Total Invoice Value (₹)</th>
                  <th className="py-3 px-4 text-right">Paid Amount (₹)</th>
                  <th className="py-3 px-4 text-right">Outstanding Balance (₹)</th>
                  <th className="py-3 px-4 text-center">Payment Status</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoiceBalances.map((inv) => {
                  const invId = inv.invoice_id || inv.id;
                  const total = parseFloat(inv.total_invoice_value || 0);
                  const paid = parseFloat(inv.total_paid_amount || 0);
                  const balance = parseFloat(inv.outstanding_balance !== undefined ? inv.outstanding_balance : total - paid);
                  const status = inv.derived_payment_status || (balance <= 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid');

                  return (
                    <tr key={invId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-blue-600">{inv.invoice_number}</td>
                      <td className="py-3 px-4 font-semibold text-slate-900">{inv.customer_name}</td>
                      <td className="py-3 px-4 text-slate-600">
                        {inv.invoice_date ? String(inv.invoice_date).split('T')[0] : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        ₹{parseFloat(inv.taxable_value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900 font-mono">
                        ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-emerald-600 font-mono">
                        ₹{paid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-rose-600 font-mono text-sm">
                        ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge
                          variant={
                            status === 'paid'
                              ? 'success'
                              : status === 'partially_paid'
                              ? 'warning'
                              : 'danger'
                          }
                        >
                          {status === 'partially_paid' ? 'PARTIALLY PAID' : status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {balance > 0 && canRecord ? (
                          <Button
                            variant="primary"
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] py-1 px-2.5"
                            onClick={() => handleOpenCreateModal(inv)}
                          >
                            Collect Payment
                          </Button>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Settled</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 3: CUSTOMER LEDGER STATEMENT & AGING */}
      {activeTab === 'statement' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-semibold text-slate-700">Select Customer Party:</span>
              <select
                value={selectedCustomerId}
                onChange={(e) => {
                  setSelectedCustomerId(e.target.value);
                  fetchCustomerHistory(e.target.value);
                }}
                className="text-xs border border-slate-300 rounded-lg p-2 bg-white min-w-[220px]"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.trade_name || c.party_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {historyLoading ? (
            <LoadingSpinner text="Loading customer accounts receivable statement..." />
          ) : customerHistory ? (
            <div className="space-y-4">
              {/* Customer Receivables Summary Banner */}
              <div className="p-4 bg-slate-900 text-white rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Customer Name</span>
                  <span className="text-base font-bold text-white block truncate">{customerHistory.customer?.trade_name}</span>
                  <span className="text-[11px] text-slate-400">Credit Limit: ₹{parseFloat(customerHistory.receivables?.credit_limit || 0).toLocaleString('en-IN')}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Total Invoiced</span>
                  <span className="text-base font-bold text-white font-mono">
                    ₹{parseFloat(customerHistory.receivables?.total_billed || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Total Received</span>
                  <span className="text-base font-bold text-emerald-400 font-mono">
                    ₹{parseFloat(customerHistory.receivables?.total_payments_received || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase font-bold tracking-wider block">Current Outstanding</span>
                  <span className="text-xl font-bold text-rose-400 font-mono">
                    ₹{parseFloat(customerHistory.receivables?.net_invoice_receivables || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Allocation History Table */}
              <Card title={`Payment Receipts & Allocations Ledger — ${customerHistory.customer?.trade_name}`}>
                {customerHistory.allocations?.length === 0 ? (
                  <EmptyState message="No invoice payment allocations recorded for this customer yet." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-600">
                      <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-4">Receipt #</th>
                          <th className="py-3 px-4">Allocated To Invoice</th>
                          <th className="py-3 px-4">Invoice Date</th>
                          <th className="py-3 px-4 text-right">Invoice Total (₹)</th>
                          <th className="py-3 px-4 text-right">Allocated Payment (₹)</th>
                          <th className="py-3 px-4 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {customerHistory.allocations?.map((al) => (
                          <tr key={al.allocation_id} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4 font-mono font-bold text-blue-600">{al.receipt_number}</td>
                            <td className="py-3 px-4 font-mono font-semibold text-slate-900">{al.invoice_number}</td>
                            <td className="py-3 px-4 text-slate-500">{al.invoice_date ? String(al.invoice_date).split('T')[0] : '—'}</td>
                            <td className="py-3 px-4 text-right font-mono">
                              ₹{parseFloat(al.total_invoice_value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600">
                              ₹{parseFloat(al.allocated_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Badge variant={al.allocation_status === 'active' ? 'success' : 'danger'}>
                                {al.allocation_status === 'active' ? 'ALLOCATED' : 'REVERSED'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          ) : null}
        </div>
      )}

      {/* RECORD PAYMENT MODAL */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Record Customer Receipt" maxWidth="max-w-2xl">
        <form onSubmit={handleRecordPayment} className="space-y-4 text-xs">
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <strong className="font-semibold block">Statutory Payment Receipt Workflow:</strong>
              Records incoming funds, credits accounts receivable, and automatically reduces customer invoice outstanding balance.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Customer Party *</label>
              <select
                required
                value={form.customer_id}
                onChange={(e) => handleCustomerChangeInForm(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 bg-white"
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
              <label className="block font-semibold text-slate-700 mb-1">Receipt Date *</label>
              <input
                type="date"
                required
                value={form.payment_date}
                onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Method / Channel *</label>
              <select
                value={form.payment_mode}
                onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2 bg-white"
              >
                <option value="upi">UPI / Online (GPay / PhonePe / Paytm)</option>
                <option value="bank_transfer">Bank Transfer / NEFT / RTGS</option>
                <option value="cheque">Cheque / Demand Draft</option>
                <option value="cash">Cash Counter Receipt</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">UTR / Reference / Cheque #</label>
              <input
                type="text"
                value={form.reference_txn_id}
                onChange={(e) => setForm({ ...form, reference_txn_id: e.target.value })}
                placeholder="e.g. UPI/20261119/992837461"
                className="w-full border border-slate-300 rounded-lg p-2 bg-white font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Allocate to Open GST Invoice</label>
              <select
                value={form.invoice_id}
                onChange={(e) => handleInvoiceChangeInForm(e.target.value)}
                className="w-full border border-slate-300 rounded-lg p-2 bg-white"
              >
                <option value="">Leave as Unallocated Customer Advance</option>
                {invoiceBalances
                  .filter((i) => !form.customer_id || i.customer_id === form.customer_id)
                  .map((inv) => {
                    const invId = inv.invoice_id || inv.id;
                    const total = parseFloat(inv.total_invoice_value || 0).toFixed(2);
                    const due = parseFloat(inv.outstanding_balance || 0).toFixed(2);
                    return (
                      <option key={invId} value={invId}>
                        {inv.invoice_number} (Total: ₹{total} | Due: ₹{due})
                      </option>
                    );
                  })}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Amount Received (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={form.amount}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setForm({ ...form, amount: val, allocated_amount: val });
                }}
                className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold bg-white text-emerald-700 text-sm"
              />
            </div>
          </div>

          {/* Real-time Balance Preview */}
          {(() => {
            const selectedInv = invoiceBalances.find((i) => (i.invoice_id || i.id) === form.invoice_id);
            if (!selectedInv) return null;
            const invoiceVal = parseFloat(selectedInv.total_invoice_value || 0);
            const currentDue = parseFloat(selectedInv.outstanding_balance || 0);
            const thisPayment = Number(form.amount || 0);
            const balanceAfter = Math.max(0, currentDue - thisPayment);

            return (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 font-mono text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Invoice Total:</span>
                  <span className="font-bold text-slate-900">₹{invoiceVal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Current Outstanding Balance:</span>
                  <span className="font-bold text-rose-600">₹{currentDue.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-semibold border-t border-slate-200 pt-1">
                  <span>This Receipt Payment:</span>
                  <span>- ₹{thisPayment.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-900 font-bold border-t border-slate-200 pt-1 text-sm">
                  <span>New Outstanding Balance:</span>
                  <span className={balanceAfter > 0 ? 'text-amber-600' : 'text-emerald-600'}>
                    ₹{balanceAfter.toFixed(2)}
                  </span>
                </div>
              </div>
            );
          })()}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Internal Notes & Remarks</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2 bg-white"
            />
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {submitting ? 'Posting Receipt...' : 'Post Customer Receipt'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ALLOCATE ADVANCE MODAL */}
      <Modal
        isOpen={allocateModalOpen}
        onClose={() => setAllocateModalOpen(false)}
        title={`Allocate Advance — ${selectedPayment?.receipt_number || selectedPayment?.reference_number || 'Receipt'}`}
      >
        <form onSubmit={handleAllocate} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Target Open GST Invoice *</label>
            <select
              required
              value={allocForm.invoice_id}
              onChange={(e) => setAllocForm({ ...allocForm, invoice_id: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2 bg-white"
            >
              <option value="">Select Invoice...</option>
              {invoiceBalances
                .filter((i) => i.customer_id === selectedPayment?.customer_id && parseFloat(i.outstanding_balance || 0) > 0)
                .map((inv) => {
                  const invId = inv.invoice_id || inv.id;
                  return (
                    <option key={invId} value={invId}>
                      {inv.invoice_number} (Outstanding: ₹{parseFloat(inv.outstanding_balance || 0).toFixed(2)})
                    </option>
                  );
                })}
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Allocation Amount (₹) *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={allocForm.allocated_amount}
              onChange={(e) => setAllocForm({ ...allocForm, allocated_amount: e.target.value })}
              className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold bg-white"
            />
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setAllocateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">
              Allocate to Invoice
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
