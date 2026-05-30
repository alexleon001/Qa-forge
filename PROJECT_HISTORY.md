# QA Forge — Historial de implementación

> Detalle por fase de lo ya implementado. Movido fuera de `CLAUDE.md` el 2026-05-30
> para mantener el contexto de sesión liviano. El estado vigente + roadmap vive en
> `CLAUDE.md`; acá queda el log completo de cada fase y sus validaciones.

---

## FASE 1 — Scaffold

- ✅ Scaffold raíz: `CLAUDE.md`, `docker-compose.yml`, `.env.example` extendido
- ✅ Backend scaffold: Express + Socket.io + Prisma + Bull queue
- ✅ Runners FASE 1: `playwright.runner.js`, `headers.runner.js`, `ssl.runner.js`
- ✅ API: `POST /api/scan`, `GET /api/scan/:id`
- ✅ Queue Bull con eventos hacia Socket.io
- ✅ Frontend scaffold: Vite + Tailwind + Zustand + Socket.io client
- ✅ Vistas: `Home`, `Dashboard` (progreso en tiempo real)
- ✅ `shared/constants.js`

### Validación FASE 1

- ✅ `bun install` en backend y frontend OK
- ✅ `bunx prisma generate` + `bunx prisma db push` crea `dev.db`
- ✅ `bunx playwright install chromium` descarga el binario
- ✅ `bun src/index.js` arranca Express+Socket.io en :3001 (worker arranca aunque
  Redis no esté disponible — errores no fatales en logs)
- ✅ `GET /api/health` responde 200 con `{status: "ok"}`
- ✅ `POST /api/scan` valida input con Zod (rechaza URL inválida con 400)
- ✅ `bun run build` del frontend produce dist/ válido (~261 KB JS gz: 87 KB)

---

## FASE 2 — Analyzers + runners externos

- ✅ Analyzers (puros, sobre data ya capturada):
  - `seo.analyzer.js` (title, meta, OG, robots, h1, lang) — score 0-100
  - `links.analyzer.js` (HEAD a cada link, concurrency=8, máx 50 links)
  - `forms.analyzer.js` (CSRF hint, action http en página https, inputs sin name)
  - `security.analyzer.js` (score 0-100 ponderado: https, HSTS, CSP, XFO, etc.)
- ✅ Runners externos:
  - `pagespeed.runner.js` (Google PageSpeed Insights API, scores + Web Vitals)
  - `accessibility.runner.js` (`@axe-core/playwright`, WCAG2A/AA + best-practice)
- ✅ Queue actualizada: pipeline de 9 pasos con `safeRun` (errores no rompen el scan)
- ✅ `summary.byCategory`: promedio de scores por categoría enviado al frontend
- ✅ Endpoint export: `GET /api/report/:id/export?format=json|html`
- ✅ HTML self-contained con inline styles (`reports/html.template.js`)
- ✅ Vista `ReportDetail` con `ScoreGauge` SVG por categoría + `ExportButton`
- ✅ Dashboard agrega link "Ver reporte detallado" cuando `status === completed`

### Validación FASE 2

- ✅ `bun install @axe-core/playwright` OK
- ✅ Backend bootea con todos los nuevos imports (analyzers + runners + html template)
- ✅ `GET /api/report/:id` responde 404 cuando no existe (validación de loadReport)
- ✅ Frontend buildea: 267 KB JS (gz 88 KB) — 6 KB de delta vs FASE 1
- ⚠️ Pendiente: scan e2e real con Redis levantado (no había docker en el host de
  esa sesión).

---

## FASE 3 — Generador de scripts (IA)

- ✅ `backend/src/generators/script.generator.js` con `@anthropic-ai/sdk` v0.88
  - Modelo: `claude-sonnet-4-6` (constante `CLAUDE_MODEL` en `shared/constants.js`)
  - `thinking: { type: "adaptive" }` + `output_config.effort: "medium"`
  - `output_config.format: { type: "json_schema", schema: ... }` — sin prefills (deprecated en 4.6)
  - **Prompt caching**: `cache_control: { type: "ephemeral" }` en el system prompt
    (frozen entre scans → hit de cache desde el 2do scan)
  - Sin streaming (max_tokens 16K — dentro del default seguro de la SDK)
  - Resumen del DOM previo al prompt: solo meta, headings, forms y muestreo de links
    (sin html crudo ni screenshot — sería costoso)
- ✅ Endpoints `scripts.routes.js`:
  - `POST /api/scripts/:scanId` body `{ additionalCases?, force? }` → genera (o devuelve cached si ya hay 3)
  - `GET /api/scripts/:scanId` → lista (404 si no hay aún)
  - 503 limpio si `ANTHROPIC_API_KEY` falta
  - 409 si el scan aún no tiene `playwright.capture`
- ✅ Persistencia: 3 `Script` records por scan (reemplaza los anteriores en transacción)
- ✅ Frontend:
  - Vista `ScriptGenerator` en ruta `/scan/:scanId/scripts`
  - `ScriptViewer` con Shiki (lazy load, themes: github-dark; langs: ts/js/python)
  - Tabs por framework, botones Copy + Download (`.spec.ts` / `.cy.js` / `test.py`)
  - Textarea para "casos adicionales" en NL → la IA los agrega como tests extras
  - Links cruzados Dashboard → Scripts y Report → Scripts

### Validación FASE 3

- ✅ `bun install @anthropic-ai/sdk@0.88` OK
- ✅ Backend bootea con generator + scripts.routes registrados
- ✅ `POST /api/scripts/nope` responde 404 (validación de scan)
- ✅ `GET /api/scripts/nope` responde 404 `NO_SCRIPTS`
- ✅ Frontend buildea: chunk principal 276 KB (gz 91 KB), Shiki en chunks lazy
  (wasm 622 KB / langs 200 KB cada uno — solo se cargan al abrir `/scripts`)

