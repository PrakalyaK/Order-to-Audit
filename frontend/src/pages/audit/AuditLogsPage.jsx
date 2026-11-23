import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, Modal, EmptyState } from '../../components/ui';
import { ShieldCheck, Search, Filter, Eye, Lock, ArrowRight, RefreshCw } from 'lucide-react';

export const AuditLogsPage = () => {
  const [logs, setLogs] = useState([]);
  const [entities, setEntities] = useState([]);
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 50, totalPages: 1 });

  // Filters
  const [entityName, setEntityName] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Diff Modal
  const [selectedLog, setSelectedLog] = useState(null);
  const [diffModalOpen, setDiffModalOpen] = useState(false);

  const fetchFilters = async () => {
    try {
      const res = await api.get('/audit/filters');
      if (res.success && res.data) {
        setEntities(res.data.entities || []);
        setActions(res.data.actions || []);
      }
    } catch (err) {
      console.error('Failed to load audit filters:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError('');
      const params = { page, limit: 50 };
      if (entityName) params.entity_name = entityName;
      if (action) params.action = action;
      if (search) params.search = search;

      const res = await api.get('/audit/logs', { params });
      if (res.success && res.data) {
        setLogs(res.data);
        if (res.meta) setMeta(res.meta);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilters();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [page, entityName, action, search]);

  const handleInspectDiff = (log) => {
    setSelectedLog(log);
    setDiffModalOpen(true);
  };

  const getActionBadge = (act) => {
    if (act?.startsWith('INSERT')) return <Badge variant="success">{act}</Badge>;
    if (act?.startsWith('UPDATE')) return <Badge variant="warning">{act}</Badge>;
    if (act?.startsWith('DELETE')) return <Badge variant="danger">{act}</Badge>;
    return <Badge variant="primary">{act}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Statutory Tamper-Proof Audit Trail
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              <Lock className="w-3 h-3" />
              Append-Only Immutability
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Cryptographic ledger tracking all database state mutations, user logins, and statutory transactions
          </p>
        </div>
        <Button onClick={fetchLogs} variant="outline" size="sm" icon={RefreshCw} loading={loading}>
          Refresh Audit Trail
        </Button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search by entity ID, action, user..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={entityName}
            onChange={(e) => {
              setEntityName(e.target.value);
              setPage(1);
            }}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Tables / Entities</option>
            {entities.map((ent) => (
              <option key={ent} value={ent}>
                {ent}
              </option>
            ))}
          </select>

          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Actions</option>
            {actions.map((act) => (
              <option key={act} value={act}>
                {act}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Audit Trail Table */}
      <Card>
        {loading ? (
          <LoadingSpinner text="Reading immutable audit trail..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : logs.length === 0 ? (
          <EmptyState message="No audit records match the selected filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Log ID</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Operator</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity / Table</th>
                  <th className="py-3 px-4">Record ID</th>
                  <th className="py-3 px-4 text-center">Diff Inspection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-500">#{log.id}</td>
                    <td className="py-2.5 px-4 text-slate-600 text-[11px] font-mono">
                      {new Date(log.created_at).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="font-semibold text-slate-900 block">{log.username || 'System Engine'}</span>
                      <span className="text-[10px] text-slate-400 capitalize">{log.user_role?.replace('_', ' ') || 'Internal'}</span>
                    </td>
                    <td className="py-2.5 px-4">{getActionBadge(log.action)}</td>
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-800">{log.entity_name}</td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                      {log.entity_id ? log.entity_id.substring(0, 13) + '...' : '-'}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        icon={Eye}
                        onClick={() => handleInspectDiff(log)}
                      >
                        Inspect Diff
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>
                Showing page {meta.page} of {meta.totalPages} ({meta.total} total immutable records)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={meta.page >= meta.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* JSON Diff Modal */}
      <Modal
        isOpen={diffModalOpen}
        onClose={() => setDiffModalOpen(false)}
        title={`Audit State Mutation — Log #${selectedLog?.id} (${selectedLog?.action})`}
        maxWidth="max-w-4xl"
      >
        {selectedLog && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Entity</span>
                <span className="font-semibold text-slate-900 font-mono">{selectedLog.entity_name}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Record ID</span>
                <span className="font-mono text-slate-800 truncate block">{selectedLog.entity_id || '-'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Operator</span>
                <span className="font-semibold text-slate-900">{selectedLog.username || 'System Function'}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Old Values */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-rose-50 border-b border-rose-200 font-semibold text-rose-900 text-[11px] uppercase tracking-wider">
                  State Before Mutation (Old Values)
                </div>
                <pre className="p-3 bg-slate-950 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-72">
                  {selectedLog.old_values
                    ? JSON.stringify(selectedLog.old_values, null, 2)
                    : '// No prior record state (New Entry)'}
                </pre>
              </div>

              {/* New Values */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200 font-semibold text-emerald-900 text-[11px] uppercase tracking-wider">
                  State After Mutation (New Values)
                </div>
                <pre className="p-3 bg-slate-950 text-emerald-300 font-mono text-[11px] overflow-x-auto max-h-72">
                  {selectedLog.new_values
                    ? JSON.stringify(selectedLog.new_values, null, 2)
                    : '// Record purged or deleted'}
                </pre>
              </div>
            </div>

            <div className="pt-3 flex justify-between items-center border-t border-slate-100">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Trigger: trg_protect_audit_logs (Strict Append-Only)
              </span>
              <Button variant="secondary" onClick={() => setDiffModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
