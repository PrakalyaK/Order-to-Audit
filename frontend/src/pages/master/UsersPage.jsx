import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { Card, Button, Badge, LoadingSpinner, EmptyState } from '../../components/ui';
import { UserCheck, Shield, Phone, Calendar } from 'lucide-react';

export const UsersPage = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.get('/users');
      if (res.success && res.data) {
        setUsers(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const getRoleBadge = (role) => {
    switch (role) {
      case 'owner':
        return <Badge variant="purple">Managing Director</Badge>;
      case 'factory_admin':
        return <Badge variant="primary">Factory Admin</Badge>;
      case 'production_supervisor':
        return <Badge variant="warning">Floor Supervisor</Badge>;
      case 'salesman':
        return <Badge variant="success">Sales Representative</Badge>;
      case 'auditor':
        return <Badge variant="danger">Statutory Auditor</Badge>;
      default:
        return <Badge>{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">User Access & RBAC Directory</h1>
          <p className="text-xs text-slate-500 mt-1">
            Registered operator accounts with statutory privilege roles
          </p>
        </div>
      </div>

      <Card>
        {loading ? (
          <LoadingSpinner text="Fetching user accounts from PostgreSQL..." />
        ) : error ? (
          <div className="text-rose-600 text-xs p-4 text-center">{error}</div>
        ) : users.length === 0 ? (
          <EmptyState message="No users found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Operator Name</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Assigned Role</th>
                  <th className="py-3 px-4">Contact Phone</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">{u.full_name}</td>
                    <td className="py-3 px-4 font-mono font-medium text-blue-600">{u.username}</td>
                    <td className="py-3 px-4">{getRoleBadge(u.role)}</td>
                    <td className="py-3 px-4 text-slate-600">{u.phone || '-'}</td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">
                      {new Date(u.created_at).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={u.is_active ? 'success' : 'danger'}>
                        {u.is_active ? 'Active' : 'Suspended'}
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
  );
};