---

## FASE 4 — History + Compare + Docker

- ✅ Vista `History` en `/history`: lista paginada (últimos 50), agrupada por
  URL, filtro de búsqueda inline, links a Progreso/Reporte/Scripts por scan,
  botón "Comparar últimos 2" cuando hay ≥ 2 scans de la misma URL
- ✅ Vista `Compare` en `/compare?a=<id>&b=<id>`: trae los 2 reportes en paralelo,
  computa diff de scores por categoría con deltas coloreados (+verde / −rojo),
  ScoreGauges lado a lado y tabla resumen
- ✅ Header nav: link "History" activo
- ✅ `backend/Dockerfile` basado en `mcr.microsoft.com/playwright:v1.49.1-jammy`
  (Chromium + libs de sistema ya incluidos) + Bun 1.3.10 encima. Layer-cache
  amigable (deps primero, código después). Entrypoint hace `prisma db push` +
  `bun src/index.js`.
- ✅ `frontend/Dockerfile` multi-stage: build con `oven/bun:1.3-alpine`,
  sirve con `nginx:1.27-alpine` + `nginx.conf` con SPA fallback + cache de assets
- ✅ `docker-compose.yml` con perfiles:
  - default: solo `redis` (modo dev — `bun run dev` local apunta al Redis containerizado)
  - `--profile full`: levanta redis + postgres + backend + frontend
  - `depends_on` con healthchecks, volúmenes para Postgres y SQLite
- ✅ `.dockerignore` en ambos paquetes para mantener las imágenes livianas

### Validación FASE 4

- ✅ Backend bootea con todos los routers (FASE 1-3 + diffs no rompen nada)
- ✅ Frontend buildea: 285 KB JS (gz 94 KB) — +10 KB por History+Compare
- ✅ `docker-compose config` parsea sin errores

---

## FASE 5 — Multi-provider IA

> Pedido del usuario: no depender solo de Anthropic (paga) y abrir alternativas
> gratuitas (Gemini free tier, Ollama local).

- ✅ Abstracción `backend/src/generators/providers/`:
  - `base.js` — `ProviderError`, `parseJsonOutput()` (con fallbacks para
    JSON envuelto en ```...``` o con texto extra)
  - `anthropic.provider.js` — `claude-sonnet-4-6`, adaptive thinking, JSON schema, prompt cache
  - `gemini.provider.js` — `gemini-2.0-flash`, `responseSchema` (sanitiza
    el schema: Gemini no soporta `additionalProperties`)
  - `openai.provider.js` — `gpt-4o-mini`, `response_format: json_schema` strict
  - `openrouter.provider.js` — SDK de OpenAI con `baseURL` custom, `json_object`
    mode (más compat con modelos diversos), schema injection en system prompt
  - `ollama.provider.js` — REST a `http://localhost:11434/api/chat`,
    `format` field con JSON schema, timeout 5 min, ping a `/api/tags` para `isConfigured()`
  - `index.js` — registry + `resolveProvider({ requestedId })` con modo `auto`
- ✅ `script.generator.js` refactor: ahora solo arma prompt + summary del DOM
  + llama al provider resuelto. SYSTEM_PROMPT y SCRIPT_OUTPUT_SCHEMA exportados.
- ✅ Endpoint nuevo `GET /api/scripts/providers` → lista providers con
  `{ id, label, defaultModel, configured, isDefault }`
- ✅ `POST /api/scripts/:scanId` acepta `{ provider, model }` en el body
- ✅ Frontend `ScriptGenerator` muestra dropdown con todos los providers
- ✅ `.env.example` documenta todas las API keys + override por modelo:
  `AI_PROVIDER`, `AI_MODEL_*`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
  `OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`, `OPENROUTER_REFERER`
- ✅ `docker-compose.yml` pasa todas las envs al contenedor backend.
  `OLLAMA_BASE_URL` default `host.docker.internal:11434`.

### Validación FASE 5

- ✅ `bun install @google/genai openai` OK
- ✅ Backend bootea con todos los providers cargados
- ✅ `GET /api/scripts/providers` devuelve los 5 con `configured: false` (esperado sin keys)
- ✅ Frontend buildea: 286 KB JS (gz 94 KB)

### opencode Zen (agregado 2026-05-20) — 6º provider

Gateway OpenAI-compatible (`https://opencode.ai/zen/v1`) con modelos curados para
coding (Claude, GPT-5, Gemini, Qwen, GLM, etc.). `opencode.provider.js` calcado
del de OpenRouter (SDK de OpenAI + baseURL custom). `response_format` es
best-effort: si el modelo lo rechaza (400/422), reintenta sin él. Default
`claude-sonnet-4-5`, override con `AI_MODEL_OPENCODE`. Hay modelos `*-free`.

**Orden del dropdown** (registry en `providers/index.js`): OpenAI (ChatGPT) →
opencode Zen → Anthropic Claude → Gemini → OpenRouter → Ollama.
`DEFAULT_PROVIDER_ID` cae a `openai` (antes `gemini`); el default real lo fija
`AI_PROVIDER` en el env.

---

## FASE 6 — Generador de casos manuales

- ✅ `backend/src/generators/manualcases.generator.js` paralelo al `script.generator.js`
  - Reusa la abstracción multi-provider de FASE 5 (`resolveProvider()`)
  - Schema: `{ id, title, category, priority, preconditions[], steps[{action, expected}],
    postconditions[], testData?, notes? }`
- ✅ Persistencia: reusa tabla `Script` con `framework: "manual"`, `language: "json"`,
  `content` = JSON serializado del array de testCases (no se creó tabla nueva)
- ✅ Endpoints `manualcases.routes.js`:
  - `POST /api/manual-cases/:scanId` body `{ additionalCases?, force?, provider?, model? }`
  - `GET /api/manual-cases/:scanId` (404 si no hay aún)
