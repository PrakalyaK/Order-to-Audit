import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, DEMO_PERSONAS } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { LogOut, Shield, Bell, CheckCheck, ExternalLink, Languages } from 'lucide-react';
import api from '../../api/client';

export const Header = () => {
  const { user, logout, demoLogin } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();
  const [errorMsg, setErrorMsg] = useState(null);

  // Notification states
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const dropdownRef = useRef(null);

  const fetchNotifications = async () => {
    if (!user) return;
    try {
      setLoadingNotifs(true);
      const res = await api.get('/notifications?limit=15');
      if (res.success && Array.isArray(res.data)) {
        setNotifications(res.data);
        const unread = res.data.filter((n) => !n.is_read).length;
        setUnreadCount(unread);
      }
    } catch (err) {
      // Silently ignore notification fetch errors in background
    } finally {
      setLoadingNotifs(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000); // Poll every 20s
    return () => clearInterval(interval);
  }, [user]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAsRead = async (id, actionUrl) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      if (actionUrl) {
        setDropdownOpen(false);
        navigate(actionUrl);
      }
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.patch('/notifications/mark-all-read');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
    }
  };

  const handleRoleChange = async (e) => {
    const selectedUsername = e.target.value;
    if (selectedUsername && selectedUsername !== user?.username) {
      try {
        setErrorMsg(null);
        await demoLogin(selectedUsername);
        navigate('/dashboard');
      } catch (err) {
        const msg = err.message || 'Failed to switch user persona';
        setErrorMsg(msg);
        alert(`Role switch error: ${msg}`);
      }
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200/60">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>{t('productionBadge')}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {/* Language Selector: English / Tamil */}
        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1">
          <Languages className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Language Selector"
            className="text-xs font-semibold text-slate-800 bg-transparent border-none focus:outline-none cursor-pointer"
          >
            <option value="en">English</option>
            <option value="ta">தமிழ் (Tamil)</option>
          </select>
        </div>

        {/* Fast Role Persona Switcher for evaluation */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1">
          <Shield className="w-3.5 h-3.5 text-blue-600" />
          <span className="text-xs text-slate-500 font-medium hidden sm:inline">{t('activeRole')}:</span>
          <select
            value={user?.username || ''}
            onChange={handleRoleChange}
            aria-label="Switch Active Persona"
            className="text-xs font-semibold text-slate-800 bg-transparent border-none focus:outline-none cursor-pointer"
          >
            {DEMO_PERSONAS.map((p) => {
              let localizedLabel = p.label;
              if (p.role === 'owner') localizedLabel = t('roleOwner');
              else if (p.role === 'factory_admin') localizedLabel = t('roleAdmin');
              else if (p.role === 'production_supervisor') localizedLabel = t('roleSupervisor');
              else if (p.role === 'salesman') localizedLabel = t('roleSalesman');
              else if (p.role === 'auditor') localizedLabel = t('roleAuditor');

              return (
                <option key={p.username} value={p.username}>
                  {localizedLabel} [{p.role}]
                </option>
              );
            })}
          </select>
        </div>

        {/* Notifications Bell Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => {
              setDropdownOpen(!dropdownOpen);
              if (!dropdownOpen) fetchNotifications();
            }}
            title="Notifications"
            className="relative p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors focus:outline-none"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-xs animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-slate-200/90 py-2 z-50 overflow-hidden animate-in fade-in-50 duration-150">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs text-slate-900 uppercase tracking-wider">
                    {t('notifications')}
                  </span>
                  {unreadCount > 0 && (
                    <span className="bg-rose-100 text-rose-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-[11px] font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
                  >
                    <CheckCheck className="w-3 h-3" /> {t('markAllRead')}
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 text-xs">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-slate-400">
                    {t('noNotifications')}
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => handleMarkAsRead(notif.id, notif.action_url)}
                      className={`p-3.5 cursor-pointer hover:bg-slate-50 transition-colors flex items-start gap-2.5 ${
                        !notif.is_read ? 'bg-blue-50/50' : ''
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className={`font-semibold ${!notif.is_read ? 'text-blue-900' : 'text-slate-700'}`}>
                            {notif.title}
                          </span>
                          <span className="text-[10px] text-slate-400 whitespace-nowrap">
                            {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-slate-600 text-[11px] leading-relaxed line-clamp-2">
                          {notif.message}
                        </p>
                      </div>
                      {notif.action_url && (
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
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
