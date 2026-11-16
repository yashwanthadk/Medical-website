import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { PublicHeader } from '../components/PublicHeader';
import { PublicFooter } from '../components/PublicFooter';
import { DashboardLayout } from '../components/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

export function ResetPasswordPage() {
  const { user, token, refreshUser } = useAuth();

  // Unauthenticated recovery state
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [issuedPreviewCode, setIssuedPreviewCode] = useState<string | null>(null);

  // Authenticated change-password state
  const [currentPassword, setCurrentPassword] = useState('');

  // Shared new-password fields
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const checks = useMemo(
    () => [
      { label: 'At least 8 characters', met: newPassword.length >= 8 },
      { label: 'One uppercase letter', met: /[A-Z]/.test(newPassword) },
      { label: 'One lowercase letter', met: /[a-z]/.test(newPassword) },
      { label: 'One number', met: /[0-9]/.test(newPassword) },
      { label: 'Passwords match', met: newPassword.length > 0 && newPassword === confirmPassword },
    ],
    [newPassword, confirmPassword]
  );

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const res = await api.forgotPassword(email.trim());
      if (res.verificationCode) {
        setIssuedPreviewCode(res.verificationCode);
      }
      setSuccessMsg(res.message);
      setStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not initiate password reset.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const res = await api.resetPassword({
        email: email.trim(),
        code: code.trim(),
        newPassword,
        confirmPassword,
      });
      setSuccessMsg(res.message);
      setNewPassword('');
      setConfirmPassword('');
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save new password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAuthenticatedNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const res = await api.changePassword(
        {
          currentPassword: user?.hasPassword ? currentPassword : undefined,
          newPassword,
          confirmPassword,
        },
        token
      );
      setSuccessMsg(res.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSubmitting(false);
    }
  };

  const strengthList = (
    <ul className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
      {checks.map((c) => (
        <li
          key={c.label}
          className={`flex items-center gap-1.5 ${
            c.met ? 'text-emerald-700 font-medium' : 'text-slate-500'
          }`}
        >
          <Check className={`h-3.5 w-3.5 ${c.met ? 'text-emerald-600' : 'text-slate-300'}`} />
          <span>{c.label}</span>
        </li>
      ))}
    </ul>
  );

  if (user) {
    return (
      <DashboardLayout
        title="Password & Account Security"
        subtitle="Create or update your MediExplain AI password"
      >
        <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold text-slate-950">
              {user.hasPassword ? 'New Create Password' : 'Create Account Password'}
            </h2>
            <p className="text-sm text-slate-600">
              {user.hasPassword
                ? 'Verify your current password and enter a new password for your account.'
                : 'Your account currently uses Google Sign-In. Create a password below to also sign in with email.'}
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900">
              <AlertCircle className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
              <p>{successMsg}</p>
            </div>
          )}

          <form onSubmit={handleAuthenticatedNewPassword} className="space-y-4">
            {user.hasPassword && (
              <div className="space-y-1.5">
                <label htmlFor="curr-pw" className="block text-sm font-medium text-slate-800">
                  Current password
                </label>
                <input
                  id="curr-pw"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="auth-new-pw" className="block text-sm font-medium text-slate-800">
                New Create Password
              </label>
              <div className="relative">
                <input
                  id="auth-new-pw"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Create a strong new password"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="auth-confirm-pw" className="block text-sm font-medium text-slate-800">
                Confirm New Password
              </label>
              <input
                id="auth-confirm-pw"
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your new password"
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
              />
            </div>

            {strengthList}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>Save New Password</span>
            </button>
          </form>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <PublicHeader />

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 sm:p-8 space-y-6">
          <div className="space-y-1.5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950">
              New Create Password
            </h1>
            <p className="text-sm text-slate-600">
              {step === 'request'
                ? 'Enter your account email to generate a 6-digit verification code and set a new password.'
                : 'Enter your verification code and create your new password.'}
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900">
              <AlertCircle className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          {successMsg && (
            <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                <p>{successMsg}</p>
              </div>
              {issuedPreviewCode && (
                <p className="font-mono text-sm font-bold tracking-widest text-emerald-950">
                  Verification Code: {issuedPreviewCode}
                </p>
              )}
            </div>
          )}

          {step === 'request' ? (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="reset-email" className="block text-sm font-medium text-slate-800">
                  Registered email address
                </label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Request Reset Code</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="reset-code" className="block text-sm font-medium text-slate-800">
                  6-digit verification code
                </label>
                <input
                  id="reset-code"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm tracking-widest text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="new-pw" className="block text-sm font-medium text-slate-800">
                  New Create Password
                </label>
                <div className="relative">
                  <input
                    id="new-pw"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirm-new-pw" className="block text-sm font-medium text-slate-800">
                  Confirm New Password
                </label>
                <input
                  id="confirm-new-pw"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
              </div>

              {strengthList}

              <button
                type="submit"
                disabled={submitting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>Set New Password</span>
              </button>
            </form>
          )}

          <p className="text-center text-sm text-slate-600">
            Remembered your password?{' '}
            <Link to="/login" className="font-semibold text-sky-700 hover:text-sky-900">
              Back to Sign In
            </Link>
          </p>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
