import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { BookOpen, Plus, Scale, DollarSign, FileSpreadsheet, CheckCircle2, ChevronRight } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const AccountingPage = () => {
  const { hasRole } = useAuth();
  const canPostJournals = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [activeTab, setActiveTab] = useState('tb'); // 'tb' | 'accounts' | 'journals' | 'pl'
  const [trialBalance, setTrialBalance] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [plData, setPlData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Manual Journal Entry Modal
  const [journalModalOpen, setJournalModalOpen] = useState(false);
  const [journalForm, setJournalForm] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    description: 'Year-end statutory adjustment',
    reference: 'JV-MANUAL-001',
    lines: [
      { account_id: '', debit: 1000, credit: 0, description: 'Debit entry' },
      { account_id: '', debit: 0, credit: 1000, description: 'Credit entry' },
    ],
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [tbRes, accRes, jvRes, plRes] = await Promise.all([
        api.get('/accounting/trial-balance'),
        api.get('/accounting/accounts'),
        api.get('/accounting/journal-entries'),
        api.get('/accounting/profit-and-loss'),
      ]);

      if (tbRes.success) setTrialBalance(tbRes.data || []);
      if (accRes.success) setAccounts(accRes.data || []);
      if (jvRes.success) setJournalEntries(jvRes.data || []);
      if (plRes.success) setPlData(plRes.data || []);
    } catch (err) {
      setError(err.message || 'Failed to fetch financial accounting books');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddJournalLine = () => {
    setJournalForm({
      ...journalForm,
      lines: [...journalForm.lines, { account_id: '', debit: 0, credit: 0, description: '' }],
    });
  };

  const handleJournalLineChange = (index, field, value) => {
    const updated = [...journalForm.lines];
    updated[index][field] = value;
    setJournalForm({ ...journalForm, lines: updated });
  };

  const handleCreateJournal = async (e) => {
    e.preventDefault();
    const totalDebit = journalForm.lines.reduce((acc, l) => acc + (Number(l.debit) || 0), 0);
    const totalCredit = journalForm.lines.reduce((acc, l) => acc + (Number(l.credit) || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      alert(`Double-entry rule violation: Total debits (₹${totalDebit}) must equal total credits (₹${totalCredit}).`);
      return;
    }

    try {
      const payload = {
        entry_date: journalForm.entry_date,
        description: journalForm.description,
        reference: journalForm.reference,
        lines: journalForm.lines.map((l) => ({
          account_id: l.account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description,
        })),
      };
      await api.post('/accounting/journal-entries', payload);
      alert('Journal entry posted successfully into General Ledger.');
      setJournalModalOpen(false);
      fetchData();
    } catch (err) {
      alert(`Journal posting failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Financial Accounting & General Ledger</h1>
          <p className="text-xs text-slate-500 mt-1">
            Double-entry statutory books, Chart of Accounts, Journal Vouchers, and automated Trial Balance
          </p>
        </div>
        {canPostJournals && (
          <Button onClick={() => setJournalModalOpen(true)} icon={Plus} size="sm">
            Post Journal Entry
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('tb')}
          className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'tb'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Trial Balance
        </button>
        <button
          onClick={() => setActiveTab('accounts')}
          className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'accounts'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Chart of Accounts
        </button>
        <button
          onClick={() => setActiveTab('journals')}
          className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'journals'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Journal Entries
        </button>
        <button
          onClick={() => setActiveTab('pl')}
          className={`py-2 px-4 text-xs font-semibold border-b-2 transition ${
            activeTab === 'pl'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Profit & Loss Statement
        </button>
      </div>

      {/* Trial Balance Tab */}
      {activeTab === 'tb' && (
        <Card title="Statutory Trial Balance" subtitle="Verifies double-entry equilibrium across all accounts">
          {loading ? (
            <LoadingSpinner text="Summing debit and credit balances..." />
          ) : error ? (
            <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
          ) : trialBalance.length === 0 ? (
            <EmptyState message="No balance recorded in ledger" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Account Name</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4 text-right">Debit Balance (₹)</th>
                    <th className="py-3 px-4 text-right">Credit Balance (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trialBalance.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">{row.account_code}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-900">{row.account_name}</td>
                      <td className="py-2.5 px-4 capitalize text-slate-500">{row.account_type}</td>
                      <td className="py-2.5 px-4 text-right font-mono font-medium">
                        {parseFloat(row.net_debit_balance || 0) > 0
                          ? `₹${parseFloat(row.net_debit_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                          : '-'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-medium">
                        {parseFloat(row.net_credit_balance || 0) > 0
                          ? `₹${parseFloat(row.net_credit_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Chart of Accounts Tab */}
      {activeTab === 'accounts' && (
        <Card title="Chart of Accounts Master" subtitle="Standard 4-digit code structure for manufacturing ERP">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Account Code</th>
                  <th className="py-3 px-4">Account Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Normal Balance</th>
                  <th className="py-3 px-4 text-center">System Protected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">{acc.code}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{acc.name}</td>
                    <td className="py-2.5 px-4 uppercase text-[10px] font-bold">
                      <Badge variant={acc.account_type === 'asset' ? 'primary' : acc.account_type === 'liability' ? 'warning' : 'purple'}>
                        {acc.account_type}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{acc.category}</td>
                    <td className="py-2.5 px-4 font-mono uppercase text-[11px]">{acc.normal_balance}</td>
                    <td className="py-2.5 px-4 text-center">
                      <Badge variant={acc.is_system ? 'default' : 'success'}>
                        {acc.is_system ? 'System' : 'Custom'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Journal Entries Tab */}
      {activeTab === 'journals' && (
        <Card title="Journal Vouchers" subtitle="General Ledger transactional postings">
          {journalEntries.length === 0 ? (
            <EmptyState message="No manual journal entries recorded yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Entry Number</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">Reference</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {journalEntries.map((jv) => (
                    <tr key={jv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-blue-600">{jv.entry_number}</td>
                      <td className="py-3 px-4 text-slate-500">{jv.entry_date}</td>
                      <td className="py-3 px-4 font-medium text-slate-900">{jv.description}</td>
                      <td className="py-3 px-4 font-mono text-[11px]">{jv.reference || '-'}</td>
                      <td className="py-3 px-4 text-center">
                        <Badge variant="success">{jv.status || 'POSTED'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Profit & Loss Tab */}
      {activeTab === 'pl' && (
        <Card title="Profit & Loss Statement" subtitle="Operational revenues, cost of goods sold, and operating income">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">P&L Head / Account</th>
                  <th className="py-3 px-4">Classification</th>
                  <th className="py-3 px-4 text-right">Net Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-600">{row.account_code}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{row.account_name}</td>
                    <td className="py-2.5 px-4 uppercase text-[10px] font-bold">
                      <Badge variant={row.account_type === 'revenue' ? 'success' : 'rose'}>
                        {row.account_type}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                      ₹{parseFloat(row.net_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Manual Journal Entry Modal */}
      <Modal
        isOpen={journalModalOpen}
        onClose={() => setJournalModalOpen(false)}
        title="Post Double-Entry Journal Voucher"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleCreateJournal} className="space-y-4 text-xs">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Posting Date *</label>
              <input
                type="date"
                required
                value={journalForm.entry_date}
                onChange={(e) => setJournalForm({ ...journalForm, entry_date: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Reference Code</label>
              <input
                type="text"
                value={journalForm.reference}
                onChange={(e) => setJournalForm({ ...journalForm, reference: e.target.value })}
                placeholder="e.g. JV-DEC-001"
                className="w-full border border-slate-300 rounded-lg p-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Narration / Memo *</label>
              <input
                type="text"
                required
                value={journalForm.description}
                onChange={(e) => setJournalForm({ ...journalForm, description: e.target.value })}
                placeholder="Reason for adjustment"
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
                Double-Entry Lines (Must Balance)
              </span>
              <Button type="button" variant="outline" size="sm" onClick={handleAddJournalLine}>
                + Add Line
              </Button>
            </div>
            <div className="space-y-2">
              {journalForm.lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="col-span-5">
                    <label className="text-[10px] text-slate-400 block">GL Account</label>
                    <select
                      required
                      value={line.account_id}
                      onChange={(e) => handleJournalLineChange(idx, 'account_id', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs"
                    >
                      <option value="">Select GL Account...</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name} ({a.account_type})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] text-slate-400 block">Debit (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={line.debit}
                      onChange={(e) => handleJournalLineChange(idx, 'debit', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs font-mono"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] text-slate-400 block">Credit (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={line.credit}
                      onChange={(e) => handleJournalLineChange(idx, 'credit', e.target.value)}
                      className="w-full border border-slate-300 rounded p-1.5 text-xs font-mono"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setJournalModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Post to General Ledger</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
