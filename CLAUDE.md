// QA Forge — Session Context para Claude Code

# QA Forge — Session Context

> 📖 El historial detallado de implementación por fase (FASE 1–10 + validaciones)
> vive en `PROJECT_HISTORY.md`. Este archivo se mantiene liviano a propósito (se
> carga en contexto cada sesión). Consultá ese doc cuando necesites el detalle de
> una fase ya cerrada.

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

- Runtime: **Bun** (compatible con Node.js 20+ APIs). ⚠️ Ver "Cómo correr" —
  en Windows el proceso backend se ejecuta con **Node**, no Bun.
- Framework: **Express.js**
- Browser automation: **Playwright** (Chromium/Firefox/WebKit)
- Queue: **BullMQ + Redis** (jobs async de scan). Se cambió `bull` → `bullmq` en
  FASE 1 por incompatibilidad de `bull` con Bun en Windows. BullMQ es el sucesor
  oficial del mismo equipo. `QUEUE_NAME` = `qa-forge-scan` (BullMQ no admite `:`).
- DB: **SQLite** (dev) / **PostgreSQL** (prod) con **Prisma ORM**
- Real-time: **Socket.io** (server)
- IA: multi-provider (ver abajo). Modelo Claude default `claude-sonnet-4-6`.

### Frontend (`frontend/`)

- **React 18 + Vite**, **Tailwind CSS** + **shadcn/ui**
- Estado: **Zustand**, Real-time: **Socket.io client**
- Charts: **Recharts**, Code highlight: **Shiki** (lazy load)

### DevOps

- Docker + docker-compose (Redis + Postgres). `.env` con `dotenv`.

### Providers de IA (FASE 5+)

Abstracción en `backend/src/generators/providers/` (registry en `index.js`,
`resolveProvider({ requestedId, userId })`). Orden del dropdown:
OpenAI (ChatGPT) → opencode Zen → Anthropic Claude → Gemini → OpenRouter → Ollama.

| Provider | Setup |
|---|---|
| Gemini (free) | https://aistudio.google.com/apikey → `GEMINI_API_KEY=...` |
| Anthropic | https://console.anthropic.com → `ANTHROPIC_API_KEY=...` |
| OpenAI | https://platform.openai.com/api-keys → `OPENAI_API_KEY=...` |
| OpenRouter | https://openrouter.ai/keys → `OPENROUTER_API_KEY=...` |
| opencode Zen | https://opencode.ai/zen → `OPENCODE_API_KEY=...` |
| Ollama (local) | `ollama serve` + `ollama pull qwen2.5-coder:7b` |

- `DEFAULT_PROVIDER_ID` cae a `openai`; el default real lo fija `AI_PROVIDER` en el env.
- Default OpenAI = **`gpt-5.4`** (reasoning model: `openai.provider.js` detecta
  `gpt-5.x`/`o-series` con `isReasoningModel()` y usa `max_completion_tokens` sin
  `temperature`). ⚠️ Si Railway tiene `AI_MODEL_OPENAI` seteado, ese env **pisa**
  el default del código.
- Por usuario: API keys cifradas AES-256-GCM en `UserApiKey` (FASE 7.2). El
  `resolveProvider` usa la key del user primero, fallback al env.

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
7. **Modelo Claude**: usar la constante `CLAUDE_MODEL` de `shared/constants.js`
   (`claude-sonnet-4-6`). No hardcodear el modelo en el generator.
8. **Sin tipos `any` ni `// @ts-ignore`** si se llega a migrar a TS.
9. **Imports relativos** con extensión explícita (`.js` / `.jsx`) — Bun + ESM lo exige.
10. **DRY**: la lista de runners está centralizada en `backend/src/queue/scan.queue.js`.

---

## Modelo de datos (resumen)

Schema completo en `backend/src/db/schema.prisma`. Tablas núcleo:

- `Scan` (id, url, status, deviceProfile, browserEngine, mode `single|crawl`,
  maxPages, parentScanId, userId, loginConfig, scheduledScanId, notes, timestamps)
- `Result` (scanId, category, testName, status, score, details `JSON`)
- `Script` (scanId, framework, language, content) — también usada para casos
  manuales (`framework: "manual"`, `language: "json"`)
