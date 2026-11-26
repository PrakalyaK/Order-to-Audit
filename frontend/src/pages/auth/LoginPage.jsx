import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, DEMO_PERSONAS } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ShieldCheck, ArrowRight, Lock, User, AlertCircle, Sparkles, Languages } from 'lucide-react';

export const LoginPage = () => {
  const { login, demoLogin } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const navigate = useNavigate();
  const [username, setUsername] = useState('owner_main');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (personaUsername) => {
    setError('');
    setLoading(true);
    try {
      await demoLogin(personaUsername);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Demo authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      {/* Top Language Switcher Bar */}
      <div className="sm:mx-auto sm:w-full sm:max-w-lg flex justify-end mb-3">
        <div className="inline-flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 rounded-xl p-1 shadow-md">
          <Languages className="w-3.5 h-3.5 text-indigo-400 ml-1.5" />
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
              language === 'en'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => setLanguage('ta')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
              language === 'ta'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            தமிழ்
          </button>
        </div>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white font-bold text-2xl shadow-lg shadow-blue-500/20 mb-4">
          OA
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-white">{t('appName')}</h2>
        <p className="mt-1 text-sm text-slate-400">
          {t('tagline')}
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-lg">
        {/* Quick Role Personas Card */}
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-5 mb-5 shadow-xl">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              {t('quickPersonaLogin')}
            </h3>
          </div>
          <p className="text-xs text-slate-400 mb-3">
            {t('clickToSwitch')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {DEMO_PERSONAS.map((p) => {
              let localizedLabel = p.label;
              if (p.role === 'owner') localizedLabel = t('roleOwner');
              else if (p.role === 'factory_admin') localizedLabel = t('roleAdmin');
              else if (p.role === 'production_supervisor') localizedLabel = t('roleSupervisor');
              else if (p.role === 'salesman') localizedLabel = t('roleSalesman');
              else if (p.role === 'auditor') localizedLabel = t('roleAuditor');

              return (
                <button
                  key={p.username}
                  type="button"
                  onClick={() => handleQuickLogin(p.username)}
                  disabled={loading}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-700 border border-slate-700/60 hover:border-blue-500 text-left transition group"
                >
                  <div>
                    <div className="text-xs font-semibold text-white group-hover:text-blue-300">
                      {localizedLabel}
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase font-mono">{p.role}</div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-400 transition transform group-hover:translate-x-0.5" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Regular Login Form */}
        <div className="bg-white py-8 px-6 shadow-xl rounded-2xl sm:px-10 border border-slate-100">
          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs text-rose-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                {t('username')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. owner_main"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                {t('password')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition"
            >
              {loading ? t('signingIn') : `${t('signIn')} (HS256)`}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              HS256 Tamper-Proof JWT
            </span>
            <span>PostgreSQL 19 Backend</span>
          </div>
        </div>
      </div>
    </div>
  );
};