- ✅ Frontend: vista `ManualCases` en `/scan/:scanId/manual-cases`
  - Acordeón por categoría con badge de prioridad
  - Export a **Markdown / CSV / JSON** (compatible con Jira/TestRail/Zephyr import)
- ✅ Links cruzados desde Dashboard, ReportDetail y ScriptGenerator

---

## Deploy a producción (2026-05-13)

- ✅ Migración del schema a **Postgres** (`provider = "postgresql"` en `schema.prisma`)
- ✅ CORS multi-origen: `FRONTEND_URL` acepta lista CSV + `*.vercel.app` por default
  (flag `ALLOW_VERCEL_PREVIEWS=false` para desactivar)
- ✅ Socket cliente cae a `VITE_API_URL` si no se setea `VITE_SOCKET_URL`
- ✅ `railway.toml` en la raíz (build via `backend/Dockerfile`, healthcheck `/api/health`)
- ✅ `frontend/vercel.json` (build con Vite + SPA rewrites)
- ✅ docker-compose: postgres movido fuera del profile `full` para dev local
- ✅ Bind `0.0.0.0` + `preDeployCommand` separado de `startCommand` (Railway exec form, no shell)
- ✅ Healthcheck timeout 300s para el primer `prisma db push` contra Postgres fresco
- ✅ Bump Playwright image a `v1.60.0-jammy`

**Producción live**:
- Frontend: https://qaforge-chi.vercel.app
- Backend: https://qa-forge-production.up.railway.app (Railway service `Qa-forge`
  con plugins Postgres + Redis). Plan **Hobby** desde 2026-05-20 (el trial expiró).

---

## Sesión 2026-05-13 (post-deploy) — Mejoras UX + bugs críticos

**Features nuevas**
- ✅ `ScanTimer` component: elapsed live mientras running, total al terminar
- ✅ Notas de QA (`NotesEditor` con auto-save debounced 800ms, **colapsable**) —
  campo `notes` en Scan, endpoint `PATCH /api/scan/:id`
- ✅ Botón **STOP** — endpoint `POST /api/scan/:id/cancel` + status `cancelled`
  + nuevo `ScanContext` con AbortController + watcher poll cada 1.5s
- ✅ Cancelación agresiva mid-flight: cierra Playwright browser, aborta fetch
  de pagespeed/links/headers via signal compartido
- ✅ Logs de duración por etapa: `stage=playwright.capture duration=8123ms` etc.
- ✅ Favicon SVG verde "QA" + theme-color emerald
- ✅ Hidratación correcta del Dashboard al refrescar

**Bugs críticos resueltos**
- 🐛 **`ssl-checker` incompatible con Bun** — usaba `https.request → res.socket.getPeerCertificate()`
  que en Bun no existe. El TypeError salía async fuera del try/catch y mataba el process →
  Railway reiniciaba container → BullMQ retry infinito → `job stalled more than allowable limit`.
  **Fix**: `ssl.runner.js` reescrito con `node:tls.connect()` directo (compat con Bun).
- 🛡️ **Safety nets globales**: `process.on('uncaughtException')` + `('unhandledRejection')` en
  `index.js` — log pero NO matan el process. Previene futuros restart loops.
- ⏱️ **SSL timeout** duro de 10s vía Promise.race
- ⏱️ **Axe analyze timeout** duro de 20s (DOMs grandes lo colgaban)
- ⏱️ **Frontend axios** ahora tiene 2 clientes: `api` (30s) para REST normal,
  `aiApi` (180s) para `/api/scripts` y `/api/manual-cases`
- 🔢 `HTTP_REQUEST_TIMEOUT_MS`: 15s → 8s
- 🔢 `MAX_LINKS_TO_CHECK`: 50 → 30
- 🔢 `PAGESPEED_TIMEOUT_MS`: 45s → 60s

**Providers — UX de errores**
- ✅ `gemini.provider.js`: `parseGeminiError` mapea 429/401 a códigos HTTP correctos
- ✅ `openrouter.provider.js`: parser similar para 429/401/402/404
- ✅ `openai.provider.js`: parser 429/401/402 + **`sanitizeSchemaForOpenAI`** —
  strict mode requiere todas las properties en `required`; los opcionales se
  convierten a union nullable `["X", "null"]` recursivamente
- ✅ ScriptGenerator y ManualCases manejan status 429 / 401 con mensajes específicos

**Prompts pro (2026-05-13)**
- ✅ `script.generator.js` SYSTEM_PROMPT reescrito: 6-10 tests por framework
  (vs 3-4 antes), cobertura de auth/navegación/forms negativos/búsqueda/ecommerce
- ✅ `manualcases.generator.js` SYSTEM_PROMPT reescrito: 15-25 casos detallados
  (vs ~9 antes), cobertura mínima explícita por categoría con counts:
  - Funcional: 6-10 / Seguridad: 4-6 / A11y: 3-5 / Performance: 2-3 / SEO: 2-3
- Recomendado: con `gpt-4o` el seguimiento de instrucciones largas es mejor.

**Modelo default OpenAI actualizado (2026-05-29)**: pasó de `gpt-4o-mini` →
**`gpt-5.4`**. `openai.provider.js` detecta modelos de razonamiento (`gpt-5.x` /
`o-series`) con `isReasoningModel()` y usa `max_completion_tokens` sin
`temperature`. gpt-4o legacy sigue por la misma rama condicional. ⚠️ Si Railway
tiene `AI_MODEL_OPENAI` seteado (p.ej. `gpt-4o`), ese env **pisa** el default
del código — actualizarlo/borrarlo en el dashboard para que tome `gpt-5.4`.

---

## FASE 7 — Compartible con el equipo

