import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const Forbidden = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mb-4 shadow-sm">
        <ShieldAlert className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">403 — Statutory Access Restricted</h1>
      <p className="mt-2 text-sm text-slate-600 max-w-md">
        Your active role (<span className="font-semibold text-rose-700 uppercase">{user?.role}</span>) does not have statutory clearance to access this ERP module under the current Role-Based Access Control matrix.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Return to Dashboard
        </button>
      </div>
    </div>
  );
};
