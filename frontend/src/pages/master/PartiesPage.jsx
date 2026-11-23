import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { Users, Plus, Search, Building, UserCheck } from 'lucide-react';
import { useAuth, ROLES } from '../../context/AuthContext';

export const PartiesPage = () => {
  const { hasRole } = useAuth();
  const canManage = hasRole(ROLES.OWNER, ROLES.FACTORY_ADMIN);

  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [partyType, setPartyType] = useState('');
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    party_type: 'customer',
    party_name: '',
    legal_name: '',
    gstin: '',
    pan: '',
    email: '',
    phone: '',
    state_code: '33',
    state_name: 'Tamil Nadu',
    address_line1: '',
    city: 'Chennai',
    pincode: '600001',
    credit_limit: 50000,
    credit_days: 30,
  });

  const fetchParties = async () => {
    try {
      setLoading(true);
      setError('');
      const params = {};
      if (partyType) params.party_type = partyType;
      if (search) params.search = search;
      const res = await api.get('/parties', { params });
      if (res.success && res.data) {
        setParties(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch parties');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParties();
  }, [partyType, search]);

  const handleCreateParty = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/parties', {
        ...form,
        credit_limit: Number(form.credit_limit),
        credit_days: Number(form.credit_days),
      });
      setIsModalOpen(false);
      setForm({
        party_type: 'customer',
        party_name: '',
        legal_name: '',
        gstin: '',
        pan: '',
        email: '',
        phone: '',
        state_code: '33',
        state_name: 'Tamil Nadu',
        address_line1: '',
        city: 'Chennai',
        pincode: '600001',
        credit_limit: 50000,
        credit_days: 30,
      });
      fetchParties();
    } catch (err) {
      alert(`Error creating party: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Parties Master</h1>
          <p className="text-xs text-slate-500 mt-1">
            Statutory registry of Customers, Distributors, and Raw Material Suppliers
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setIsModalOpen(true)} icon={Plus} size="sm">
            Register New Party
          </Button>
        )}
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by party name, GSTIN or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPartyType('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              partyType === '' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Parties
          </button>
          <button
            onClick={() => setPartyType('customer')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              partyType === 'customer' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Customers Only
          </button>
          <button
            onClick={() => setPartyType('supplier')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              partyType === 'supplier' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Suppliers Only
          </button>
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching party records..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : parties.length === 0 ? (
          <EmptyState message="No parties found matching criteria." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Party Name</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">GSTIN / State</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4 text-right">Credit Limit</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parties.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-900 block">{p.party_name}</span>
                      <span className="text-[11px] text-slate-400">{p.legal_name || p.city}</span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant={p.party_type === 'customer' ? 'primary' : 'warning'}>
                        {p.party_type.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-[11px] font-medium text-slate-800 block">
                        {p.gstin || 'UNREGISTERED'}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {p.state_name} ({p.state_code})
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-800 block">{p.phone || '-'}</span>
                      <span className="text-[10px] text-slate-400">{p.email || '-'}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium">
                      ₹{parseFloat(p.credit_limit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={p.is_active ? 'success' : 'default'}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Party Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Register Business Party">
        <form onSubmit={handleCreateParty} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Party Role *</label>
              <select
                value={form.party_type}
                onChange={(e) => setForm({ ...form, party_type: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              >
                <option value="customer">Customer</option>
                <option value="supplier">Supplier</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Trade Name *</label>
              <input
                type="text"
                required
                value={form.party_name}
                onChange={(e) => setForm({ ...form, party_name: e.target.value })}
                placeholder="e.g. Trichy Agro Mill"
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">GSTIN (15 Digits)</label>
              <input
                type="text"
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                placeholder="e.g. 33AAAAA0000A1Z5"
                className="w-full border border-slate-300 rounded-lg p-2 font-mono uppercase"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Phone Number *</label>
              <input
                type="text"
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="e.g. 9840112233"
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">State Code *</label>
              <input
                type="text"
                required
                value={form.state_code}
                onChange={(e) => setForm({ ...form, state_code: e.target.value })}
                placeholder="e.g. 33"
                className="w-full border border-slate-300 rounded-lg p-2 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">State Name *</label>
              <input
                type="text"
                required
                value={form.state_name}
                onChange={(e) => setForm({ ...form, state_name: e.target.value })}
                placeholder="e.g. Tamil Nadu"
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Credit Limit (₹)</label>
              <input
                type="number"
                value={form.credit_limit}
                onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Credit Days</label>
              <input
                type="number"
                value={form.credit_days}
                onChange={(e) => setForm({ ...form, credit_days: e.target.value })}
                className="w-full border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Register Party
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
