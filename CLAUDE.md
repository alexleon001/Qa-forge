// QA Forge — Session Context para Claude Code

# QA Forge — Session Context

## Proyecto

**QA Forge** es una herramienta de QA automatizado. Recibe una URL, ejecuta una
batería de pruebas funcionales y no funcionales sobre ella (Playwright para
DOM/screenshots, headers HTTP, SSL/TLS, accesibilidad, performance, SEO, links,
forms, seguridad) y genera scripts de automatización listos para usar en
**Playwright (TS)**, **Cypress (JS)** y **Selenium (Python)** mediante Claude API.

El repositorio convive con una **plantilla AI-Driven** (`.context/`, `.prompts/`,
`.books/`, `docs/`, `cli/`, `scripts/`, `templates/`) que aporta la metodología
IQL + KATA y prompts/guidelines. **No tocar la plantilla** salvo para extender
documentación de QA Forge.

---

## Stack

### Backend (`backend/`)

- Runtime: **Bun** (compatible con Node.js 20+ APIs)
- Framework: **Express.js**
- Browser automation: **Playwright** (headless Chromium)
- Queue: **BullMQ + Redis** (jobs async de scan). Se cambió `bull` → `bullmq` en
  FASE 1 por incompatibilidad de `bull` con Bun en Windows (sus Lua scripts no
  se resuelven). BullMQ es el sucesor oficial del mismo equipo.
- DB: **SQLite** (dev) / **PostgreSQL** (prod) con **Prisma ORM**
- Real-time: **Socket.io** (server)
- Seguridad: custom HTTP headers checker + `ssl-checker`
- Performance: **Google PageSpeed Insights API** (tier gratuito)
- IA: **Claude API** modelo `claude-sonnet-4-6` para generación de scripts

### Frontend (`frontend/`)

- **React 18 + Vite**
- **Tailwind CSS** + **shadcn/ui**
- Estado: **Zustand**
- Real-time: **Socket.io client**
- Charts: **Recharts**
- Code highlight: **Shiki**

### DevOps

- Docker + docker-compose (Redis + Postgres en FASE 4)
- `.env` con `dotenv`

---

## Puertos

| Servicio  | Puerto |
| --------- | ------ |
| Backend   | 3001   |
| Frontend  | 5173   |
| Redis     | 6379   |
| Postgres  | 5432   |

---

## Convenciones

1. **Código en inglés, comentarios en español** (los identificadores no se traducen).
2. **Async/await siempre**, nunca callbacks.
3. **Cada runner devuelve `{ status, data, error }`** con `status` ∈ `pass | fail | warning | info`.
4. **Fail gracefully**: ningún error individual rompe el scan completo. Capturar
   excepciones y persistir como `Result` con `status: "fail"`.
5. **Variables de entorno**: siempre desde `process.env`, nunca hardcodear secrets,
   URLs, puertos o API keys.
6. **Cada archivo `.js`/`.jsx` arranca con un comentario de propósito** en la primera línea.
7. **Modelo Claude**: usar la constante `CLAUDE_MODEL` exportada desde
   `shared/constants.js` (`claude-sonnet-4-6`). No hardcodear el modelo en el generator.
8. **Sin tipos `any` ni `// @ts-ignore`** si se llega a migrar a TS.
9. **Imports relativos** con extensión explícita (`.js` / `.jsx`) — Bun + ESM lo exige.
10. **DRY**: la lista de runners de FASE 1 está centralizada en `backend/src/queue/scan.queue.js`.

---

## Modelo de datos (resumen)

- `Scan` (id, url, status `pending|running|completed|failed`, timestamps)
- `Result` (scanId, category, testName, status, score, details `JSON`)
- `Script` (scanId, framework, language, content)

Schema completo en `backend/src/db/schema.prisma`.

---

## Categorías de tests (`shared/constants.js`)

`functional | security | performance | accessibility | seo`

---

## Cómo correr

### Modo dev local (recomendado para iterar)

> ⚠️ **Backend en Windows: usar `node`, no `bun`.** El runtime preferido del proyecto
> sigue siendo Bun (dependencias, scripts, prisma, etc.), pero **al ejecutar el
> proceso backend (`src/index.js`) en Windows hay que usar Node** porque Bun + Playwright
> en Windows falla: Chromium se lanza pero la comunicación por pipe
> (`--remote-debugging-pipe`) entre Bun y `chrome-headless-shell` nunca se establece,
> y todo scan timeoutea en 180s con `launch: Timeout 180000ms exceeded` (visto en
> sesión 2026-05-12). Con Node anda OK. En Linux/Mac (ej. dentro del contenedor
> Docker basado en `mcr.microsoft.com/playwright`) Bun anda bien.