- `User` / `UserApiKey` (auth + keys cifradas) · `Screenshot` (visual regression)
- `ScheduledScan` (cron) · `JiraConfig` / `JiraIssueLink` · `ExploratorySession`
- `Flow` / `FlowRun` (Flow Runner determinista) · `ScheduledFlow` (cron de flows, v2)
- `NativeProvider` / `NativeFlow` / `NativeFlowRun` (native app testing #15, Appium)
- `ZapConfig` / `ZapScan` (OWASP ZAP security scanning #14)

Categorías de tests: `functional | security | performance | accessibility | seo | visual`.

---

## Cómo correr

### Modo dev local (recomendado para iterar)

> ⚠️ **Backend en Windows: usar `node`, no `bun`.** El runtime preferido del proyecto
> sigue siendo Bun (deps, scripts, prisma), pero **al ejecutar el proceso backend
> (`src/index.js`) en Windows hay que usar Node** porque Bun + Playwright en Windows
> falla: Chromium se lanza pero la comunicación por pipe (`--remote-debugging-pipe`)
> entre Bun y `chrome-headless-shell` nunca se establece, y todo scan timeoutea en
> 180s. Con Node anda OK. En Linux/Mac (Docker `mcr.microsoft.com/playwright`) Bun anda.

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

**Workaround alternativo si querés mantener Bun**: setear `PLAYWRIGHT_CHANNEL=chrome`
(o `msedge`) antes de arrancar — fuerza a Playwright a usar el Chrome/Edge del sistema
en vez del `chrome-headless-shell` bundled, que sí habla con Bun. Los runners
`playwright.runner.js` y `accessibility.runner.js` ya leen esa variable.

### Modo stack completo (todo en contenedores)

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # o el provider que uses
export PAGESPEED_API_KEY=...          # opcional
docker compose --profile full up -d --build
# Frontend: http://localhost:5173 · Backend: http://localhost:3001
```

---

## Deploy a producción (Railway + Vercel)

**Frontend** → Vercel; **backend** → Railway (necesita contenedor con Playwright +
worker BullMQ + Redis + Postgres; Vercel serverless no soporta nada de eso).

**Producción live**:
- Frontend: https://qaforge-chi.vercel.app
- Backend: https://qa-forge-production.up.railway.app (Railway service `Qa-forge`,
  plugins Postgres + Redis, plan **Hobby** desde 2026-05-20).

### Railway — backend
1. Proyecto conectando el repo + 2 plugins: **Postgres** y **Redis**.
2. Servicio "backend" que detecta `railway.toml` en la raíz (build via `backend/Dockerfile`).
3. Envs: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`,
   `FRONTEND_URL`, `AI_PROVIDER`, key del provider, `PAGESPEED_API_KEY` (opc),
   `NODE_ENV=production`. Generar dominio público. Healthcheck `/api/health`.

### Vercel — frontend
1. New Project, **Root Directory** `frontend`, framework Vite (auto).
2. Env `VITE_API_URL=https://<backend>.up.railway.app`. Deploy.
3. Volver a Railway y setear `FRONTEND_URL` con el dominio de Vercel.

### Notas
- **CORS**: backend acepta `FRONTEND_URL` (CSV) + cualquier `*.vercel.app` salvo
  `ALLOW_VERCEL_PREVIEWS=false`.
- **Schema migrations**: el startCommand corre `prisma db push` en cada deploy
  (idempotente). Migrar a `prisma migrate deploy` para esquemas serios.
- **Build gotcha**: el builder de Railway falla seguido por disco lleno / GPG de apt.
  El Dockerfile ya no usa apt. Ante fallo: distinguir infra de código, reintentar.
  Ver memoria [[project_railway_build_gotchas]].

---

## Estado actual

> **Última fase:** FASE 10 (repositorio de casos por SUT) — deployada y live 2026-05-20.
> **Producción**: https://qaforge-chi.vercel.app — auth funcional + admin creado.
> **Audiencia**: uso personal del owner + equipo chico de QA. **No comercial** (por ahora).
> Si pivota a vender, el roadmap de FASE 7 sirve como base multi-user → multi-tenant.
> Ver memoria [[project_audience_personal_use]].

**Fases cerradas** (detalle en `PROJECT_HISTORY.md`):
- ✅ FASE 1–4: scaffold, runners, analyzers, generador de scripts IA, history/compare, Docker
- ✅ FASE 5: multi-provider IA (6 providers) · FASE 6: generador de casos manuales
- ✅ Deploy prod (Postgres) + sesión UX/bugs críticos (2026-05-13)
- ✅ FASE 7: auth+JWT, API keys in-app, mobile viewport, login pre-flight, crawler multi-página
- ✅ FASE 8: cron+notif, PDF reports, cross-browser, visual regression, Jira, JUnit XML
- ✅ FASE 9: runner de casos manuales (commit `c767e9f`) — [[project_fase9_manual_runner]]
- ✅ FASE 10: repositorio de casos por SUT + chatbot IA (commits `c767e9f`+`fa7247c`)
  — [[project_fase10_repository]]. **Falta probar e2e en prod.**

**Diferenciadores en curso** (orden acordado 2026-05-29: 12 → 13 → 15 → resto):
- ✅ #12 AI auto-healing de selectores — v1 (solo Playwright). Pendiente: e2e prod + Cypress/Selenium.
- ✅ #13 AI exploratory testing — v1 (agente DOM-texto). Pendiente: e2e prod + visión (v2).
- ✅ #14 OWASP ZAP — v1 implementada 2026-05-30 (ver abajo).
- ✅ #15 Native iOS/Android — v1 implementada 2026-05-30 (ver abajo).
- Ver memoria [[project_roadmap_diferenciadores]].

**OWASP ZAP security scanning (#14)** — v1 implementada 2026-05-30.
- Scan de seguridad profundo vía un daemon **OWASP ZAP** externo (API REST). Cliente
  propio `backend/src/integrations/zap.client.js` (`fetch`, sin deps nuevas). Modos:
  `spider` (crawl) | `baseline` (spider + passive, no intrusivo) | `full` (+ active scan,
  INTRUSIVO — envía ataques, solo sitios autorizados).
- Modelos: `ZapConfig` (apiUrl + apiKey cifrada, 1 por user), `ZapScan` (url, mode, status
  reusa SCAN_STATUS, phase, spider/activeProgress, alerts Json, summary byRisk).
- `zap.runner.js` orquesta spider → passive → active con polling + deadlines, junta alertas
  agrupadas por riesgo (High/Medium/Low/Informational). Queue `qa-forge-zap`, socket room
  `zap:<scanId>`. Rutas `/api/zap` (config CRUD + test vía version + scans CRUD/cancel).
- UI: `/security` (`ZapSecurity` — config + nuevo scan + lista), `/security/:id`
  (`ZapScanDetail` — progreso en vivo por fase + alertas expandibles con solución/CWE).
  NavBar "Security".
- **Verificado**: cliente/runner fallan con gracia sin daemon (mensaje claro), imports sin
  ciclos, backend bootea (5º worker), frontend buildea. **NO verificable e2e local** (necesita
  un daemon ZAP: `docker run -p 8080:8080 zaproxy/zap-stable zap.sh -daemon -host 0.0.0.0
  -port 8080`). **v2**: crear bug Jira desde alerta, integrar al pipeline de scan, auth/context.

**Native app testing (#15)** — v1 implementada 2026-05-30.
- Testing e2e sobre apps iOS/Android vía **Appium** (protocolo W3C WebDriver sobre HTTP).
  Cliente propio `backend/src/integrations/appium.client.js` con `fetch` (sin deps nuevas —
  NO se usó webdriverio). Provider-agnóstico: Appium **local** (gratis) o device cloud
  **BrowserStack / Sauce Labs** (pagos) — mismo runner, distinto endpoint + auth.
- Modelos: `NativeProvider` (endpoint + accessKey cifrado AES-256-GCM), `NativeFlow`
  (capabilities: platform/device/app/automationName + pasos), `NativeFlowRun` (corrida,
  mismo shape de resultados que `FlowRun`). Reusa `FLOW_RUN_STATUS`/`FLOW_STEP_STATUS`.
- Acciones native (`NATIVE_ACTIONS`): tap/type/clear/pressKey/swipe/wait/waitFor/back +
  asserts (assertVisible/assertNotVisible/assertText). Selector con estrategia Appium
  (`accessibility id`/`id`/`xpath`/`-android uiautomator`/`-ios predicate string`/…).
- `native.runner.js` crea sesión Appium, ejecuta pasos, screenshot del device en fallos,
  cierra sesión. Queue `qa-forge-native` (`native.queue.js`, descifra accessKey), socket
  room `native:<runId>`. Rutas `/api/native` (providers CRUD + test connection vía GET
  /status + flows CRUD + run + runs), `requireAuth`.
- UI: `/settings/native` (`NativeProviders`), `/native` (`NativeFlows`), `/native/new` +
  `/native/:id` (`NativeFlowEditor` con step-builder + estrategias), `/native/runs/:runId`
  (`NativeRunView` en vivo). NavBar "Native".
- **Verificado**: cliente + runner fallan con gracia sin Appium (mensaje claro), imports
  sin ciclos, backend bootea con el native worker, frontend buildea. **NO verificable e2e
  localmente** (necesita Appium + device/emulador + binario de la app). El usuario debe:
  `prisma db push` (crea las 3 tablas) + levantar Appium (local) o cargar credenciales
  cloud. **v2**: scrcpy/streaming en vivo, importar de Appium Inspector, grabación.

**Flow Runner determinista** — v1 implementada 2026-05-30 (cierra el gap de
[[project_e2e_execution_direction]]: ejecutar flujos e2e completos, no solo generarlos).
- Modelos `Flow` (definición reusable) + `FlowRun` (cada ejecución). Pasos
  `{ action, selector, value, description }`: interacción (`goto/click/fill/select/
  check/uncheck/press/hover/wait/waitFor`) + aserción (`assertVisible/assertHidden/
  assertText/assertValue/assertUrl/assertTitle`). El tipo de acción ES la aserción.
- `backend/src/runners/flow.runner.js`: ejecutor determinista (sin LLM) que reusa
  `launchBrowser` + `buildContextOptions` + `runLoginPreflight`. Da pass/fail por paso
  + global, con screenshot base64 en los fallos. `continueOnError` (default false →
  corta al primer fallo y marca el resto `skipped`). Timeouts duros por paso.
- Queue `qa-forge-flow` (`flow.queue.js`, `FlowContext` de cancelación), socket room
  `flow:<runId>` (eventos `flow:step|progress|completed|failed`). Rutas `/api/flows`
  (CRUD + `/:id/run` + `/runs/:runId` + cancel), `requireAuth`, password de login cifrada.
- UI: `/flows` (lista), `/flows/new` + `/flows/:id` (`FlowEditor` con step-builder +
  historial de corridas), `/flows/runs/:runId` (`FlowRunView` en vivo por socket).
- **Verificado**: ejecutor probado en vivo contra página local (las 6 aserciones +
  interacciones + screenshots + stop-on-failure).
- **v2 implementada 2026-05-30** (mismo día):
  - **Asserts de consola/red**: el runner captura errores de consola JS + HTTP 4xx/5xx
    (en `signals`, persistido en `FlowRun.signals` + counts en summary). Acciones
    `assertNoConsoleErrors` / `assertNoHttpErrors`. UI: panel de señales en `FlowRunView`.
  - **Importar desde exploratorio**: `flow.import.js` convierte el trail de una
    `ExploratorySession` en un Flow borrador (selectores heurísticos `text=`/`[placeholder]`,
    editables). Ruta `POST /api/flows/from-exploration/:sessionId`. Botón "🎬 Convertir a
    flujo" en `ExploreSession`.
  - **Programar flows (cron)**: modelo `ScheduledFlow` + `cron.master` extendido (mismo
    tick procesa scans y flows) + `notifier.notifyFlowRunComplete` (webhook/email,
    notifyOn `always|onFailOnly`). Rutas `/api/flows/schedules` (CRUD + run). UI: panel
    "Programación" en `FlowEditor` (presets cron, preview, notif).
  - **Exportar a script**: `flow.export.js` (conversor puro) → Playwright TS / Cypress JS /
    Selenium Python. Ruta `GET /api/flows/:id/export?framework=`. Botones de descarga en
    `FlowEditor`. Selenium/Cypress con CSS; `text=`/`xpath=` se anotan como caveat.
- **Pendiente**: `prisma db push` (crea `Flow`/`FlowRun`/`ScheduledFlow` + nuevos campos)
  + e2e en prod. **v3**: percepción visual, asserts de red más ricos, reordenar drag&drop.

### Pendiente (post-MVP, lower prio)
- ⬜ Optimización Shiki: `shiki/core` con imports explícitos para reducir chunks de grammars
- ⬜ Migrar de `prisma db push` a `prisma migrate deploy` para versionar schema

### Parqueado (sólo si pivota a producto comercial)
- ⬜ Multi-tenancy / orgs · Billing (Stripe) · White-label · SSO (SAML/OIDC) · Audit logs / SOC2

---

## Notas / decisiones clave

- **Modelo Claude:** `claude-sonnet-4-6` (constante en `shared/constants.js`). Si la
  API lo deprec, cambiar ahí.
- **SQLite local + Prisma:** archivo en `backend/src/db/dev.db` (gitignored). El schema
  vive en `backend/src/db/schema.prisma` — el `prisma` block en `package.json` lo apunta.
- **Safety nets globales** en `index.js`: `uncaughtException` + `unhandledRejection`
  logean pero NO matan el process (previene restart loops en Railway).
- **`ssl.runner.js`** usa `node:tls.connect()` directo (el `ssl-checker` original era
  incompatible con Bun y causaba restart loops).
- **Frontend axios**: 2 clientes — `api` (30s) para REST normal, `aiApi` (180s) para
  `/api/scripts`, `/api/manual-cases`, export PDF y heal (LLMs/Playwright tardan).
- **Plantilla AI-Driven:** se respeta intacta. La doc de QA Forge vive en este
  `CLAUDE.md` + `PROJECT_HISTORY.md` + `.context/`.
