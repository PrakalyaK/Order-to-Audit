import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { Receipt, Eye, Printer, Truck, Search, ShieldCheck } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const InvoicesPage = () => {
  const { hasRole } = useAuth();
  const canDispatch = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/invoices');
      if (res.success && res.data) {
        setInvoices(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const handleViewInvoice = async (id) => {
    try {
      const res = await api.get(`/invoices/${id}`);
      if (res.success && res.data) {
        setSelectedInvoice(res.data);
        setInvoiceModalOpen(true);
      }
    } catch (err) {
      alert(`Failed to load invoice: ${err.message}`);
    }
  };

  const handleDispatch = async (inv) => {
    if (!window.confirm(`Create dispatch note and deduct inventory for invoice ${inv.invoice_number}?`)) {
      return;
    }
    try {
      // 1. Create dispatch
      const dispatchRes = await api.post('/dispatches', { invoice_id: inv.id });
      if (dispatchRes.success && dispatchRes.data?.id) {
        // 2. Post dispatch (deducts stock)
        await api.post(`/dispatches/${dispatchRes.data.id}/post`);
        alert('Dispatch executed! Inventory deducted at Moving WAC and invoice updated.');
        fetchInvoices();
      }
    } catch (err) {
      alert(`Dispatch error: ${err.message}`);
    }
  };

  const filteredInvoices = invoices.filter(
    (i) =>
      i.invoice_number?.toLowerCase().includes(search.toLowerCase()) ||
      i.customer_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">GST Tax Invoices & Billing</h1>
          <p className="text-xs text-slate-500 mt-1">
            Statutory tax invoices complying with Indian GST rules, CGST/SGST/IGST tax allocation, and customer receivables
          </p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
        <div className="relative w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by invoice # or customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching tax invoices..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : filteredInvoices.length === 0 ? (
          <EmptyState message="No tax invoices found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Invoice Number</th>
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Invoice Date</th>
                  <th className="py-3 px-4 text-right">Taxable Subtotal</th>
                  <th className="py-3 px-4 text-right">GST Total</th>
                  <th className="py-3 px-4 text-right">Invoice Total</th>
                  <th className="py-3 px-4 text-right">Paid Amount</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map((inv) => {
                  const gstTotal =
                    parseFloat(inv.cgst_amount || 0) +
                    parseFloat(inv.sgst_amount || 0) +
                    parseFloat(inv.igst_amount || 0);
                  const total = parseFloat(inv.total_amount || 0);
                  const paid = parseFloat(inv.paid_amount || 0);

                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">{inv.invoice_number}</td>
                      <td className="py-3 px-4 font-semibold text-slate-900">{inv.customer_name}</td>
                      <td className="py-3 px-4 text-slate-500">{inv.invoice_date}</td>
                      <td className="py-3 px-4 text-right font-medium">
                        ₹{parseFloat(inv.subtotal_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-500">
                        ₹{gstTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        ₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-emerald-600">
                        ₹{paid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'dispatched' ? 'purple' : 'primary'}>
                          {inv.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            icon={Eye}
                            onClick={() => handleViewInvoice(inv.id)}
                          >
                            Tax Invoice
                          </Button>
                          {canDispatch && inv.status === 'posted' && (
                            <Button
                              variant="primary"
                              size="sm"
                              icon={Truck}
                              onClick={() => handleDispatch(inv)}
                            >
                              Dispatch
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

      {/* Statutory Tax Invoice Printable Document Modal */}
      <Modal
        isOpen={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        title={`Tax Invoice — ${selectedInvoice?.invoice_number}`}
        maxWidth="max-w-4xl"
      >
        {selectedInvoice && (
          <div className="space-y-6 text-xs p-2" id="printable-tax-invoice">
            {/* Invoice Top Header */}
            <div className="border-b-2 border-slate-900 pb-4 flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 uppercase">
                  ORDER-TO-AUDIT FOODS PVT LTD
                </h2>
                <p className="text-slate-600 mt-0.5">Plot 42, Food Processing SEZ, SIPCOT Industrial Park</p>
                <p className="text-slate-600">Chennai, Tamil Nadu, 600001</p>
                <p className="font-mono text-slate-800 font-bold mt-1">
                  GSTIN: 33AAAAA0000A1Z5 • State Code: 33
                </p>
              </div>
              <div className="text-right">
                <div className="inline-block px-3 py-1 bg-slate-900 text-white font-bold text-xs uppercase tracking-wider rounded">
                  TAX INVOICE
                </div>
                <div className="mt-2 font-mono font-bold text-slate-900 text-sm">
                  {selectedInvoice.invoice_number}
                </div>
                <div className="text-slate-500">Date: {selectedInvoice.invoice_date}</div>
              </div>
            </div>

            {/* Bill To & Ship To */}
            <div className="grid grid-cols-2 gap-6 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  Billed To (Customer Details)
                </span>
                <p className="font-bold text-slate-900 text-sm">{selectedInvoice.customer_name}</p>
                <p className="text-slate-600">{selectedInvoice.customer_address || 'Main Road, Commercial Complex'}</p>
                <p className="text-slate-600">{selectedInvoice.customer_state || 'Tamil Nadu'}</p>
                <p className="font-mono text-slate-800 font-semibold mt-1">
                  GSTIN: {selectedInvoice.customer_gstin || 'UNREGISTERED'}
                </p>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  Invoice Summary & Balances
                </span>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment Status:</span>
                    <Badge variant={selectedInvoice.status === 'paid' ? 'success' : 'primary'}>
                      {selectedInvoice.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Paid to Date:</span>
                    <span className="font-mono font-medium text-emerald-600">
                      ₹{parseFloat(selectedInvoice.paid_amount || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Balance Due:</span>
                    <span className="font-mono font-bold text-rose-600">
                      ₹{(
                        parseFloat(selectedInvoice.total_amount || 0) -
                        parseFloat(selectedInvoice.paid_amount || 0)
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-100 text-slate-800 uppercase font-semibold text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Description of Goods</th>
                    <th className="py-2.5 px-3 font-mono">HSN Code</th>
                    <th className="py-2.5 px-3 text-right">Quantity</th>
                    <th className="py-2.5 px-3 text-right">Rate (₹)</th>
                    <th className="py-2.5 px-3 text-right">Taxable Value (₹)</th>
                    <th className="py-2.5 px-3 text-right">GST %</th>
                    <th className="py-2.5 px-3 text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedInvoice.items?.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        {item.item_name}
                        <span className="text-[10px] text-slate-400 block font-mono">{item.item_sku}</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono">{item.hsn_code || '1905'}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium">
                        {parseFloat(item.quantity).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        ₹{parseFloat(item.unit_price).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        ₹{parseFloat(item.taxable_amount || item.quantity * item.unit_price).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{item.gst_rate_pct || 12}%</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        ₹{parseFloat(item.total_amount).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tax Computation Breakdown */}
            <div className="flex justify-end">
              <div className="w-72 space-y-1.5 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Taxable Subtotal:</span>
                  <span className="font-mono font-medium">
                    ₹{parseFloat(selectedInvoice.subtotal_amount).toFixed(2)}
                  </span>
                </div>
                {parseFloat(selectedInvoice.cgst_amount || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">CGST (Central Tax):</span>
                    <span className="font-mono font-medium">
                      ₹{parseFloat(selectedInvoice.cgst_amount).toFixed(2)}
                    </span>
                  </div>
                )}
                {parseFloat(selectedInvoice.sgst_amount || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">SGST (State Tax):</span>
                    <span className="font-mono font-medium">
                      ₹{parseFloat(selectedInvoice.sgst_amount).toFixed(2)}
                    </span>
                  </div>
                )}
                {parseFloat(selectedInvoice.igst_amount || 0) > 0 && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-500">IGST (Integrated Tax):</span>
                    <span className="font-mono font-medium">
                      ₹{parseFloat(selectedInvoice.igst_amount).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-t-2 border-slate-900 text-sm font-bold text-slate-900">
                  <span>Total Invoiced Amount:</span>
                  <span className="font-mono">
                    ₹{parseFloat(selectedInvoice.total_amount).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-4 flex justify-between items-center border-t border-slate-200">
              <Button
                variant="outline"
                size="sm"
                icon={Printer}
                onClick={() => window.print()}
              >
                Print Official GST Invoice
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setInvoiceModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
