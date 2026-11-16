import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Brain,
  Check,
  FileSearch,
  Lock,
  MessageSquare,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import { PublicHeader } from '../components/PublicHeader';
import { PublicFooter } from '../components/PublicFooter';

const workflowSteps = [
  {
    step: '01. Upload Medical File',
    detail: 'Drop a chest or bone X-ray, MRI slice, or blood test report (PDF, JPG, or PNG).',
  },
  {
    step: '02. File & Signature Verification',
    detail: 'The backend validates file headers, checks size limits, and stores files privately.',
  },
  {
    step: '03. Information Extraction',
    detail: 'Digital PDFs undergo text parsing while scans and imaged labs are prepared for vision OCR.',
  },
  {
    step: '04. Multimodal AI Analysis',
    detail: 'The appropriate clinical-education vision or document model inspects the extracted input.',
  },
  {
    step: '05. Plain-Language Explanation',
    detail: 'Observations, reference ranges, and medical terms are translated into clear explanations.',
  },
  {
    step: '06. Limitations & Safety Guidance',
    detail: 'Every summary highlights what cannot be reliably assessed and flags urgent findings for prompt clinical review.',
  },
];

export function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <PublicHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="border-b border-slate-200/80 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
            <div className="grid gap-10 lg:grid-cols-12 lg:items-stretch">
              <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
                <p className="text-xs font-medium tracking-wide text-sky-800">
                  Educational Medical AI · Private Document Analysis · Non-Diagnostic Clarity
                </p>

                <h1
                  className="font-display font-bold tracking-tight text-slate-950"
                  style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', lineHeight: 1.1, textWrap: 'balance' }}
                >
                  Understand Your Medical Reports with AI
                </h1>

                <p className="max-w-xl text-base sm:text-lg leading-relaxed text-slate-600">
                  Upload your X-ray, MRI scans, or blood reports and get easy-to-understand
                  explanations powered by AI.
                </p>

                <div className="flex flex-wrap items-center gap-4 pt-2">
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-6 py-3.5 text-sm font-semibold text-white hover:bg-sky-800 transition-colors whitespace-nowrap"
                  >
                    <span>Get Started</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    to="/chat"
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <span>Open AI Medical Chat</span>
                  </Link>
                </div>

                <div className="grid grid-cols-3 gap-6 border-t border-slate-200/80 pt-6 text-xs text-slate-600">
                  <div>
                    <p className="font-semibold text-slate-900">X-Ray &amp; MRI</p>
                    <p className="mt-0.5">JPG &amp; PNG scan explanations</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Blood Panels</p>
                    <p className="mt-0.5">PDF &amp; image OCR extraction</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Private Storage</p>
                    <p className="mt-0.5">No training on user files</p>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6 flex">
                <div className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                  <img
                    src="/src/assets/images/hero_medical_diagnostics_1794832255614.jpg"
                    alt="Clinical radiology workstation displaying chest radiograph and sagittal brain MRI scan"
                    referrerPolicy="no-referrer"
                    className="h-64 sm:h-80 lg:h-full w-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 via-slate-950/35 to-transparent p-6 text-white">
                    <p className="text-xs font-medium text-sky-200">
                      Imaging &amp; Laboratory Clarity
                    </p>
                    <p className="mt-1 text-sm font-medium leading-snug text-white/95">
                      Plain-language walkthroughs of visible structures, lab reference ranges, and
                      questions to bring to your clinician.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Three Core Features */}
        <section id="features" className="mx-auto max-w-6xl px-6 py-16 lg:py-20 space-y-10">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-medium text-sky-800">Core Capabilities</p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
              Three specialized workflows built for patient understanding
            </h2>
            <p className="text-base leading-relaxed text-slate-600">
              Every modality follows its own dedicated validation, extraction, and medical safety
              pipeline before presenting structured explanations.
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Feature 1: X-Ray */}
            <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100 border-b border-slate-200">
                <img
                  src="/src/assets/images/feature_xray_preview_1794832255523.jpg"
                  alt="Chest X-ray radiograph displayed on a diagnostic monitor"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col justify-between p-6 space-y-5">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Radiography · JPG / PNG</span>
                    <ScanLine className="h-4 w-4 text-sky-700" />
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900">X-Ray Analysis</h3>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Understand your X-ray images with AI-assisted visual explanations. Review
                    visible patterns, areas needing clinical follow-up, and technical limitations.
                  </p>
                </div>
                <Link
                  to="/xray"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:text-sky-900"
                >
                  <span>Analyze an X-Ray</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </article>

            {/* Feature 2: MRI */}
            <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100 border-b border-slate-200">
                <img
                  src="/src/assets/images/feature_mri_preview_1794832255730.jpg"
                  alt="Brain and cervical spine MRI slices displayed on a radiology screen"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col justify-between p-6 space-y-5">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Cross-Sectional · JPG / PNG</span>
                    <Brain className="h-4 w-4 text-sky-700" />
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900">
                    MRI Scan Analysis
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Explore MRI scan images and understand their visible structures across brain,
                    spine, knee, and musculoskeletal slices with single-image caveats clearly noted.
                  </p>
                </div>
                <Link
                  to="/mri"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:text-sky-900"
                >
                  <span>Explore an MRI Scan</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </article>

            {/* Feature 3: Blood Report */}
            <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100 border-b border-slate-200">
                <img
                  src="/src/assets/images/feature_blood_lab_1794832256956.jpg"
                  alt="Clinical laboratory tubes and digital blood count readout tablet"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col justify-between p-6 space-y-5">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Laboratory · PDF / JPG / PNG</span>
                    <Activity className="h-4 w-4 text-sky-700" />
                  </div>
                  <h3 className="font-display text-lg font-bold text-slate-900">
                    Blood Report Analysis
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">
                    Understand blood test values, printed reference ranges, and health indicators
                    with structured tables, interactive range charts, and High/Low/Normal markers.
                  </p>
                </div>
                <Link
                  to="/blood-reports"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:text-sky-900"
                >
                  <span>Explain a Blood Report</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </article>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="border-y border-slate-200/80 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20 space-y-10">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-medium text-sky-800">How It Works</p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
                From uploaded scan or PDF to clear, accountable explanation
              </h2>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {workflowSteps.map((item) => (
                <div
                  key={item.step}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-6 space-y-2"
                >
                  <h3 className="font-display text-base font-bold text-slate-900">{item.step}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Platform Benefits & Safety Commitments */}
        <section className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-12 items-start">
            <div className="lg:col-span-5 space-y-4">
              <p className="text-xs font-medium text-sky-800">Built for Medical Safety</p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-950">
                Transparent boundaries you can trust
              </h2>
              <p className="text-sm sm:text-base leading-relaxed text-slate-600">
                MediExplain AI is dedicated exclusively to helping you read and understand your
                uploaded scans and laboratory reports. We never sell appointments, promote doctor
                listings, or fabricate missing values.
              </p>
              <div className="pt-2">
                <Link
                  to="/privacy"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:text-sky-900"
                >
                  <span>Read our Privacy &amp; Safety Standards</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
                <MessageSquare className="h-5 w-5 text-sky-700" />
                <h3 className="font-display text-base font-bold text-slate-900">
                  Contextual AI Medical Chat
                </h3>
                <p className="text-sm text-slate-600">
                  Ask follow-up questions grounded directly in your uploaded report. Clarify
                  terminology and prepare questions for your clinician.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
                <FileSearch className="h-5 w-5 text-sky-700" />
                <h3 className="font-display text-base font-bold text-slate-900">
                  Printed Reference Fidelity
                </h3>
                <p className="text-sm text-slate-600">
                  Blood tests use the exact reference ranges printed on your report, marking
                  unspecified ranges honestly as Unknown.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
                <ShieldCheck className="h-5 w-5 text-sky-700" />
                <h3 className="font-display text-base font-bold text-slate-900">
                  Zero Diagnostic Overreach
                </h3>
                <p className="text-sm text-slate-600">
                  Highlights areas needing professional review and flags urgent patterns without
                  ever claiming a confirmed diagnosis or prescribing medicine.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
                <Lock className="h-5 w-5 text-sky-700" />
                <h3 className="font-display text-base font-bold text-slate-900">
                  Private &amp; Workspace-Scoped
                </h3>
                <p className="text-sm text-slate-600">
                  Files are stored privately behind workspace-scoped access tokens with full deletion
                  control and zero model training without consent.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-14 rounded-2xl border border-sky-200 bg-sky-50/70 p-8 sm:p-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-xl">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-950">
                Ready to understand your scans and lab results?
              </h2>
              <p className="text-sm text-slate-600">
                Open the workspace directly with no account required and upload your first X-ray,
                MRI scan, or blood test report.
              </p>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs text-slate-600">
                <li className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-sky-700" />
                  <span>Downloadable summaries</span>
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-sky-700" />
                  <span>Interactive lab charts</span>
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5 text-sky-700" />
                  <span>Persistent analysis history</span>
                </li>
              </ul>
            </div>

            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-6 py-3.5 text-sm font-semibold text-white hover:bg-sky-800 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Get Started Free</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