> Pedido (2026-05-13): construir QA Forge para uso propio + compartir con el equipo
> de QA. **NO comercial** por ahora. Ver memoria [[project-audience-personal-use]].

✅ **7.1 Auth simple** (user/pass + JWT) — 2026-05-13 (commit `f9a98c7`)
  - Schema: `User` (email/passwordHash/name/role) + `UserApiKey` + `Scan.userId`
  - Helpers: `backend/src/auth/{crypto.js,jwt.js}` — AES-256-GCM + bcrypt + JWT
  - Endpoints `/api/auth/register|login|me`, middleware `attachUser`+`requireAuth`
  - Primer user registrado = admin automático. Flag `ALLOW_REGISTRATION`.
  - Frontend: `/login` `/register`, `useAuthStore`, interceptor axios, RequireAuth

✅ **7.2 API keys in-app** por usuario — 2026-05-13 (mismo commit)
  - Keys cifradas AES-256-GCM en `UserApiKey.encryptedKey` (`SECRET_ENCRYPTION_KEY`)
  - `hint` visible (4+4 chars). Una key default por (user, provider).
  - CRUD `/api/user/api-keys` + PATCH `/default`
  - `resolveProvider({ requestedId, userId })` usa key del user primero, fallback al env
  - Vista `/settings/api-keys`

✅ **7.8 Mobile web** — viewport switcher — 2026-05-13 (commit `d19ac62`)
  - 6 perfiles: desktop, desktop-1080p, tablet (iPad Pro 11), iPhone 13, iPhone 15 Pro, Pixel 7
  - `DEVICE_PROFILES` en `shared/constants.js` con mapeo a Playwright `devices[X]`
  - Scan.deviceProfile en DB, propagado a playwright/accessibility/pagespeed runners
  - PageSpeed strategy auto-deriva (mobile/desktop). Grid de 6 botones en Home.

✅ **7.4 Login pre-flight** — 2026-05-14
  - Schema: `Scan.loginConfig` Json? con `{ url, usernameSelector, passwordSelector,
    username, encryptedPassword (AES-256-GCM), submitSelector, postLoginUrl?, waitForSelector? }`
  - `backend/src/runners/login.runner.js` — abre browser, fill form, captura storageState
    (cookies + localStorage). Heurística de "login fallido": URL sin cambios + 0 cookies.
  - Pipeline: si `scan.loginConfig`, corre login pre-flight antes de playwright.capture.
    Pasa storageState a playwright + accessibility runners.
  - Password se cifra en el route handler. GET /api/scan sanitiza (solo `hasPassword: true`).
  - UI: sección "🔐 Scan con autenticación" colapsable en Home con 8 campos.

✅ **7.5 Crawler multi-página** — 2026-05-14
  - Schema: `Scan.mode` (`single|crawl`), `Scan.maxPages` (1-15), `Scan.parentScanId`
    + relación self `parent`/`children` con `onDelete: Cascade`.
  - `backend/src/crawler/discover.js` — cascada: (1) sitemap.xml / sitemap_index.xml
    parsed con regex; (2) fallback a links internos del capture inicial. Dedup +
    clamp a maxPages. Solo URLs del mismo origin.
  - Pipeline parent-child: parent (mode=crawl) corre `processCrawlParent`: descubre
    URLs, crea N child scans en transacción, los encola. Cada child es un scan single
    normal (hereda deviceProfile, userId, loginConfig). Al terminar cada child,
    `maybeCompleteCrawlParent` chequea si todos están en estado terminal → cierra parent.
  - GET /api/scan/:id incluye `children`. GET /api/scan (history) excluye childs
    (filter parentScanId: null).
  - UI: sección "🕷️ Crawler multi-página" en Home. Dashboard muestra `CrawlPanel`.

---

## FASE 8 — Profundidad y conexiones

6. ✅ **Programación de scans (cron + notificaciones)** — 2026-05-14
   - Tabla `ScheduledScan` con cron expr (5 campos), timezone IANA, config completa
     del scan (url, device, engine, mode, maxPages, loginConfig cifrada), y campos de
     notificación: notifyWebhook, notifyEmail, notifyOn (`always | onFailOnly | onWarningOrFail`).
     `Scan.scheduledScanId` enlaza scans disparados por un schedule.
   - `backend/src/schedules/cron.master.js`: tick cada 60s, busca schedules habilitados
     con `nextRunAt <= now`, crea Scan + enqueueScan + recalcula `nextRunAt` con
     `cron-parser`. Flag `ENABLE_SCHEDULER=false` para deshabilitar (dev local sin Postgres).
   - `backend/src/notify/notifier.js`: al terminar un scan-from-schedule, evalúa
     `shouldNotify(notifyOn, summary)` y dispara webhook + email en paralelo (safe-call).
     Webhook usa payload `{ text, content }` para Slack/Discord. Email usa nodemailer
     con SMTP via `SMTP_HOST/PORT/USER/PASS/FROM`.
   - API `/api/schedules` CRUD + `POST /:id/run` + `POST /validate-cron`. Scoped al user.
   - UI: vista `/schedules` con tabla + form colapsable. Deps: `cron-parser@5`, `nodemailer@8`.

7. ✅ **PDF reports con identidad visual** — 2026-05-14
   - `backend/src/reports/pdf.renderer.js` usa Playwright (Chromium) para renderizar
     el mismo HTML del template inline y exportar `page.pdf()`. A4 vertical, márgenes
     16/14mm, header + footer con paginación, `printBackground: true`.
   - Endpoint: `GET /api/report/:id/export?format=pdf`. Botón en `ReportDetail`
     (descarga vía `aiApi`, timeout 180s).