```bash
# Infra: Redis + Postgres (ambos necesarios — schema.prisma usa postgresql)
docker compose up redis postgres -d

# Backend (otra terminal)
cd backend
cp .env.example .env       # rellenar GEMINI_API_KEY (default, free) o la que uses
bun install                # bun sí para instalar
bunx prisma generate
bunx prisma db push        # crea las tablas en el postgres local
bunx playwright install chromium
node src/index.js          # ← Node, NO bun. Express + Socket.io en :3001

# Frontend (otra terminal) — bun acá anda perfecto
cd frontend
bun install
bun run dev                # Vite en :5173
```

#### Workaround alternativo si querés mantener Bun

Setear `PLAYWRIGHT_CHANNEL=chrome` (o `msedge`) antes de arrancar — eso fuerza
a Playwright a usar el Chrome/Edge del sistema en vez del `chrome-headless-shell`
bundled, que sí logra hablar con Bun. Los runners `playwright.runner.js` y
`accessibility.runner.js` ya leen esa variable.

```powershell
$env:PLAYWRIGHT_CHANNEL = "chrome"
bun run src/index.js
```

### Modo stack completo (todo en contenedores)

```bash
# Setear claves opcionales en el shell antes de levantar
export ANTHROPIC_API_KEY=sk-ant-...   # FASE 3
export PAGESPEED_API_KEY=...          # FASE 2 (opcional)

docker compose --profile full up -d --build
# Frontend: http://localhost:5173
# Backend:  http://localhost:3001
```

---

## Deploy a producción (Railway + Vercel)

**Frontend** va a Vercel; **backend** va a Railway (necesita contenedor con
Playwright + worker BullMQ + Redis + Postgres). Vercel serverless no soporta
ninguna de esas cosas, por eso el split.

### 1. Railway — backend

1. Crear proyecto en https://railway.app conectando el repo de GitHub.
2. Agregar 2 plugins desde la UI: **Postgres** y **Redis** (1 click cada uno).
3. Crear un servicio "backend" que apunte al repo. Railway detecta el
   `railway.toml` en la raíz (build via `backend/Dockerfile`).
4. Setear envs del servicio:
   - `DATABASE_URL` → referenciar la del plugin Postgres (`${{Postgres.DATABASE_URL}}`)
   - `REDIS_URL` → `${{Redis.REDIS_URL}}`
   - `FRONTEND_URL` → URL final de Vercel (se setea después; *.vercel.app
     ya se acepta por default — ver `ALLOW_VERCEL_PREVIEWS`)
   - `AI_PROVIDER=gemini` (o el que prefieras)
   - `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / etc. según el provider elegido
   - `PAGESPEED_API_KEY` (opcional)
   - `NODE_ENV=production`
5. Generar un dominio público (Settings → Networking → Generate Domain).
   Anotá la URL (en prod es `https://qa-forge-production.up.railway.app`).
6. Healthcheck: `/api/health` (ya configurado en `railway.toml`).

### 2. Vercel — frontend

1. New Project en https://vercel.com importando el repo.
2. **Root Directory**: `frontend`.
3. Framework: Vite (auto-detect). El `vercel.json` ya define build commands.
4. Env var: `VITE_API_URL=https://<tu-backend>.up.railway.app`
5. Deploy. Vercel da el dominio (`https://qa-forge-xyz.vercel.app`).
6. Volver a Railway y setear `FRONTEND_URL` con ese dominio.

### 3. Notas

- **CORS**: el backend acepta `FRONTEND_URL` (lista separada por coma) +
  cualquier `*.vercel.app` (preview deploys) salvo que setees
  `ALLOW_VERCEL_PREVIEWS=false`.
- **Costos**: Vercel free alcanza. Railway tiene $5 trial; luego ~$5-10/mes
  por el backend + Postgres + Redis.
- **Schema migrations**: el startCommand corre `prisma db push` en cada deploy
  (idempotente). Para esquemas más serios migrar a `prisma migrate deploy`.
- **Modelo demo**: si querés exponerlo público, considerar agregar rate limit
  + auth básica (post-MVP, hoy no está implementado).

---

## Estado actual

> **Última fase completada:** FASE 8 COMPLETA (10/10 items + JUnit XML)
> **Última sesión:** 2026-05-20 (FASE 8.10 integración Jira — cierra FASE 8)
> **Producción**: https://qaforge-chi.vercel.app — con auth funcional + admin creado
>
> **Audiencia**: uso personal del owner + equipo chico de QA. **No comercial** (por ahora).
> Si en el futuro pivota a vender: ver [[project-future-auth-apikeys]] y el roadmap de FASE 7
> abajo, que sirve como base multi-user → multi-tenant.

### Implementado

- ✅ Scaffold raíz: `CLAUDE.md`, `docker-compose.yml`, `.env.example` extendido
- ✅ Backend scaffold: Express + Socket.io + Prisma + Bull queue
- ✅ Runners FASE 1: `playwright.runner.js`, `headers.runner.js`, `ssl.runner.js`
- ✅ API: `POST /api/scan`, `GET /api/scan/:id`
- ✅ Queue Bull con eventos hacia Socket.io
- ✅ Frontend scaffold: Vite + Tailwind + Zustand + Socket.io client
- ✅ Vistas: `Home`, `Dashboard` (progreso en tiempo real)
- ✅ `shared/constants.js`

