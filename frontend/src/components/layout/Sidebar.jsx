import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth, ROLES } from '../../context/AuthContext';
import {
  LayoutDashboard,
  Package,
  FileSpreadsheet,
  Users,
  Warehouse,
  ShoppingBag,
  Boxes,
  Factory,
  ShoppingCart,
  Receipt,
  CreditCard,
  Building2,
  BookOpen,
  BarChart3,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

export const Sidebar = () => {
  const { hasRole, user } = useAuth();

  const navGroups = [
    {
      title: 'Core Operations',
      items: [
        { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.SALESMAN, ROLES.AUDITOR] },
      ],
    },
    {
      title: 'Master Data',
      items: [
        { name: 'Items & Products', path: '/master/items', icon: Package, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.SALESMAN, ROLES.AUDITOR] },
        { name: 'Bill of Materials', path: '/master/boms', icon: FileSpreadsheet, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.SALESMAN, ROLES.AUDITOR] },
        { name: 'Parties (Cust/Supp)', path: '/master/parties', icon: Users, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.SALESMAN, ROLES.AUDITOR] },
        { name: 'Warehouses', path: '/master/warehouses', icon: Warehouse, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR] },
        { name: 'User Management', path: '/master/users', icon: UserCheck, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR] },
      ],
    },
    {
      title: 'Supply & Production',
      items: [
        { name: 'Purchase Bills', path: '/purchases', icon: ShoppingBag, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR] },
        { name: 'Inventory & Batches', path: '/inventory', icon: Boxes, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR] },
        { name: 'Production & Runs', path: '/production', icon: Factory, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR] },
      ],
    },
    {
      title: 'Sales & Receipts',
      items: [
        { name: 'Sales Orders', path: '/sales/orders', icon: ShoppingCart, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN, ROLES.AUDITOR] },
        { name: 'Tax Invoices', path: '/sales/invoices', icon: Receipt, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR] },
        { name: 'Customer Receipts', path: '/payments/customers', icon: CreditCard, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.SALESMAN, ROLES.AUDITOR] },
        { name: 'Supplier Payments', path: '/payments/suppliers', icon: Building2, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR] },
      ],
    },
    {
      title: 'Finance & Compliance',
      items: [
        { name: 'Accounting & GL', path: '/accounting', icon: BookOpen, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR] },
        { name: 'Reports & Analytics', path: '/reports', icon: BarChart3, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.PRODUCTION_SUPERVISOR, ROLES.AUDITOR] },
        { name: 'Audit Trail Logs', path: '/audit', icon: ShieldCheck, roles: [ROLES.OWNER, ROLES.FACTORY_ADMIN, ROLES.AUDITOR] },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col flex-shrink-0 h-screen sticky top-0 border-r border-slate-800">
      {/* Brand logo & title */}
      <div className="px-6 py-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">
          OA
        </div>
        <div>
          <h1 className="font-bold text-white text-sm tracking-wide">ORDER-TO-AUDIT</h1>
          <p className="text-[10px] text-blue-400 font-medium uppercase tracking-wider">Food Manufacturing ERP</p>
        </div>
      </div>

      {/* Nav list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {navGroups.map((group, idx) => {
          // Filter items based on user's active role
          const visibleItems = group.items.filter((item) => hasRole(...item.roles));
          if (visibleItems.length === 0) return null;

          return (
            <div key={idx} className="space-y-1">
              <div className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                {group.title}
              </div>
              {visibleItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white font-semibold shadow-sm'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span>{item.name}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Role Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40">
        <div className="text-[11px] text-slate-400 font-medium">Logged in persona:</div>
        <div className="text-xs font-semibold text-white truncate mt-0.5">{user?.fullName || user?.username}</div>
        <div className="inline-block mt-1 px-2 py-0.5 bg-blue-900/60 text-blue-300 border border-blue-700/50 rounded text-[10px] uppercase font-bold tracking-wider">
          {user?.role}
        </div>
      </div>
    </aside>
  );
};
