// RepoChat — chatbot de IA del repositorio de casos de prueba (FASE 10).
// Ve los casos del SUT y responde preguntas o PROPONE cambios (crear/editar/
// borrar). Los cambios se aplican sólo cuando el usuario los confirma.

import { useEffect, useRef, useState } from 'react';

import { applyTestCaseActions, chatWithRepo, getProviders } from '../lib/api.js';

const OP_META = {
  create: { icon: '➕', label: 'Crear', cls: 'text-emerald-300' },
  update: { icon: '✏️', label: 'Editar', cls: 'text-amber-300' },
  delete: { icon: '🗑', label: 'Borrar', cls: 'text-red-300' },
};

export function RepoChat({ sutId, testCases, onApplied }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [applyingIdx, setApplyingIdx] = useState(null);
  const [error, setError] = useState(null);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    getProviders()
      .then((data) => {
        setProviders(data.providers ?? []);
        const configured = (data.providers ?? []).filter((p) => p.configured);
        setSelectedProvider(
          configured.find((p) => p.id === data.defaultProvider)?.id ?? configured[0]?.id ?? null,
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  // Mapa caseId → code, para mostrar las acciones de forma legible.
  const codeById = {};
  for (const tc of testCases ?? []) codeById[tc.id] = tc.code;

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const history = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    setSending(true);
    setError(null);
    try {
      const data = await chatWithRepo(sutId, {
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        provider: selectedProvider,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || '(sin respuesta)',
          actions: Array.isArray(data.actions) ? data.actions : [],
        },
      ]);
    } catch (err) {
      const status = err?.response?.status;
      const apiMsg = err?.response?.data?.message;
      if (status === 503) {
        setError(apiMsg ?? 'No hay provider de IA configurado. Cargá una API key en Ajustes.');
      } else if (status === 429) {
        setError(apiMsg ?? 'Cuota del provider agotada. Probá con otro provider.');
      } else {
        setError(apiMsg ?? err?.message ?? 'El asistente no pudo responder');
      }
    } finally {
      setSending(false);
    }
  };

  const applyActions = async (idx) => {
    const msg = messages[idx];
    if (!msg?.actions?.length) return;
    setApplyingIdx(idx);
    setError(null);
    try {
      const fresh = await applyTestCaseActions(sutId, msg.actions);
      setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, applied: true } : m)));
      onApplied?.(fresh);
    } catch (err) {
      setError(err?.response?.data?.message ?? err?.message ?? 'No se pudieron aplicar los cambios');
    } finally {
      setApplyingIdx(null);
    }
  };

  const discardActions = (idx) =>
    setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, discarded: true } : m)));

  return (
    <div className="flex flex-col rounded-xl border border-violet-500/30 bg-slate-900/40">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/70 px-4 py-2">
        <span className="text-sm font-semibold text-violet-200">🤖 Asistente IA</span>
        {providers.length > 0 ? (
          <select
            value={selectedProvider ?? ''}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured}>
                {p.label}
                {p.configured ? '' : ' — sin key'}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div ref={scrollRef} className="max-h-96 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500">
            Pedile al asistente que analice la cobertura, resuma los casos, o que cree/edite
            casos. Ej: <em>"agregá casos para el flujo de checkout"</em> o{' '}
            <em>"¿qué casos de seguridad faltan?"</em>. Los cambios los confirmás vos.
          </p>
        ) : null}
        {messages.map((m, idx) => (
          <div key={idx} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-emerald-500/15 text-emerald-100'
                  : 'bg-slate-800/70 text-slate-200'
              }`}
            >
              {m.content}
            </div>
            {m.role === 'assistant' && m.actions?.length > 0 ? (
              <ActionsPreview
                actions={m.actions}
                codeById={codeById}
                applied={m.applied}
                discarded={m.discarded}
                applying={applyingIdx === idx}
                onApply={() => applyActions(idx)}
                onDiscard={() => discardActions(idx)}
              />
            ) : null}
          </div>
        ))}
        {sending ? <p className="text-xs text-slate-500">El asistente está pensando…</p> : null}
      </div>

      {error ? (
        <p className="mx-4 mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2 border-t border-slate-800/70 p-3">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Escribí un mensaje… (Enter para enviar)"
          className="flex-1 resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
          data-testid="repo-chat-input"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !input.trim()}
          className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

/** Preview de las acciones propuestas + botones aplicar / descartar. */
function ActionsPreview({ actions, codeById, applied, discarded, applying, onApply, onDiscard }) {
  return (
    <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-left">
      <p className="mb-2 text-[10px] uppercase tracking-widest text-violet-300">
        {actions.length} cambio{actions.length === 1 ? '' : 's'} propuesto
        {actions.length === 1 ? '' : 's'}
      </p>
      <ul className="space-y-1">
        {actions.map((a, i) => {
          const meta = OP_META[a.op] ?? OP_META.update;
          const ref = a.caseId ? codeById[a.caseId] || a.caseId : '';
          const title = a.fields?.title;
          const changed = a.fields ? Object.keys(a.fields) : [];
          return (
            <li key={i} className="text-xs text-slate-300">
              <span className={meta.cls}>
                {meta.icon} {meta.label}
              </span>{' '}
              {a.op === 'create' ? (
                <span className="text-slate-200">{title || '(caso nuevo)'}</span>
              ) : a.op === 'delete' ? (
                <span className="text-slate-200">{ref}</span>
              ) : (
                <span className="text-slate-200">
                  {ref}
                  {changed.length ? (
                    <span className="text-slate-500"> · {changed.join(', ')}</span>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {applied ? (
        <p className="mt-2 text-xs text-emerald-400">✓ Cambios aplicados</p>
      ) : discarded ? (
        <p className="mt-2 text-xs text-slate-500">Cambios descartados</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="rounded-md bg-violet-500 px-3 py-1 text-xs font-medium text-slate-950 hover:bg-violet-400 disabled:opacity-60"
          >
            {applying ? 'Aplicando…' : `Aplicar ${actions.length} cambio${actions.length === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={applying}
            className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:text-slate-200"
          >
            Descartar
          </button>
        </div>
      )}
    </div>
  );
}