### FASE 2 — Implementado

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

### FASE 3 — Implementado

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

### FASE 4 — Implementado

- ✅ Vista `History` en `/history`: lista paginada (últimos 50), agrupada por
  URL, filtro de búsqueda inline, links a Progreso/Reporte/Scripts por scan,
  botón "Comparar últimos 2" cuando hay ≥ 2 scans de la misma URL
- ✅ Vista `Compare` en `/compare?a=<id>&b=<id>`: trae los 2 reportes en paralelo,
  computa diff de scores por categoría con deltas coloreados (+verde / −rojo),
  ScoreGauges lado a lado y tabla resumen
- ✅ Header nav: link "History" activo (antes decía "FASE 4")
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

### FASE 5 — Implementado

> Pedido del usuario: no depender solo de Anthropic (paga) y abrir alternativas
> gratuitas (Gemini free tier, Ollama local). Implementado los 5 providers
> elegidos.

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
  (configurados habilitados, no configurados disabled con etiqueta).
  El default se selecciona automáticamente al primer configurado.
- ✅ `.env.example` documenta todas las API keys + override por modelo:
  `AI_PROVIDER`, `AI_MODEL_*`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
  `OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`, `OPENROUTER_REFERER`
- ✅ `docker-compose.yml` pasa todas las envs al contenedor backend.
  `OLLAMA_BASE_URL` default `host.docker.internal:11434` para que el container
  llame a Ollama corriendo en el host.

### Validación FASE 5

- ✅ `bun install @google/genai openai` OK
- ✅ Backend bootea con todos los providers cargados
- ✅ `GET /api/scripts/providers` devuelve los 5 con `configured: false` (esperado
  sin keys ni Ollama)
- ✅ Frontend buildea: 286 KB JS (gz 94 KB) — sin cambio significativo
- ⚠️ Para validar generación real con cada provider hace falta setear la key
  respectiva y completar un scan primero. **El default `gemini` permite
  usar la herramienta gratis con solo una key de Google AI Studio.**

### Setup rápido por provider

| Provider | Setup |
|---|---|
| Gemini (default, free) | https://aistudio.google.com/apikey → `GEMINI_API_KEY=...` |
| Anthropic | https://console.anthropic.com → `ANTHROPIC_API_KEY=...` |
| OpenAI | https://platform.openai.com/api-keys → `OPENAI_API_KEY=...` |
| OpenRouter | https://openrouter.ai/keys → `OPENROUTER_API_KEY=...` |
| opencode Zen | https://opencode.ai/zen → Claves API → `OPENCODE_API_KEY=...` |
| Ollama (local) | `ollama serve` + `ollama pull qwen2.5-coder:7b` |

> **opencode Zen (agregado 2026-05-20)**: 6º provider. Gateway OpenAI-compatible
> (`https://opencode.ai/zen/v1`) con modelos curados para coding (Claude, GPT-5,
> Gemini, Qwen, GLM, etc.). `backend/src/generators/providers/opencode.provider.js`
> calcado del de OpenRouter (SDK de OpenAI + baseURL custom). `response_format`
> es best-effort: si el modelo lo rechaza (400/422), reintenta sin él. Default
> `claude-sonnet-4-5`, override con `AI_MODEL_OPENCODE`. Hay modelos `*-free`.
>
> **Orden del dropdown de providers** (registry en `providers/index.js`):
> OpenAI (ChatGPT) → opencode Zen → Anthropic Claude → Gemini → OpenRouter →
> Ollama. `DEFAULT_PROVIDER_ID` ahora cae a `openai` (antes `gemini`); el
> default real lo fija `AI_PROVIDER` en el env.

### FASE 6 — Implementado

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
  - Mismo patrón que `ScriptGenerator`: dropdown de provider, textarea adicional
  - Acordeón por categoría con badge de prioridad
  - Export a **Markdown / CSV / JSON** (compatible con Jira/TestRail/Zephyr import)
- ✅ Links cruzados desde Dashboard, ReportDetail y ScriptGenerator

### Deploy a producción (2026-05-13)

- ✅ Migración del schema a **Postgres** (`provider = "postgresql"` en `schema.prisma`)
- ✅ CORS multi-origen: `FRONTEND_URL` acepta lista CSV + `*.vercel.app` por default
  (flag `ALLOW_VERCEL_PREVIEWS=false` para desactivar)
- ✅ Socket cliente cae a `VITE_API_URL` si no se setea `VITE_SOCKET_URL`
- ✅ `railway.toml` en la raíz (build via `backend/Dockerfile`, healthcheck `/api/health`)
- ✅ `frontend/vercel.json` (build con Vite + SPA rewrites)
- ✅ docker-compose: postgres movido fuera del profile `full` para dev local
- ✅ Bind `0.0.0.0` + `preDeployCommand` separado de `startCommand` (Railway exec form, no shell)
- ✅ Healthcheck timeout 300s para el primer `prisma db push` contra Postgres fresco
- ✅ Bump Playwright image a `v1.60.0-jammy` (matchea el npm `playwright` que viene en bun.lock)

