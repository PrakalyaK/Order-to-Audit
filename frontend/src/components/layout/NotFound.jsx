import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mb-4 shadow-sm">
        <AlertCircle className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 tracking-tight">404 — Page Not Found</h1>
      <p className="mt-2 text-sm text-slate-600 max-w-md">
        The requested ERP resource or route could not be found. Please check your URL or return to the main dashboard.
      </p>
      <div className="mt-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Go to Dashboard
        </button>
      </div>
    </div>
  );
};
