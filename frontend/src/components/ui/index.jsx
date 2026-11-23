import React from 'react';
import { Loader2 } from 'lucide-react';

export const Card = ({ title, subtitle, action, children, className = '' }) => (
  <div className={`bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden ${className}`}>
    {(title || action) && (
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          {title && <h3 className="font-semibold text-slate-800 text-base">{title}</h3>}
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

export const StatCard = ({ title, value, icon: Icon, change, trend = 'up', color = 'blue', subtitle }) => {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100',
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm hover:shadow transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</span>
        {Icon && (
          <div className={`p-2.5 rounded-lg border ${colorMap[color] || colorMap.blue}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
      <div className="mt-3">
        <div className="text-2xl font-bold text-slate-900 tracking-tight">{value}</div>
        {(change || subtitle) && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            {change && (
              <span className={`font-medium ${trend === 'up' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {change}
              </span>
            )}
            {subtitle && <span>{subtitle}</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  className = '',
  ...props
}) => {
  const base = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const sizeMap = {
    sm: 'px-2.5 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-base gap-2.5',
  };

  const variantMap = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 shadow-sm',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-800 focus:ring-slate-300',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white focus:ring-rose-500 shadow-sm',
    outline: 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 focus:ring-blue-500',
    ghost: 'hover:bg-slate-100 text-slate-700 focus:ring-slate-300',
  };

  return (
    <button
      className={`${base} ${sizeMap[size]} ${variantMap[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : Icon ? (
        <Icon className="w-4 h-4" />
      ) : null}
      {children}
    </button>
  );
};

export const Badge = ({ children, variant = 'default', size = 'sm' }) => {
  const map = {
    default: 'bg-slate-100 text-slate-700 border-slate-200',
    primary: 'bg-blue-50 text-blue-700 border-blue-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[variant] || map.default}`}>
      {children}
    </span>
  );
};

export const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-2xl' }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-white rounded-xl shadow-xl w-full ${maxWidth} overflow-hidden transform transition-all`}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

export const LoadingSpinner = ({ text = 'Loading data...' }) => (
  <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    <span className="text-sm font-medium">{text}</span>
  </div>
);

export const EmptyState = ({ message = 'No records found', action }) => (
  <div className="text-center py-12 px-4">
    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-400 mb-3">
      📁
    </div>
    <h3 className="text-sm font-medium text-slate-700">{message}</h3>
    {action && <div className="mt-4">{action}</div>}
  </div>
);
