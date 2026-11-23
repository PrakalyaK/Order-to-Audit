import React from 'react';
import { useAuth, DEMO_PERSONAS } from '../../context/AuthContext';
import { LogOut, Shield, ChevronDown, CheckCircle2, UserCircle2 } from 'lucide-react';

export const Header = () => {
  const { user, logout, demoLogin } = useAuth();

  const handleRoleChange = async (e) => {
    const selectedUsername = e.target.value;
    if (selectedUsername && selectedUsername !== user?.username) {
      await demoLogin(selectedUsername);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200/60">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Order-to-Audit ERP • v1.0.0 Production</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Fast Role Persona Switcher for evaluation */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
          <Shield className="w-3.5 h-3.5 text-blue-600" />
          <span className="text-xs text-slate-500 font-medium hidden sm:inline">Active Role:</span>
          <select
            value={user?.username || ''}
            onChange={handleRoleChange}
            aria-label="Switch Active Persona"
            className="text-xs font-semibold text-slate-800 bg-transparent border-none focus:outline-none cursor-pointer"
          >
            {DEMO_PERSONAS.map((p) => (
              <option key={p.username} value={p.username}>
                {p.label} [{p.role}]
              </option>
            ))}
          </select>
        </div>

        {/* User Details */}
        <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
          <div className="text-right hidden md:block">
            <div className="text-xs font-bold text-slate-800">{user?.fullName || user?.username}</div>
            <div className="text-[10px] text-slate-500 capitalize">{user?.role?.replace('_', ' ')}</div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
