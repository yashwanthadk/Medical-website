import { Link } from 'react-router-dom';

export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2 space-y-3">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900">
              MediExplain AI
            </span>
            <p className="max-w-md text-sm leading-relaxed text-slate-600">
              Educational artificial intelligence designed to translate complex X-ray images,
              MRI slices, and blood test panels into clear, accessible language.
            </p>
            <p className="text-xs leading-relaxed text-slate-500">
              Medical Safety Notice: MediExplain AI provides educational explanations only. It
              never replaces licensed physicians or radiologists and does not provide medical
              diagnoses or prescriptions.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Platform</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/xray" className="hover:text-slate-900 transition-colors">
                  X-Ray Analysis
                </Link>
              </li>
              <li>
                <Link to="/mri" className="hover:text-slate-900 transition-colors">
                  MRI Scan Analysis
                </Link>
              </li>
              <li>
                <Link to="/blood-reports" className="hover:text-slate-900 transition-colors">
                  Blood Report Analysis
                </Link>
              </li>
              <li>
                <Link to="/chat" className="hover:text-slate-900 transition-colors">
                  AI Medical Chat
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Workspace &amp; Trust</h3>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <Link to="/dashboard" className="hover:text-slate-900 transition-colors">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link to="/history" className="hover:text-slate-900 transition-colors">
                  Analysis History
                </Link>
              </li>
              <li>
                <Link to="/about" className="hover:text-slate-900 transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-slate-900 transition-colors">
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-slate-200/80 pt-6 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} MediExplain AI. Educational medical information platform.</p>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="hover:text-slate-800">
              Privacy &amp; Data Handling
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/about" className="hover:text-slate-800">
              Clinical Limitations
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
