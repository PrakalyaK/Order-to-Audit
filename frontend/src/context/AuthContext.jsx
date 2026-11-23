import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

export const ROLES = {
  OWNER: 'owner',
  FACTORY_ADMIN: 'factory_admin',
  PRODUCTION_SUPERVISOR: 'production_supervisor',
  SALESMAN: 'salesman',
  AUDITOR: 'auditor',
};

export const DEMO_PERSONAS = [
  { username: 'owner_main', role: ROLES.OWNER, label: 'Managing Director (Owner)', badgeColor: 'bg-purple-100 text-purple-800 border-purple-200' },
  { username: 'admin_factory', role: ROLES.FACTORY_ADMIN, label: 'Factory Admin Desk', badgeColor: 'bg-blue-100 text-blue-800 border-blue-200' },
  { username: 'supervisor_floor', role: ROLES.PRODUCTION_SUPERVISOR, label: 'Floor Supervisor', badgeColor: 'bg-amber-100 text-amber-800 border-amber-200' },
  { username: 'salesman_a', role: ROLES.SALESMAN, label: 'Salesman A (Tamil Nadu)', badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { username: 'auditor_ext', role: ROLES.AUDITOR, label: 'Statutory Auditor', badgeColor: 'bg-rose-100 text-rose-800 border-rose-200' },
];

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('ota_user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem('ota_token') || null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      const savedToken = localStorage.getItem('ota_token');
      if (savedToken) {
        try {
          const res = await api.get('/auth/me');
          if (res.success && res.data?.user) {
            setUser(res.data.user);
            localStorage.setItem('ota_user', JSON.stringify(res.data.user));
          }
        } catch (err) {
          console.error('Session validation failed:', err);
          logout();
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    if (res.success && res.data) {
      const { user: loggedInUser, token: authToken } = res.data;
      setUser(loggedInUser);
      setToken(authToken);
      localStorage.setItem('ota_token', authToken);
      localStorage.setItem('ota_user', JSON.stringify(loggedInUser));
      return loggedInUser;
    }
    throw new Error(res.message || 'Login failed');
  };

  const demoLogin = async (username) => {
    return login(username, 'Password@123');
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('ota_token');
    localStorage.removeItem('ota_user');
  };

  const hasRole = (...allowedRoles) => {
    if (!user || !user.role) return false;
    return allowedRoles.includes(user.role);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!token && !!user,
        login,
        demoLogin,
        logout,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
