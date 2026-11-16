import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function PublicHeader() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const scrollToSection = (id: string) => {
    setMobileOpen(false);
    if (location.pathname !== '/') {
      navigate('/');
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
        {/* Zone 1: Single-element brand wordmark */}
        <Link
          to="/"
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600"
        >
          MediExplain AI
        </Link>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          <Link
            to="/"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Home
          </Link>
          <button
            type="button"
            onClick={() => scrollToSection('features')}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Features
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('how-it-works')}
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            How It Works
          </button>
          <Link
            to="/about"
            className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            About Us
          </Link>
          {!user && (
            <Link
              to="/login"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Login
            </Link>
          )}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to={user ? '/dashboard' : '/signup'}
            className="hidden md:inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            {user ? 'Open Dashboard' : 'Get Started'}
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-6 py-4 space-y-2">
          <Link
            to="/"
            onClick={() => setMobileOpen(false)}
            className="block py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            Home
          </Link>
          <button
            type="button"
            onClick={() => scrollToSection('features')}
            className="block w-full text-left py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            Features
          </button>
          <button
            type="button"
            onClick={() => scrollToSection('how-it-works')}
            className="block w-full text-left py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            How It Works
          </button>
          <Link
            to="/about"
            onClick={() => setMobileOpen(false)}
            className="block py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            About Us
          </Link>
          {!user && (
            <Link
              to="/login"
              onClick={() => setMobileOpen(false)}
              className="block py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              Login
            </Link>
          )}
          <div className="pt-2">
            <Link
              to={user ? '/dashboard' : '/signup'}
              onClick={() => setMobileOpen(false)}
              className="flex h-11 w-full items-center justify-center rounded-lg bg-sky-700 px-5 text-sm font-semibold text-white hover:bg-sky-800"
            >
              {user ? 'Open Dashboard' : 'Get Started'}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