8. ✅ **Cross-browser (Firefox + WebKit)** — 2026-05-14
   - `shared/constants.js`: `BROWSER_ENGINES` (chromium/firefox/webkit) +
     `DEFAULT_BROWSER_ENGINE = chromium`. Schema agrega `Scan.browserEngine`.
   - Helper `backend/src/runners/browser.js` con `launchBrowser()` y `resolveEngine()`.
     Maneja `PLAYWRIGHT_CHANNEL` solo para Chromium (Firefox/WebKit lo rechazan).
   - Runners (playwright, accessibility, login) y `crawler/discover.js` aceptan
     `browserEngine` opt-in. Queue lo propaga a todos + a los child scans del crawl.
   - UI: grid de 3 botones en Home; Dashboard muestra badge.
   - **Setup local**: `cd backend && bunx playwright install firefox webkit`. En
     Railway no hace falta (la imagen `v1.60.0-jammy` trae los 3).

9. ✅ **Visual regression testing** — 2026-05-14
   - Tabla `Screenshot` (scanId, url, deviceProfile, browserEngine,
     kind=`baseline|current|diff`, width, height, dataB64) con índice por
     `(url, deviceProfile, browserEngine, kind)`.
   - Categoría `TEST_CATEGORY.VISUAL` + stage `ANALYZING_VISUAL`.
   - `analyzers/visual.analyzer.js`: lee screenshot del `playwright.capture`, busca
     último baseline. Sin baseline → guarda current como baseline + INFO. Con baseline
     → pixelmatch (threshold 0.1, alpha 0.3) → diff PNG.
   - Thresholds: mismatch ≥5% o size mismatch → FAIL; ≥1% → WARNING; sino PASS.
     Score = clamp(100 − mismatch% − 10·sizeMismatch, 0, 100).
   - Endpoint `GET /api/scan/:id/screenshot/:kind`. Panel "Visual regression" en
     ReportDetail con 3 thumbs. Deps: `pixelmatch`, `pngjs`.

10. ✅ **Integración Jira (crear bug desde un FAIL)** — 2026-05-20
    - Schema: `JiraConfig` (1 por usuario — baseUrl + email + `encryptedToken`
      AES-256-GCM + `hint` + projectKey/issueType default) y `JiraIssueLink`
      (enlaza un `Result` con el issue creado: `issueKey`, `issueUrl`). Relaciones
      en `User` y `Scan` con `onDelete: Cascade`.
    - `backend/src/integrations/jira.client.js`: cliente REST de Jira Cloud (auth
      Basic email:token), `testConnection`/`listProjects`/`createIssue`, helpers ADF
      (Atlassian Document Format — requerido por la API v3). `JiraError` con `status`+`code`.
    - `backend/src/integrations/jira.issue.js`: arma summary + descripción ADF desde
      un `Result` (URL, categoría, hallazgos: axe/links rotos/headers/mismatch visual).
    - API `/api/integrations/jira` (scoped al user): `GET/PUT/DELETE` config,
      `POST /test`, `GET /projects`, `GET /issues?scanId=`, `POST /issue`.
    - UI: vista `/settings/jira` + botón **🐞 Crear bug** en cada `TestCard` con
      FAIL/WARNING. El token reusa `SECRET_ENCRYPTION_KEY` (no requiere envs nuevas).

11. ✅ **JUnit XML export** — 2026-05-14
    - `backend/src/reports/junit.template.js`: emite `<testsuites>` con un
      `<testsuite>` por categoría y un `<testcase>` por Result. Maps:
      `fail`→`<failure type="failure">`, `warning`→`<failure type="warning">`
      (configurable via `JUNIT_TREAT_WARNINGS=skipped`), `pass|info`→sin tag.
    - CDATA con resumen útil para CI: violations de axe (top 5), broken links, etc.
    - Endpoint `GET /api/report/:id/export?format=junit` (alias `xml`).
    - Compatible con GitHub Actions, GitLab CI, Jenkins, CircleCI, Bitbucket, Azure DevOps.

---

## Diferenciadores (FASE 9+)

> Orden de prioridad acordado 2026-05-29: 12 → 13 → 15, después el resto.

12. ✅ **AI auto-healing de selectores** — v1 2026-05-29 (solo Playwright)
    - `backend/src/generators/selector.extract.js`: extrae selectores del script
      Playwright con regex (`getByRole`/`getByTestId`/`getByText`/`getByLabel`/
      `getByPlaceholder`/`locator`), los reconstruye con la API real de Playwright
      (sin eval) para verificarlos, y aplica reemplazos textuales. Lo no parseable
      (p.ej. `name: /regex/`) se marca `no-verificable`.
    - `backend/src/generators/selector.healer.js`: carga la URL del scan **en vivo**
      (reusa `launchBrowser` + `buildContextOptions` exportado de playwright.runner +
      `runLoginPreflight`), testea cada selector con `page.locator().count()`, y para
      los `no-resuelto` pide al LLM (`generateStructured`) un reemplazo usando un
      resumen del DOM actual. Timeouts duros con Promise.race.
    - Endpoint `POST /api/scripts/:scanId/heal` body `{ provider?, model?, apply?,
      healedContent? }`. Sin apply → preview. Con apply + healedContent → persiste el
      contenido ya revisado (NO recomputa). Advisory: nunca sobreescribe sin confirmación.
    - UI: botón "🩹 Sanar selectores" + panel en la pestaña Playwright de `ScriptGenerator.jsx`.
    - **Pendiente**: e2e en prod; extender a Cypress/Selenium (v2).