**Producción live**:
- Frontend: https://qaforge-chi.vercel.app
- Backend: https://qa-forge-production.up.railway.app (Railway service `Qa-forge`
  con plugins Postgres + Redis). Plan **Hobby** desde 2026-05-20 (el trial expiró).

### Sesión 2026-05-13 (post-deploy) — Mejoras UX + bugs críticos

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
- ✅ Hidratación correcta del Dashboard al refrescar (stage + message + errorMessage
  + startedAt/completedAt vienen del backend)

**Bugs críticos resueltos**
- 🐛 **`ssl-checker` incompatible con Bun** — usaba `https.request → res.socket.getPeerCertificate()`
  que en Bun no existe. El TypeError salía async fuera del try/catch y mataba el process →
  Railway reiniciaba container → BullMQ retry infinito → `job stalled more than allowable limit`.
  **Fix**: `ssl.runner.js` reescrito con `node:tls.connect()` directo (compat con Bun).
- 🛡️ **Safety nets globales**: `process.on('uncaughtException')` + `('unhandledRejection')` en
  `index.js` — log pero NO matan el process. Previene futuros restart loops.
- ⏱️ **SSL timeout** duro de 10s vía Promise.race (handshake colgaba indefinido en sitios lentos)
- ⏱️ **Axe analyze timeout** duro de 20s (DOMs grandes lo colgaban)
- ⏱️ **Frontend axios** ahora tiene 2 clientes: `api` (30s) para REST normal,
  `aiApi` (180s) para `/api/scripts` y `/api/manual-cases` (LLMs free pueden tardar)
- 🔢 `HTTP_REQUEST_TIMEOUT_MS`: 15s → 8s
- 🔢 `MAX_LINKS_TO_CHECK`: 50 → 30
- 🔢 `PAGESPEED_TIMEOUT_MS`: 45s → 60s (constante)

**Providers — UX de errores**
- ✅ `gemini.provider.js`: `parseGeminiError` mapea 429/401 a códigos HTTP correctos
  con mensaje friendly (cuota agotada, regenerar key, cambiar provider)
- ✅ `openrouter.provider.js`: parser similar para 429/401/402/404 — explicita rate
  limit en modelos `:free`, link a comprar crédito
- ✅ `openai.provider.js`: parser 429/401/402 + **`sanitizeSchemaForOpenAI`** —
  strict mode requiere todas las properties en `required`; los opcionales se
  convierten a union nullable `["X", "null"]` recursivamente
- ✅ ScriptGenerator y ManualCases manejan status 429 / 401 con mensajes específicos

**Prompts pro (2026-05-13)**
- ✅ `script.generator.js` SYSTEM_PROMPT reescrito: 6-10 tests por framework
  (vs 3-4 antes), cobertura de auth/navegación/forms negativos/búsqueda/ecommerce,
  selectores en orden de preferencia, async/await + waits explícitos, imports
  por framework documentados
- ✅ `manualcases.generator.js` SYSTEM_PROMPT reescrito: 15-25 casos detallados
  (vs ~9 antes), cobertura mínima explícita por categoría con counts:
  - Funcional: 6-10 (login con XSS/SQLi/empty, búsqueda, carrito, navegación...)
  - Seguridad: 4-6 (headers, rel=noopener, cookies, rate-limit login)
  - A11y: 3-5 (teclado, screen readers, zoom 200%)
  - Performance: 2-3 (load < 3s en 4G, lazy loading)
  - SEO: 2-3 (title/meta/OG, sitemap, H1 único)
- Recomendado: con `gpt-4o` (no `gpt-4o-mini`) el seguimiento de instrucciones largas
  es notablemente mejor. `AI_MODEL_OPENAI=gpt-4o` en Railway.

> **Modelo default actualizado (2026-05-29)**: el default del provider OpenAI pasó
> de `gpt-4o-mini` → **`gpt-5.4`** (frontier coding a costo medio, sigue mejor los
> SYSTEM_PROMPT largos). `openai.provider.js` ahora detecta modelos de razonamiento
> (`gpt-5.x` / `o-series`) con `isReasoningModel()` y usa `max_completion_tokens`
> sin `temperature` (los reasoning models rechazan ambos del mundo gpt-4o). gpt-4o
> legacy sigue funcionando por la misma rama condicional. **Anthropic `claude-sonnet-4-6`
> queda disponible como opción en el dropdown** (es el `defaultModel` de ese provider).
> ⚠️ Si Railway tiene `AI_MODEL_OPENAI` seteado (p.ej. `gpt-4o`), ese env **pisa** el
> default del código — hay que actualizarlo/borrarlo en el dashboard para que tome `gpt-5.4`.

### FASE 7 — Roadmap acordado (uso personal + equipo chico)

