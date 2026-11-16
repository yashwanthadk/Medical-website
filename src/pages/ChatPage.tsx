import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import {
  api,
  type ChatMessageDTO,
  type ChatSessionDTO,
  type HistoryItem,
} from '../lib/api';

const STARTER_PROMPTS = [
  'Explain the key medical terms in my report in plain language.',
  'Which values or observations should I ask my doctor about first?',
  'What are the limitations of this uploaded report or scan?',
];

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSessionId = searchParams.get('session');

  const [sessions, setSessions] = useState<ChatSessionDTO[]>([]);
  const [reports, setReports] = useState<HistoryItem[]>([]);
  const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSessionDTO | null>(null);

  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [input, setInput] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadInitial = async () => {
    setLoadingSessions(true);
    try {
      const [sessRes, histRes] = await Promise.all([
        api.getChatSessions(),
        api.getHistory({}),
      ]);
      setSessions(sessRes.sessions);
      setReports(histRes.items.filter((i) => i.status === 'completed'));

      if (!activeSessionId && sessRes.sessions.length > 0) {
        setSearchParams({ session: sessRes.sessions[0].id }, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load chat sessions.');
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    void loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeSessionId) {
      setActiveSession(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    setError(null);
    api
      .getChatSession(activeSessionId)
      .then((res) => {
        if (!cancelled) {
          setActiveSession(res.session);
          setMessages(res.messages);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to open chat session.');
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCreateSession = async () => {
    setError(null);
    try {
      const created = await api.createChatSession({ reportId: selectedReportId || null });
      setSessions((prev) => [created, ...prev]);
      setSearchParams({ session: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create conversation.');
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await api.deleteChatSession(sessionId);
      const remaining = sessions.filter((s) => s.id !== sessionId);
      setSessions(remaining);
      if (activeSessionId === sessionId) {
        if (remaining.length > 0) {
          setSearchParams({ session: remaining[0].id });
        } else {
          setSearchParams({});
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete conversation.');
    }
  };

  const sendMessageText = async (text: string) => {
    if (!text.trim() || sending) return;

    let targetSessionId = activeSessionId;
    setError(null);

    try {
      if (!targetSessionId) {
        const created = await api.createChatSession({ reportId: selectedReportId || null });
        setSessions((prev) => [created, ...prev]);
        targetSessionId = created.id;
        setSearchParams({ session: created.id });
        setActiveSession(created);
      }

      setSending(true);
      const optimisticUser: ChatMessageDTO = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUser]);
      setInput('');

      const res = await api.sendChatMessage(targetSessionId, text.trim());
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticUser.id),
        res.userMessage,
        res.assistantMessage,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to get AI response.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessageText(input);
  };

  return (
    <DashboardLayout
      title="AI Medical Chat"
      subtitle="Ask questions grounded in your uploaded X-rays, MRI scans, and blood reports"
    >
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Sessions Sidebar */}
        <aside className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
          <div className="space-y-2.5">
            <label htmlFor="link-report" className="block text-xs font-semibold text-slate-700">
              Link a Report for Context
            </label>
            <select
              id="link-report"
              value={selectedReportId}
              onChange={(e) => setSelectedReportId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-sky-600 focus:outline-none"
            >
              <option value="">General Medical Terminology Q&amp;A</option>
              {reports.map((r) => (
                <option key={r.reportId} value={r.reportId}>
                  [{r.reportType.toUpperCase()}] {r.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleCreateSession}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-sky-700 px-3 text-xs font-semibold text-white hover:bg-sky-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Start New Chat</span>
            </button>
          </div>

          <div className="border-t border-slate-200 pt-3 space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 px-1">Your Conversations</p>
            {loadingSessions ? (
              <div className="py-6 flex justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-sky-700" />
              </div>
            ) : sessions.length === 0 ? (
              <p className="text-xs text-slate-500 px-1 py-3">
                No conversations yet. Start one above or ask a question directly.
              </p>
            ) : (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                      activeSessionId === s.id
                        ? 'bg-sky-50 text-sky-900 border border-sky-200'
                        : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSearchParams({ session: s.id })}
                      className="flex-1 text-left truncate font-medium cursor-pointer"
                    >
                      {s.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSession(s.id)}
                      aria-label={`Delete conversation ${s.title}`}
                      className="p-1 text-slate-400 hover:text-rose-600 shrink-0 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Conversation Panel */}
        <section className="lg:col-span-8 rounded-2xl border border-slate-200 bg-white flex flex-col min-h-[580px] max-h-[75vh]">
          <div className="border-b border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">
                {activeSession?.title || 'AI Medical Report Assistant'}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {activeSession?.reportTitle
                  ? `Grounded in ${activeSession.reportType?.toUpperCase()} report: ${activeSession.reportTitle}`
                  : 'Educational medical terminology & next-step information'}
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
              <span>Never prescribes or diagnoses</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {loadingMessages ? (
              <div className="py-16 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-sky-700" />
              </div>
            ) : messages.length === 0 ? (
              <div className="py-10 max-w-lg mx-auto text-center space-y-4">
                <MessageSquare className="mx-auto h-8 w-8 text-sky-700" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">
                    Ask a question about your uploaded report
                  </p>
                  <p className="text-xs text-slate-500">
                    MediExplain AI explains medical terminology and suggests helpful questions for
                    your healthcare provider without prescribing medication.
                  </p>
                </div>
                <div className="flex flex-col gap-2 pt-2">
                  {STARTER_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void sendMessageText(q)}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-xs font-medium text-slate-700 hover:bg-sky-50 hover:border-sky-200 transition-colors cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-sky-700 text-white'
                        : 'border border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))
            )}

            {sending && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-700" />
                  <span>Reviewing report context...</span>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                <AlertCircle className="h-4 w-4 text-rose-700 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSubmit} className="border-t border-slate-200 p-4 flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about medical terms, reference ranges, or next questions for your doctor..."
              className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              aria-label="Send message"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-sky-700 px-5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </section>
      </div>
    </DashboardLayout>
  );
}