13. ✅ **AI exploratory testing** — v1 2026-05-29 (agente DOM-texto, sesión independiente)
    - Un agente de IA maneja un browser Playwright autónomo: observa los elementos
      interactivos visibles, decide la acción (click/fill/navigate/back/finish) vía
      `generateStructured`, la ejecuta de forma segura y acumula errores de consola/HTTP.
      Pasada final del LLM consolida hallazgos. Provider-agnóstico (texto por paso).
    - Modelo `ExploratorySession` (independiente, NO ligado a Scan). Queue propia
      `qa-forge-explore` (`backend/src/queue/explore.queue.js`, con `ExploreContext`).
      Agente en `backend/src/agents/explore.agent.js`. Rutas `/api/explore` (CRUD +
      cancel, `requireAuth`). Eventos socket `explore:*`.
    - Guardrails: same-origin duro (vuelve atrás si se va), system prompt prohíbe
      acciones destructivas (logout/borrar/pagar), acotado por `maxSteps` (default 15,
      cap 40), timeouts duros, acción por índice taggeado (`data-qaforge-idx`, sin eval).
    - UI: vista `/explore` (form + lista) + `/explore/:id` (trail + hallazgos en vivo
      por socket). Cada hallazgo se puede **mandar al repositorio** (crea TestCase,
      reusa `applyTestCaseActions`). Sin Jira en v1.
    - **Pendiente**: e2e en prod; percepción con visión/screenshots (v2).

14. ✅ OWASP ZAP — v1 2026-05-30 (ver "OWASP ZAP" al final).
15. ✅ Native iOS/Android — v1 2026-05-30 (ver "Native app testing" al final).

---

## Flow Runner determinista — v1 (2026-05-30)

Cierra el gap de [[project_e2e_execution_direction]]: QA Forge ahora **ejecuta**
flujos e2e completos (deterministas, repetibles), no solo los genera. Es el
"harness de ejecución del agente exploratorio promovido a flow-runner con asserts".

**Modelo de datos** (`schema.prisma`):
- `Flow` — definición reusable: `name`, `url` inicial, `deviceProfile`,
  `browserEngine`, `loginConfig` (cifrado, opcional), `steps` (Json),
  `continueOnError`, `source` (`manual|script|exploratory`), `sutId?`. Relación
  `User.flows`.
- `FlowRun` — una ejecución: `status` (`pending|running|passed|failed|error|
  cancelled`), `stepResults` (Json: `{ index, action, selector, value, status,
  message, durationMs, url, screenshotB64? }`), `summary`
  (`{ total, passed, failed, skipped, durationMs }`), `cancelRequestedAt`,
  timestamps. `onDelete: Cascade` desde Flow.

**Constants** (`shared/constants.js`): `FLOW_ACTIONS` (16), `FLOW_ACTION_META`
(label + needsSelector/needsValue + group + hint — compartido con el step-builder
del frontend vía alias `@shared`), `FLOW_SOURCE`, `FLOW_RUN_STATUS`,
`FLOW_STEP_STATUS`, `MAX_FLOW_STEPS=60`, `FLOW_STEP_TIMEOUT_MS=10s`,
`FLOW_QUEUE_NAME='qa-forge-flow'`, eventos socket `FLOW_*`.

**Ejecutor** (`backend/src/runners/flow.runner.js`):
- Determinista, sin LLM: mismos pasos → mismo resultado. Reusa `launchBrowser`
  (cross-engine), `buildContextOptions` (device + storageState) y
  `runLoginPreflight` (sesión autenticada opcional).
- `selector` se pasa a `page.locator(sel).first()` — acepta CSS, `text=`, `xpath=`
  y selector engines de Playwright. Sin eval.
- Aserciones fallidas = `failed` (no excepción): no rompen la corrida, devuelven
  mensaje claro. `assertVisible/Hidden` via `waitFor`, `assertText/Value` leen
  innerText/inputValue, `assertUrl/Title` chequean substring (case-insensitive).
- Screenshot viewport base64 en cada paso `failed` (best-effort, ~10KB).
- `continueOnError`: default false → corta al primer fallo y marca el resto
  `skipped`; true → corre todos. Timeouts duros por paso (Promise.race).

**Queue** (`backend/src/queue/flow.queue.js`): espejo de explore.queue —
`enqueueFlowRun` (inline si Redis caído), `startFlowWorker`, `FlowContext`
(poll `cancelRequestedAt` + AbortController + cleanups), `processFlowRun`
persiste resultado + emite socket.

**API** (`backend/src/api/routes/flow.routes.js`, `requireAuth`, scoped al user):
- `POST /api/flows` (crear, valida pasos con superRefine según FLOW_ACTION_META),
  `GET /api/flows` (lista slim + última corrida), `GET/PUT/DELETE /api/flows/:id`,
  `POST /api/flows/:id/run`, `GET /api/flows/:id/runs`.
- `GET /api/flows/runs/:runId` (detalle con stepResults), `POST .../cancel`.
  Las rutas `/runs/*` van antes de `/:id`. Password de login cifrada con
  `auth/crypto`, sanitizada en las respuestas (`hasPassword`).

**Frontend**:
- `/flows` (`Flows.jsx`) — lista + correr/borrar + última corrida.
- `/flows/new` y `/flows/:id` (`FlowEditor.jsx`) — step-builder (dropdown agrupado
  de acciones, selector/value condicionales según metadata, reordenar/quitar),
  login pre-flight colapsable, "Guardar y correr", historial de corridas en edición.
- `/flows/runs/:runId` (`FlowRunView.jsx`) — corrida en vivo por socket: cada paso
  con icono pass/fail, mensaje, duración y screenshot del fallo expandible.
- NavBar: link "Flujos".

**Validación**:
- ✅ `prisma generate` + schema válido; todos los módulos backend importan limpio.
- ✅ Frontend buildea (142 KB index gz 44 KB); `@shared/constants.js` resuelve en Vite.
- ✅ **Ejecutor probado en vivo** (node + Chromium, sin DB/Redis) contra página
  local: las 6 aserciones + fill/click/navigate OK, fallos con mensaje + screenshot,
  summary correcto, y stop-on-first-failure marca `skipped` el resto.
