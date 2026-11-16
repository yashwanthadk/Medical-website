import { Link } from 'react-router-dom';
import { ArrowRight, Brain, FileText, ScanLine, ShieldAlert } from 'lucide-react';
import { PublicHeader } from '../components/PublicHeader';
import { PublicFooter } from '../components/PublicFooter';

export function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <PublicHeader />

      <main className="flex-1 mx-auto w-full max-w-4xl px-6 py-14 space-y-12">
        <section className="space-y-4">
          <p className="text-xs font-medium text-sky-800">About MediExplain AI</p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-950">
            Making clinical reports readable without overstepping medical care
          </h1>
          <p className="text-base leading-relaxed text-slate-600">
            Patients frequently receive radiology findings and multi-page laboratory panels filled
            with specialized abbreviations before they have an opportunity to review them in
            detail. MediExplain AI was designed with one focused mission: to translate X-rays, MRI
            images, and blood test panels into calm, accurate, plain-language educational
            explanations.
          </p>
        </section>

        <section className="grid gap-6 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-2.5">
            <ScanLine className="h-5 w-5 text-sky-700" />
            <h2 className="font-display text-base font-bold text-slate-900">X-Ray Clarity</h2>
            <p className="text-sm text-slate-600">
              Breaks down visible radiographic structures, highlights regions worth discussing with
              your clinician, and clearly states 2D projection limits.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-2.5">
            <Brain className="h-5 w-5 text-sky-700" />
            <h2 className="font-display text-base font-bold text-slate-900">MRI Orientation</h2>
            <p className="text-sm text-slate-600">
              Explains visible anatomy on single MRI slices while explicitly reminding users that
              clinical MRI interpretation requires full multi-sequence studies.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-2.5">
            <FileText className="h-5 w-5 text-sky-700" />
            <h2 className="font-display text-base font-bold text-slate-900">Lab Transparency</h2>
            <p className="text-sm text-slate-600">
              Extracts test values, units, and the exact reference ranges printed on your report
              without inventing missing thresholds.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-7 space-y-4">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            <h2 className="font-display text-lg font-bold text-slate-950">
              What MediExplain AI Intentionally Does Not Do
            </h2>
          </div>
          <ul className="space-y-2.5 text-sm text-slate-700 leading-relaxed">
            <li>
              • We do not provide confirmed medical diagnoses, clinical clearances, or treatment
              prescriptions.
            </li>
            <li>
              • We do not operate appointment booking, doctor directories, or paid consultation
              scheduling — our platform exists strictly for educational report understanding.
            </li>
            <li>
              • We never claim an image or test is definitively normal or abnormal when resolution,
              projection, or missing reference data limits reliable assessment.
            </li>
          </ul>
          <div className="pt-2">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 transition-colors"
            >
              <span>Start Analyzing Reports</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
