import React, { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  Activity,
  Brain,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ScanLine,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface DashboardLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/xray', label: 'X-Ray Analysis', icon: ScanLine },
  { to: '/mri', label: 'MRI Scan Analysis', icon: Brain },
  { to: '/blood-reports', label: 'Blood Report Analysis', icon: Activity },
  { to: '/chat', label: 'AI Medical Chat', icon: MessageSquare },
  { to: '/history', label: 'Analysis History', icon: History },
  { to: '/reset-password', label: 'Password & Security', icon: KeyRound },
];

export function DashboardLayout({ title, subtitle, children }: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-white border-r border-slate-200">
      <div>
        <div className="flex items-center justify-between px-5 py-5 border-b border-slate-200">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap"
          >
            MediExplain AI
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
            className="lg:hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Workspace Navigation" className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-sky-50 text-sky-800 border border-sky-200/80'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 border border-transparent'
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-slate-200 p-4 space-y-3">
        <div className="space-y-0.5 px-1">
          <p className="text-sm font-semibold text-slate-900 truncate">{user?.displayName}</p>
          <p className="text-xs text-slate-500 truncate">{user?.email}</p>
        </div>

        <div className="flex items-center gap-3 px-1 text-xs text-slate-500">
          <Link to="/about" className="hover:text-slate-800">
            About Us
          </Link>
          <span aria-hidden="true">·</span>
          <Link to="/privacy" className="hover:text-slate-800">
            Privacy
          </Link>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
                className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 shrink-0"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-slate-900 truncate">
                  {title}
                </h1>
                {subtitle && (
                  <p className="hidden sm:block text-xs text-slate-500 truncate">{subtitle}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <Link
                to="/privacy"
                className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 whitespace-nowrap"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-sky-700" />
                <span>Educational Only · Private Storage</span>
              </Link>
              <Link
                to="/history"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Reports</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