- ⏳ Pendiente: `prisma db push` contra Postgres real — lo corre el usuario local y
  Railway en cada deploy. e2e en prod.

### Flow Runner v2 (2026-05-30, mismo día)

Cuatro capacidades sobre la v1:

**1. Asserts de consola/red.** El runner suma listeners (`console`/`pageerror`/
`response`/`requestfailed`) que acumulan `signals = { consoleErrors, httpErrors }`
durante toda la corrida. Dos acciones nuevas (`assertNoConsoleErrors`,
`assertNoHttpErrors`) que fallan si hay errores acumulados. `signals` se persiste en
`FlowRun.signals` + counts en `summary`. UI: `SignalsPanel` colapsable en `FlowRunView`.
Verificado en vivo (página con `console.error` → assert falla).

**2. Importar desde sesión exploratoria** (`backend/src/generators/flow.import.js`).
Conversión heurística + lossy: el agente opera por índice efímero y guarda
`targetDesc` textual (`[3] button "Login"`). Derivamos selectores best-effort —
clickeables → `text=<nombre>`, inputs → `[aria-label=..], [placeholder=..], [name=..]`.
`navigate` → `goto`; `back/finish/error/blocked` se descartan. El Flow nace con
`source='exploratory'` y descripción que avisa "revisá los selectores". Ruta
`POST /api/flows/from-exploration/:sessionId`. UI: botón "🎬 Convertir a flujo" en
`ExploreSession` (cuando la sesión terminó y tiene pasos convertibles).

**3. Programar flows via cron** (`ScheduledFlow`). Modelo nuevo (cron + timezone +
notify webhook/email + notifyOn `always|onFailOnly` + nextRunAt/lastRunId). `cron.master`
refactorizado a `tickModel(model, fire, now)` + `bootstrapModel` para procesar
**scans y flows** en el mismo tick (DRY). `fireFlowSchedule` crea un `FlowRun` con
`scheduledFlowId` y lo encola. `notifier.notifyFlowRunComplete` reusa los canales
webhook/email con un payload flow-aware (link a `/flows/runs/:id`). `FlowRun.scheduledFlowId`
enlaza la corrida; `processFlowRun` dispara la notificación al cerrar. Rutas
`/api/flows/schedules` (CRUD + `/:id/run`), valida cron con `computeNextRunAt`. UI: panel
"Programación" en `FlowEditor` (presets, preview del próximo run vía `validate-cron`
reusado, pausar/correr/borrar).

**4. Exportar flow a script** (`backend/src/generators/flow.export.js`, conversor puro).
Flow → Playwright (TS) / Cypress (JS) / Selenium (Python). Cada acción mapea 1:1 a la API
del framework; los selectores `text=`/`xpath=` se traducen en Playwright (nativo) y
Selenium (XPATH), con caveat anotado en Cypress (solo CSS). Playwright emite setup de
listeners si el flow usa asserts de consola/red. Ruta `GET /api/flows/:id/export?framework=`.
UI: botones de descarga en `FlowEditor`. Verificado: los 3 outputs generan código válido
(Python con indentación correcta dentro de `try:`).

**Validación v2**: ✅ schema regenera, todos los módulos importan sin ciclos
(`flow.routes → cron.master → flow.queue → notifier` es acíclico), frontend buildea
(484 KB index gz 138), backend bootea con el wiring nuevo, ejecutor + conversores
probados en vivo. ⏳ Pendiente: `prisma db push` (crea `ScheduledFlow` + campos
`FlowRun.signals/scheduledFlowId`) + e2e en prod (especialmente el tick del cron de
flows, que necesita Postgres).

**v3 (futuro)**: percepción visual en el import, reordenar pasos con drag&drop,
asserts de red por patrón (URL/método), import desde scripts generados (parseo Playwright).

---

## Native app testing (#15) — v1 (2026-05-30)

Testing e2e sobre apps móviles iOS/Android. Tercer vertical de ejecución (junto al
web Flow Runner y el agente exploratorio). Habla **Appium** (protocolo W3C WebDriver
sobre HTTP) — provider-agnóstico: Appium local (gratis) o device cloud BrowserStack /
Sauce Labs (pagos). **Sin dependencias nuevas**: cliente HTTP propio con `fetch` (se
descartó `webdriverio` por peso; el usuario rechazó instalarlo).

**Cliente Appium** (`backend/src/integrations/appium.client.js`): W3C WebDriver sobre
`fetch` + AbortController (mismo patrón que `jira.client.js`). `resolveEndpoint(provider,
accessKey)` arma base URL + Basic auth (cloud). Cubre createSession/deleteSession,
findElement (extrae el `element-6066-…` key), click/sendKeys/clear, getText/isDisplayed,
goBack, pressKeycode (Android), swipe (W3C pointer actions), screenshot, getStatus.
`AppiumError` con status+code.

**Modelos** (`schema.prisma`):
- `NativeProvider` (per user, múltiples): type (local|browserstack|saucelabs), label,
  appiumUrl, username (plano), `encryptedAccessKey` (AES-256-GCM) + hint, region.