> Pedido del usuario (2026-05-13): construir QA Forge para uso propio + compartir
> con su equipo de QA. **NO comercial** por ahora — evitar over-engineering enterprise.
> Ver memoria [[project-audience-personal-use]] para detalles.

**Fase 7 — compartible con el equipo:**

✅ **7.1 Auth simple** (user/pass + JWT) — **implementado 2026-05-13** (commit `f9a98c7`)
  - Schema: `User` (email/passwordHash/name/role) + `UserApiKey` + `Scan.userId`
  - Helpers: `backend/src/auth/{crypto.js,jwt.js}` — AES-256-GCM + bcrypt + JWT
  - Endpoints `/api/auth/register|login|me`, middleware `attachUser`+`requireAuth`
  - Primer user registrado = admin automático
  - Flag `ALLOW_REGISTRATION` para cerrar registros
  - Frontend: vistas `/login` `/register`, `useAuthStore` con localStorage,
    interceptor axios, RequireAuth wrapper, NavBar dinámico

✅ **7.2 API keys in-app** por usuario — **implementado 2026-05-13** (mismo commit)
  - Keys cifradas AES-256-GCM en `UserApiKey.encryptedKey` (con `SECRET_ENCRYPTION_KEY`)
  - `hint` visible (4 primeros + 4 últimos chars) para identificar
  - Una key default por (user, provider)
  - CRUD endpoints `/api/user/api-keys` + PATCH `/default`
  - `resolveProvider({ requestedId, userId })` usa key del user primero, fallback al env
  - Vista `/settings/api-keys` con form + listado + marcar default + borrar

✅ **7.8 Mobile web** — viewport switcher — **implementado 2026-05-13** (commit `d19ac62`)
  - 6 perfiles: desktop, desktop-1080p, tablet (iPad Pro 11), iPhone 13, iPhone 15 Pro, Pixel 7
  - `DEVICE_PROFILES` en `shared/constants.js` con mapeo a Playwright `devices[X]`
  - Scan.deviceProfile en DB, propagado a playwright/accessibility/pagespeed runners
  - PageSpeed strategy auto-deriva (mobile profiles → mobile, desktop profiles → desktop)
  - Frontend: grid de 6 botones en Home con emoji icons + badge en Dashboard/Report

✅ **7.4 Login pre-flight** — **implementado 2026-05-14**
  - Schema: `Scan.loginConfig` Json? con `{ url, usernameSelector, passwordSelector,
    username, encryptedPassword (AES-256-GCM), submitSelector, postLoginUrl?, waitForSelector? }`
  - `backend/src/runners/login.runner.js` — abre browser, fill form, captura storageState
    (cookies + localStorage). Heurística de "login fallido": URL sin cambios + 0 cookies.
  - Pipeline: si `scan.loginConfig`, corre login pre-flight antes de playwright.capture.
    Pasa storageState a playwright + accessibility runners para que vean la sesión.
  - Password se cifra en el route handler (reutiliza `auth/crypto.js`). El GET /api/scan
    sanitiza la respuesta (no devuelve encryptedPassword, solo `hasPassword: true`).
  - UI: sección "🔐 Scan con autenticación" colapsable en Home con 8 campos.
    Badge en Dashboard cuando hay login activo.

✅ **7.5 Crawler multi-página** — **implementado 2026-05-14**
  - Schema: `Scan.mode` (`single|crawl`), `Scan.maxPages` (1-15), `Scan.parentScanId`
    + relación self `parent`/`children` con `onDelete: Cascade`.
  - `backend/src/crawler/discover.js` — cascada: (1) sitemap.xml / sitemap_index.xml
    parsed con regex; (2) fallback a links internos del capture inicial. Dedup +
    clamp a maxPages. Solo URLs del mismo origin.
  - Pipeline parent-child:
    - Parent scan (mode=crawl, sin parentScanId) corre `processCrawlParent`:
      descubre URLs, crea N child scans en transacción, los encola.
    - Cada child es un scan single normal (hereda deviceProfile, userId, loginConfig).
    - Al terminar cada child, `maybeCompleteCrawlParent` chequea si todos están
      en estado terminal → si sí, calcula summary agregado y cierra el parent.
  - GET /api/scan/:id incluye `children` (id+url+status). GET /api/scan (history)
    excluye childs (filter parentScanId: null) para no inundar la lista.
  - UI: sección "🕷️ Crawler multi-página" en Home con input maxPages. Dashboard
    muestra `CrawlPanel` con lista de hijas + estado en vivo (poll cada 3s).
    History agrega badge `🕷️ crawl` a scans con mode=crawl.

