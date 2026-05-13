// Renderiza un script con syntax highlight (Shiki) + botones copy/download.
// Shiki se carga lazy para no inflar el bundle inicial.

import { useEffect, useRef, useState } from 'react';

let highlighterPromise = null;

async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['github-dark'],
        langs: ['typescript', 'javascript', 'python'],
      }),
    );
  }
  return highlighterPromise;
}

const LANGUAGE_MAP = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
};

const EXT_MAP = {
  typescript: 'spec.ts',
  javascript: 'cy.js',
  python: 'test.py',
};

export function ScriptViewer({ script }) {
  const [html, setHtml] = useState(null);
  const [copied, setCopied] = useState(false);
  const lastScriptId = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!script?.content) {
      setHtml(null);
      return undefined;
    }
    lastScriptId.current = script.id;
    setHtml(null);

    (async () => {
      try {
        const highlighter = await getHighlighter();
        if (cancelled || lastScriptId.current !== script.id) return;
        const lang = LANGUAGE_MAP[script.language] || 'typescript';
        const out = highlighter.codeToHtml(script.content, {
          lang,
          theme: 'github-dark',
        });
        setHtml(out);
      } catch (err) {
        if (!cancelled) {
          // Fallback: mostrar plano si Shiki falla.
          setHtml(null);
          console.error('[ScriptViewer] Shiki falló:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [script?.id, script?.content, script?.language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(script.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch (err) {
      console.error('[ScriptViewer] copy falló:', err);
    }
  };

  const handleDownload = () => {
    const ext = EXT_MAP[script.language] || 'txt';
    const filename = `qa-forge-${script.framework}.${ext}`;
    const blob = new Blob([script.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!script) return null;

  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-950/60">
      <header className="flex items-center justify-between border-b border-slate-800/70 px-4 py-2">
        <div className="text-xs uppercase tracking-widest text-slate-500">
          {script.framework} · {script.language}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
            data-testid={`script-copy-${script.framework}`}
          >
            {copied ? '✓ Copiado' : 'Copiar'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300"
            data-testid={`script-download-${script.framework}`}
          >
            Descargar
          </button>
        </div>
      </header>
      {html ? (
        <div
          className="overflow-auto text-sm [&_pre]:!bg-transparent [&_pre]:!p-4 [&_pre]:!m-0"
          // Shiki produce HTML con estilos inline; es seguro inyectar.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-auto whitespace-pre-wrap p-4 text-sm text-slate-200">
          {script.content}
        </pre>
      )}
    </div>
  );
}