- `NativeFlow`: providerId, platform (android|ios), deviceName, platformVersion, app
  (bs://… | storage:… | .apk/.ipa | appPackage), automationName, extraCaps (Json),
  steps (Json), continueOnError.
- `NativeFlowRun`: status (reusa FLOW_RUN_STATUS), stepResults, summary, sessionId,
  errorMessage, cancel, timestamps.

**Constants**: `NATIVE_PLATFORMS`, `NATIVE_PROVIDER_TYPES`, `NATIVE_LOCATOR_STRATEGIES`
(accessibility id / id / xpath / class name / -android uiautomator / -ios predicate /
-ios class chain), `NATIVE_ACTIONS` (tap/type/clear/pressKey/swipe/wait/waitFor/back +
assertVisible/assertNotVisible/assertText), `NATIVE_ACTION_META`, `NATIVE_QUEUE_NAME`,
eventos socket `NATIVE_*`.

**Runner** (`backend/src/runners/native.runner.js`): construye capabilities (prefijo
`appium:` para las no estándar + `bstack:options`/`sauce:options` para cloud), crea
sesión, ejecuta los pasos (findElement por estrategia, tap/type/swipe/asserts), screenshot
del device en cada fallo, cierra sesión en `finally`. `continueOnError` igual que el web
runner (corta + skipped). Cancelación vía `NativeContext` (calcado del flow).

**Queue** `qa-forge-native` (`native.queue.js`): carga run + flow + provider, descifra
accessKey, corre, persiste, emite socket. **Rutas** `/api/native`:
- providers: `GET/POST /providers`, `PATCH/DELETE /providers/:id`, `POST /providers/:id/test`
  (test de conectividad vía Appium `GET /status`).
- flows: `GET/POST /flows`, `GET/PUT/DELETE /flows/:id`, `POST /flows/:id/run`,
  `GET /flows/:id/runs`. runs: `GET /runs/:runId`, `POST /runs/:runId/cancel`.

**Frontend**: `/settings/native` (`NativeProviders` — alta de endpoints + test),
`/native` (`NativeFlows` lista), `/native/new` + `/native/:id` (`NativeFlowEditor` con
step-builder + dropdown de estrategia filtrado por plataforma + historial de corridas),
`/native/runs/:runId` (`NativeRunView` en vivo con screenshot del device). NavBar "Native".

**Validación**: ✅ schema regenera, imports sin ciclos, runner + cliente fallan con
gracia sin Appium (mensaje claro "No se pudo conectar a Appium"), backend bootea con el
4º worker, frontend buildea (513 KB index gz 144). ⏳ **NO verificable e2e localmente**:
requiere `prisma db push` + un Appium real (local con emulador, o credenciales cloud) +
un binario de app. El happy-path de ejecución sobre device queda para que lo pruebe el
usuario con su setup.

**v2 (futuro)**: streaming del device en vivo (scrcpy/cloud session URL), importar
locators de Appium Inspector, grabar interacciones → flow, schedulable (reusar cron).

---

## OWASP ZAP security scanning (#14) — v1 (2026-05-30)

Scan de seguridad profundo (DAST) con OWASP ZAP corriendo como daemon. QA Forge es
cliente de su API REST. Profundiza la categoría security (antes solo headers/SSL/
analyzer pasivo). Cliente HTTP propio con `fetch`, sin deps nuevas.

**Cliente ZAP** (`backend/src/integrations/zap.client.js`): API REST de ZAP
(`/JSON/{component}/{view|action}/{name}/?params&apikey=`). version (test), spider
(start/status/results), passive (recordsToScan), active scan (start/status), alerts
(normalizadas: name/risk/confidence/url/description/solution/cweid). `ZapError` con status+code.

**Modelos** (`schema.prisma`):
- `ZapConfig` (1 por user): apiUrl + `encryptedApiKey` (AES-256-GCM, opcional — ZAP puede
  correr sin key) + hint.
- `ZapScan`: url, mode (spider|baseline|full), status (reusa SCAN_STATUS), phase,
  spiderProgress/activeProgress, alerts (Json), summary (`{ byRisk, total, urlsFound }`).

**Runner** (`backend/src/runners/zap.runner.js`): orquesta según modo — spider (poll status
hasta 100%) → passive (poll recordsToScan→0, no fatal si timeout) → active scan (solo `full`,
poll status). Deadlines duros por fase (spider 5m, passive 5m, active 30m). Junta alertas +
summarize por riesgo. Re-throw de cancelación (flag `isCancellation`).

**Queue** `qa-forge-zap` (`zap.queue.js`): carga scan + config, descifra apiKey, corre,
persiste progreso liviano (phase/%) + alertas, emite socket. `ZapContext` con poll de
cancelación + AbortController. **Rutas** `/api/zap`: config (`GET/PUT/DELETE` + `POST
/config/test` vía version), scans (`POST/GET /scans`, `GET /scans/:id`, cancel, delete).

**Frontend**: `/security` (`ZapSecurity` — panel de config colapsable + test, form de nuevo
scan con selector de modo + warning de intrusividad, lista de scans), `/security/:id`
(`ZapScanDetail` — barras de progreso spider/active en vivo por socket, badges por riesgo,
alertas agrupadas High→Informational con descripción/solución/CWE expandibles). NavBar "Security".

**Validación**: ✅ schema regenera, imports sin ciclos, runner + cliente fallan con gracia sin
daemon ("No se pudo conectar a ZAP"), backend bootea con el 5º worker, frontend buildea
(528 KB index gz 148). ⏳ **NO verificable e2e local**: requiere `prisma db push` + un daemon
ZAP corriendo (`docker run -p 8080:8080 zaproxy/zap-stable zap.sh -daemon -host 0.0.0.0 -port
8080 -config api.disablekey=true`). El happy-path de scan queda para el usuario.

**v2 (futuro)**: crear bug Jira desde una alerta (reusar integración Jira), integrar ZAP como
fase opcional del pipeline de scan principal, autenticación/context (scan detrás de login).

---

## FASE 9 — Runner de casos manuales

Runner de ejecución manual + sugerencias + bug Jira + corridas + editar/borrar
cualquier caso. Pusheado 2026-05-20 (commit `c767e9f`). Ver memoria
[[project_fase9_manual_runner]].

## FASE 10 — Repositorio de casos por SUT

Repositorio de casos por SUT (compartido) + chatbot IA propone-y-confirma +
integración con scans/runner. Deployado y live en prod 2026-05-20 (commits
`c767e9f` + `fa7247c`). Ver memoria [[project_fase10_repository]].