**Fase 8 (~4-6 sem)** — profundidad y conexiones:
6. ✅ **Programación de scans (cron + notificaciones)** — implementado 2026-05-14
   - Nueva tabla `ScheduledScan` con cron expr (5 campos), timezone IANA,
     config completa del scan (url, device, engine, mode, maxPages, loginConfig
     cifrada), y campos de notificación: notifyWebhook, notifyEmail, notifyOn
     (`always | onFailOnly | onWarningOrFail`). `Scan.scheduledScanId` enlaza
     scans disparados por un schedule.
   - `backend/src/schedules/cron.master.js`: tick cada 60s, busca schedules
     habilitados con `nextRunAt <= now`, crea Scan + enqueueScan + recalcula
     `nextRunAt` con `cron-parser`. Flag `ENABLE_SCHEDULER=false` para
     deshabilitar (útil en dev local sin Postgres). Bootstrap inicial llena
     `nextRunAt` de schedules huérfanos.
   - `backend/src/notify/notifier.js`: al terminar un scan-from-schedule,
     evalúa `shouldNotify(notifyOn, summary)` y dispara webhook + email en
     paralelo (safe-call, no rompe el scan). Webhook usa payload mínimo común
     `{ text, content }` para Slack/Discord. Email usa nodemailer con SMTP
     configurable via `SMTP_HOST/PORT/USER/PASS/FROM` envs.
   - API `/api/schedules` CRUD + `POST /:id/run` (correr ahora) +
     `POST /validate-cron` (preview del próximo run). Sanitiza
     `encryptedPassword` en respuestas. Endpoints requieren auth, scoped al user.
   - UI: nueva vista `/schedules` con tabla + form colapsable (presets de
     cron, autodetect timezone, preview live del próximo run). Botones
     correr/pausar/borrar por row. Link en NavBar.
   - Deps nuevas: `cron-parser@5`, `nodemailer@8`.
7. ✅ **PDF reports con identidad visual** — implementado 2026-05-14
   - `backend/src/reports/pdf.renderer.js` usa Playwright (Chromium) para
     renderizar el mismo HTML del template inline y exportar `page.pdf()`
   - A4 vertical, márgenes 16/14mm, header + footer con paginación,
     `printBackground: true` para conservar el theme dark
   - Endpoint: `GET /api/report/:id/export?format=pdf`
   - Frontend: nuevo botón "Exportar PDF" en `ReportDetail`. La descarga
     pasa por `aiApi` (timeout 180s) porque Playwright tarda en lanzar
8. ✅ **Cross-browser (Firefox + WebKit)** — implementado 2026-05-14
   - `shared/constants.js`: `BROWSER_ENGINES` (chromium/firefox/webkit) +
     `DEFAULT_BROWSER_ENGINE = chromium`. Schema agrega `Scan.browserEngine`
     (default chromium).
   - Helper centralizado `backend/src/runners/browser.js` con `launchBrowser()`
     y `resolveEngine()` — switch entre los 3 módulos de Playwright. Maneja
     `PLAYWRIGHT_CHANNEL` solo para Chromium (Firefox/WebKit lo rechazan).
   - Runners (playwright, accessibility, login) y `crawler/discover.js`
     aceptan `browserEngine` opt-in. Queue propaga `scan.browserEngine` a
     todos los runners + a los child scans del crawl.
   - API: Zod schema acepta `browserEngine`. UI: grid de 3 botones en Home;
     Dashboard muestra badge con icono + nombre del engine usado.
   - **Setup local**: si querés probar Firefox/WebKit en dev, correr
     `cd backend && bunx playwright install firefox webkit`. En Railway no
     hace falta — la imagen `mcr.microsoft.com/playwright:v1.60.0-jammy`
     trae los 3 instalados.
9. ✅ **Visual regression testing** — implementado 2026-05-14
   - Nueva tabla `Screenshot` (scanId, url, deviceProfile, browserEngine,
     kind=`baseline|current|diff`, width, height, dataB64) con índice por
     `(url, deviceProfile, browserEngine, kind)`.
   - Nueva categoría `TEST_CATEGORY.VISUAL` + stage `ANALYZING_VISUAL`.
   - `analyzers/visual.analyzer.js`: lee screenshot del `playwright.capture`
     en memoria, busca último baseline para la tupla URL+device+engine.
     - Si no hay → guarda current como baseline + devuelve INFO.
     - Si hay → pixelmatch (threshold 0.1, alpha 0.3) → genera diff PNG
       con pixels distintos resaltados.
   - Thresholds: mismatch ≥5% o size mismatch → FAIL; ≥1% → WARNING; sino PASS.
     Score = clamp(100 − mismatch% − 10·sizeMismatch, 0, 100).
   - Endpoint `GET /api/scan/:id/screenshot/:kind` sirve PNG binario.
   - Frontend: panel "Visual regression" en ReportDetail con 3 thumbs
     (baseline | current | diff) o mensaje "primer scan" si recién se
     creó baseline. Deps nuevas: `pixelmatch`, `pngjs`.
10. ✅ **Integración Jira (crear bug desde un FAIL)** — implementado 2026-05-20
    - Schema: `JiraConfig` (1 por usuario — baseUrl + email + `encryptedToken`
      AES-256-GCM + `hint` + projectKey/issueType default) y `JiraIssueLink`
      (enlaza un `Result` con el issue creado: `issueKey`, `issueUrl`, evita
      bugs duplicados). Relaciones en `User` y `Scan` con `onDelete: Cascade`.
    - `backend/src/integrations/jira.client.js`: cliente REST de Jira Cloud
      (auth Basic email:token), `testConnection`/`listProjects`/`createIssue`,
      helpers ADF (Atlassian Document Format — requerido por la API v3).
      `JiraError` con `status`+`code` (lo consume el errorHandler directo).
    - `backend/src/integrations/jira.issue.js`: arma summary + descripción ADF
      desde un `Result` (URL, categoría, hallazgos: axe/links rotos/headers/
      mismatch visual, link al reporte).
    - API `/api/integrations/jira` (auth, scoped al user): `GET/PUT/DELETE` la
      config, `POST /test` (valida contra `/myself`), `GET /projects`,
      `GET /issues?scanId=`, `POST /issue` (crea bug desde scanId+resultId).
    - UI: vista `/settings/jira` (config + probar conexión + proyecto default)
      y botón **🐞 Crear bug** en cada `TestCard` con FAIL/WARNING del reporte
      (panel inline; si ya hay bug muestra el link al issue). Link en NavBar.
    - El token de Jira reusa `SECRET_ENCRYPTION_KEY`. No requiere envs nuevas.
11. ✅ **JUnit XML export** — implementado 2026-05-14
    - `backend/src/reports/junit.template.js`: emite `<testsuites>` con un
      `<testsuite>` por categoría y un `<testcase>` por Result. Maps:
      `fail`→`<failure type="failure">`, `warning`→`<failure type="warning">`
      (configurable via `JUNIT_TREAT_WARNINGS=skipped`), `pass|info`→sin tag.
    - CDATA con resumen útil para CI: violations de axe (top 5), broken
      links, headers faltantes, error messages.
    - Endpoint: `GET /api/report/:id/export?format=junit` (también acepta
      `xml` como alias). Botón "Exportar JUnit XML" en ReportDetail.
    - Compatible con: GitHub Actions, GitLab CI, Jenkins (publish JUnit),
      CircleCI, Bitbucket Pipelines, Azure DevOps.

**Diferenciadores** (orden de prioridad acordado 2026-05-29: 12 → 13 → 15, después el resto):
12. ✅ **AI auto-healing de selectores** — v1 implementada 2026-05-29 (solo Playwright).
    - `backend/src/generators/selector.extract.js`: extrae selectores del script
      Playwright con regex (`getByRole`/`getByTestId`/`getByText`/`getByLabel`/
      `getByPlaceholder`/`locator`), los reconstruye con la API real de Playwright
      (sin eval) para verificarlos, y aplica reemplazos textuales. Lo no parseable
      (p.ej. `name: /regex/`) se marca `no-verificable`.
    - `backend/src/generators/selector.healer.js`: carga la URL del scan **en vivo**
      (reusa `launchBrowser` + `buildContextOptions` exportado de playwright.runner +
      `runLoginPreflight` para sesión autenticada), testea cada selector con
      `page.locator().count()`, y para los `no-resuelto` pide al LLM
      (`generateStructured`) un reemplazo usando un resumen del DOM actual
      (testIds/forms/buttons/links/headings). Timeouts duros con Promise.race.
    - Endpoint `POST /api/scripts/:scanId/heal` body `{ provider?, model?, apply?,
      healedContent? }`. Sin apply → preview (report + healedContent). Con apply +
      healedContent → persiste el contenido ya revisado (NO recomputa → evita gasto
      y no-determinismo del LLM). Advisory: nunca sobreescribe sin confirmación.
    - UI: botón "🩹 Sanar selectores" + panel de reporte en la pestaña Playwright de
      `ScriptGenerator.jsx` (badges ok/curado/sin-fix, reemplazo + razón, Aplicar/Descartar).
    - **Pendiente**: e2e en prod; extender a Cypress/Selenium (v2).
13. ✅ **AI exploratory testing** — v1 implementada 2026-05-29 (agente DOM-texto, sesión independiente).
    - Un agente de IA maneja un browser Playwright autónomo: observa los elementos
      interactivos visibles, decide la acción (click/fill/navigate/back/finish) vía
      `generateStructured`, la ejecuta de forma segura y acumula errores de consola/HTTP.
      Pasada final del LLM consolida hallazgos. Provider-agnóstico (texto por paso).
    - Modelo `ExploratorySession` (independiente, NO ligado a Scan). Queue propia
      `qa-forge-explore` (`backend/src/queue/explore.queue.js`, con `ExploreContext`
      de cancelación calcado de `ScanContext`). Agente en `backend/src/agents/explore.agent.js`.
      Rutas `/api/explore` (CRUD + cancel, `requireAuth`). Eventos socket `explore:*`.
    - Guardrails: same-origin duro (vuelve atrás si se va), system prompt prohíbe acciones
      destructivas (logout/borrar/pagar), acotado por `maxSteps` (default 15, cap 40),
      timeouts duros, acción por índice taggeado (`data-qaforge-idx`, sin eval).
    - UI: vista `/explore` (form + lista) + `/explore/:id` (trail + hallazgos en vivo por
      socket). Cada hallazgo se puede **mandar al repositorio** (crea TestCase, reusa
      `applyTestCaseActions`). Sin Jira en v1.
    - **Pendiente**: e2e en prod; percepción con visión/screenshots (v2).
14. OWASP ZAP
15. Native iOS/Android (solo si el equipo testea apps native — Appium + BrowserStack/Sauce)

### Pendiente (post-MVP, lower prio)

- ⬜ Optimización Shiki: usar `shiki/core` con imports explícitos para reducir
  los chunks de grammars emitidos por Vite
- ✅ Paginación real en `GET /api/scan` — implementado 2026-05-20.
  Query `?page=&pageSize=` (default 50, máx 100). Respuesta incluye
  `pagination { page, pageSize, total, totalPages, hasMore }`. `count` + page
  en una `$transaction`. UI `History` con botón "Cargar más" incremental.
- ⬜ Migrar de `prisma db push` a `prisma migrate deploy` para versionar schema

### Parqueado (sólo si pivota a producto comercial)

- ⬜ Multi-tenancy / organizaciones / workspaces
- ⬜ Billing (Stripe) + tiers
- ⬜ White-label (logo, dominio custom)
- ⬜ SSO empresarial (SAML/OIDC)
- ⬜ Audit logs exhaustivos / SOC2 compliance

### Notas / decisiones

- **Modelo Claude:** se usa `claude-sonnet-4-6` (más reciente al cierre de FASE 1)
  en vez del `claude-sonnet-4-20250514` del prompt original. Si la API lo deprec
  a cambiar la constante en `shared/constants.js`.
- **Queue:** se reemplazó `bull` por `bullmq` (incompat con Bun/Windows). API
  ligeramente distinta: `Queue` + `Worker` separados, conexión como objeto.
- **QUEUE_NAME:** `qa-forge-scan` (BullMQ no admite `:` en el nombre).
- **SQLite local + Prisma:** archivo en `backend/src/db/dev.db` (gitignored).
  El schema vive en `backend/src/db/schema.prisma` — el `prisma` block en el
  `package.json` lo apunta.
- **Plantilla AI-Driven:** se respeta intacta. La documentación específica
  de QA Forge vive en este `CLAUDE.md` + `.context/` (futura extensión).

### Validación FASE 1

- ✅ `bun install` en backend y frontend OK
- ✅ `bunx prisma generate` + `bunx prisma db push` crea `dev.db`
- ✅ `bunx playwright install chromium` descarga el binario
- ✅ `bun src/index.js` arranca Express+Socket.io en :3001 (worker arranca aunque
  Redis no esté disponible — errores no fatales en logs)
- ✅ `GET /api/health` responde 200 con `{status: "ok"}`
- ✅ `POST /api/scan` valida input con Zod (rechaza URL inválida con 400)
- ✅ `bun run build` del frontend produce dist/ válido (~261 KB JS gz: 87 KB)

### Validación FASE 2

- ✅ `bun install @axe-core/playwright` OK
- ✅ Backend bootea con todos los nuevos imports (analyzers + runners + html template)
- ✅ `GET /api/report/:id` responde 404 cuando no existe (validación de loadReport)
- ✅ Frontend buildea: 267 KB JS (gz 88 KB) — 6 KB de delta vs FASE 1
- ⚠️ Pendiente: scan e2e real con Redis levantado (no había docker en el host de
  esta sesión). Para validarlo: instalar Redis nativo o Docker Desktop y correr
  `docker compose up -d redis` o el equivalente con `redis-server`.

### Validación FASE 3

- ✅ `bun install @anthropic-ai/sdk@0.88` OK
- ✅ Backend bootea con generator + scripts.routes registrados
- ✅ `POST /api/scripts/nope` responde 404 (validación de scan)
- ✅ `GET /api/scripts/nope` responde 404 `NO_SCRIPTS`
- ✅ Frontend buildea: chunk principal 276 KB (gz 91 KB), Shiki en chunks lazy
  (wasm 622 KB / langs 200 KB cada uno — solo se cargan al abrir `/scripts`)
- ⚠️ Para probar la generación real: setear `ANTHROPIC_API_KEY` en `backend/.env`
  y completar un scan primero (necesita Redis para que la queue procese).

### Validación FASE 4

- ✅ Backend bootea con todos los routers (FASE 1-3 + diffs no rompen nada)
- ✅ Frontend buildea: 285 KB JS (gz 94 KB) — +10 KB por History+Compare
- ✅ `docker-compose config` parsea sin errores (sintaxis válida — verificado
  estructuralmente; no se ejecutó `compose up` por falta de Docker en el host
  de esta sesión)
- ⚠️ Pendiente probar `docker compose --profile full up --build` en host con
  Docker (la imagen Playwright + Bun pesa ~1 GB, el primer build tarda ~5 min).
