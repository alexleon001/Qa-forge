// Exporta un Flow (pasos deterministas) a un script ejecutable en Playwright (TS),
// Cypress (JS) o Selenium (Python). Conversión pura, sin LLM: cada acción se mapea
// 1:1 a la API del framework. Pensado para llevar el flow a CI. Los selectores se
// asumen CSS salvo prefijos `text=` / `xpath=` (Playwright los soporta nativo; para
// Cypress/Selenium se hace un best-effort + se anota el caveat).

import { FLOW_ACTIONS, SCRIPT_FRAMEWORK } from '../../../shared/constants.js';

/** Escapa comillas simples + backslash para meter un string en código. */
function esc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function escd(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
function safeName(s) {
  return String(s ?? 'flow').replace(/[\r\n]+/g, ' ').trim() || 'flow';
}

const A = FLOW_ACTIONS;

// ─── Playwright (TypeScript) ─────────────────────────────────────────────────

function toPlaywright(flow) {
  const usesSignals = flow.steps.some(
    (s) => s.action === A.ASSERT_NO_CONSOLE_ERRORS || s.action === A.ASSERT_NO_HTTP_ERRORS,
  );
  const lines = [];
  for (const step of flow.steps) {
    const sel = step.selector ? `page.locator('${esc(step.selector)}').first()` : null;
    const v = step.value ?? '';
    switch (step.action) {
      case A.GOTO: lines.push(`  await page.goto('${esc(v)}');`); break;
      case A.CLICK: lines.push(`  await ${sel}.click();`); break;
      case A.FILL: lines.push(`  await ${sel}.fill('${esc(v)}');`); break;
      case A.SELECT: lines.push(`  await ${sel}.selectOption('${esc(v)}');`); break;
      case A.CHECK: lines.push(`  await ${sel}.check();`); break;
      case A.UNCHECK: lines.push(`  await ${sel}.uncheck();`); break;
      case A.HOVER: lines.push(`  await ${sel}.hover();`); break;
      case A.PRESS: lines.push(sel ? `  await ${sel}.press('${esc(v)}');` : `  await page.keyboard.press('${esc(v)}');`); break;
      case A.WAIT: lines.push(`  await page.waitForTimeout(${Number(v) || 0});`); break;
      case A.WAIT_FOR: lines.push(`  await ${sel}.waitFor({ state: 'visible' });`); break;
      case A.ASSERT_VISIBLE: lines.push(`  await expect(${sel}).toBeVisible();`); break;
      case A.ASSERT_HIDDEN: lines.push(`  await expect(${sel}).toBeHidden();`); break;
      case A.ASSERT_TEXT: lines.push(`  await expect(${sel}).toContainText('${esc(v)}');`); break;
      case A.ASSERT_VALUE: lines.push(`  await expect(${sel}).toHaveValue('${esc(v)}');`); break;
      case A.ASSERT_URL: lines.push(`  expect(page.url()).toContain('${esc(v)}');`); break;
      case A.ASSERT_TITLE: lines.push(`  expect(await page.title()).toContain('${esc(v)}');`); break;
      case A.ASSERT_NO_CONSOLE_ERRORS: lines.push(`  expect(consoleErrors, consoleErrors.join('\\n')).toHaveLength(0);`); break;
      case A.ASSERT_NO_HTTP_ERRORS: lines.push(`  expect(httpErrors, httpErrors.join('\\n')).toHaveLength(0);`); break;
      default: lines.push(`  // acción no soportada: ${step.action}`);
    }
    if (step.description) lines[lines.length - 1] += ` // ${step.description.replace(/\n/g, ' ')}`;
  }

  const signalsSetup = usesSignals
    ? `  const consoleErrors: string[] = [];
  const httpErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) httpErrors.push(\`\${r.status()} \${r.url()}\`); });
`
    : '';

  return `import { test, expect } from '@playwright/test';

// Generado por QA Forge — Flow: ${safeName(flow.name)}
test('${esc(safeName(flow.name))}', async ({ page }) => {
${signalsSetup}  await page.goto('${esc(flow.url)}');
${lines.join('\n')}
});
`;
}

// ─── Cypress (JavaScript) ────────────────────────────────────────────────────

function cyKey(v) {
  // Cypress usa {enter},{esc},{tab}… — lowercase del nombre suele alcanzar.
  return `{${String(v).toLowerCase()}}`;
}

function toCypress(flow) {
  const lines = [];
  for (const step of flow.steps) {
    const sel = step.selector ? `cy.get('${esc(step.selector)}').first()` : null;
    const v = step.value ?? '';
    switch (step.action) {
      case A.GOTO: lines.push(`    cy.visit('${esc(v)}');`); break;
      case A.CLICK: lines.push(`    ${sel}.click();`); break;
      case A.FILL: lines.push(`    ${sel}.clear().type('${esc(v)}');`); break;
      case A.SELECT: lines.push(`    ${sel}.select('${esc(v)}');`); break;
      case A.CHECK: lines.push(`    ${sel}.check();`); break;
      case A.UNCHECK: lines.push(`    ${sel}.uncheck();`); break;
      case A.HOVER: lines.push(`    ${sel}.trigger('mouseover');`); break;
      case A.PRESS: lines.push(sel ? `    ${sel}.type('${cyKey(v)}');` : `    cy.focused().type('${cyKey(v)}');`); break;
      case A.WAIT: lines.push(`    cy.wait(${Number(v) || 0});`); break;
      case A.WAIT_FOR: lines.push(`    ${sel}.should('be.visible');`); break;
      case A.ASSERT_VISIBLE: lines.push(`    ${sel}.should('be.visible');`); break;
      case A.ASSERT_HIDDEN: lines.push(`    ${sel}.should('not.be.visible');`); break;
      case A.ASSERT_TEXT: lines.push(`    ${sel}.should('contain', '${esc(v)}');`); break;
      case A.ASSERT_VALUE: lines.push(`    ${sel}.should('have.value', '${esc(v)}');`); break;
      case A.ASSERT_URL: lines.push(`    cy.url().should('include', '${esc(v)}');`); break;
      case A.ASSERT_TITLE: lines.push(`    cy.title().should('include', '${esc(v)}');`); break;
      case A.ASSERT_NO_CONSOLE_ERRORS:
      case A.ASSERT_NO_HTTP_ERRORS:
        lines.push(`    // ${step.action}: configurar cy.on('window:before:load') para capturar errores (no portado automáticamente)`);
        break;
      default: lines.push(`    // acción no soportada: ${step.action}`);
    }
    if (step.description) lines[lines.length - 1] += ` // ${step.description.replace(/\n/g, ' ')}`;
  }

  return `// Generado por QA Forge — Flow: ${safeName(flow.name)}
// Nota: Cypress usa selectores CSS; selectores text=/xpath= necesitan ajuste manual.
describe('${esc(safeName(flow.name))}', () => {
  it('${esc(safeName(flow.name))}', () => {
    cy.visit('${esc(flow.url)}');
${lines.join('\n')}
  });
});
`;
}

// ─── Selenium (Python) ───────────────────────────────────────────────────────

/** Traduce un selector de QA Forge a un par (By, "valor") de Selenium. */
function seleniumLocator(sel) {
  const s = String(sel ?? '');
  if (s.startsWith('xpath=')) return `By.XPATH, "${escd(s.slice(6))}"`;
  if (s.startsWith('text=')) return `By.XPATH, "//*[contains(text(), '${esc(s.slice(5))}')]"`;
  return `By.CSS_SELECTOR, "${escd(s)}"`;
}

function seKey(v) {
  return `Keys.${String(v).toUpperCase()}`;
}

function toSelenium(flow) {
  const lines = [];
  for (const step of flow.steps) {
    const loc = step.selector ? seleniumLocator(step.selector) : null;
    const find = loc ? `driver.find_element(${loc})` : null;
    const v = step.value ?? '';
    switch (step.action) {
      case A.GOTO: lines.push(`driver.get("${escd(v)}")`); break;
      case A.CLICK: lines.push(`${find}.click()`); break;
      case A.FILL: lines.push(`_el = ${find}; _el.clear(); _el.send_keys("${escd(v)}")`); break;
      case A.SELECT: lines.push(`Select(${find}).select_by_value("${escd(v)}")`); break;
      case A.CHECK: lines.push(`_el = ${find};\nif not _el.is_selected(): _el.click()`); break;
      case A.UNCHECK: lines.push(`_el = ${find};\nif _el.is_selected(): _el.click()`); break;
      case A.HOVER: lines.push(`ActionChains(driver).move_to_element(${find}).perform()`); break;
      case A.PRESS: lines.push(find ? `${find}.send_keys(${seKey(v)})` : `ActionChains(driver).send_keys(${seKey(v)}).perform()`); break;
      case A.WAIT: lines.push(`time.sleep(${(Number(v) || 0) / 1000})`); break;
      case A.WAIT_FOR: lines.push(`wait.until(EC.visibility_of_element_located((${loc})))`); break;
      case A.ASSERT_VISIBLE: lines.push(`assert ${find}.is_displayed(), "no visible: ${escd(step.selector)}"`); break;
      case A.ASSERT_HIDDEN: lines.push(`assert len(driver.find_elements(${loc})) == 0 or not driver.find_elements(${loc})[0].is_displayed(), "sigue visible"`); break;
      case A.ASSERT_TEXT: lines.push(`assert "${escd(v)}" in ${find}.text, "texto no contiene ${escd(v)}"`); break;
      case A.ASSERT_VALUE: lines.push(`assert "${escd(v)}" in (${find}.get_attribute("value") or ""), "value no coincide"`); break;
      case A.ASSERT_URL: lines.push(`assert "${escd(v)}" in driver.current_url, "URL no contiene ${escd(v)}"`); break;
      case A.ASSERT_TITLE: lines.push(`assert "${escd(v)}" in driver.title, "título no contiene ${escd(v)}"`); break;
      case A.ASSERT_NO_CONSOLE_ERRORS:
        lines.push(`assert not [l for l in driver.get_log("browser") if l["level"] == "SEVERE"], "hay errores de consola"`);
        break;
      case A.ASSERT_NO_HTTP_ERRORS:
        lines.push(`# assertNoHttpErrors: requiere un proxy/CDP para inspeccionar respuestas HTTP (no portado)`);
        break;
      default: lines.push(`# acción no soportada: ${step.action}`);
    }
    if (step.description) lines[lines.length - 1] += `  # ${step.description.replace(/\n/g, ' ')}`;
  }

  // 8 espacios: el cuerpo va dentro de `def test_…():` → `try:`.
  const body = lines.map((l) => l.split('\n').map((x) => `        ${x}`).join('\n')).join('\n');
  return `# Generado por QA Forge — Flow: ${safeName(flow.name)}
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC


def test_${safeName(flow.name).replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}():
    driver = webdriver.Chrome()
    wait = WebDriverWait(driver, 10)
    try:
        driver.get("${escd(flow.url)}")
${body}
    finally:
        driver.quit()


if __name__ == "__main__":
    test_${safeName(flow.name).replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}()
`;
}

const EXPORTERS = {
  [SCRIPT_FRAMEWORK.PLAYWRIGHT]: { fn: toPlaywright, ext: 'spec.ts', language: 'typescript' },
  [SCRIPT_FRAMEWORK.CYPRESS]: { fn: toCypress, ext: 'cy.js', language: 'javascript' },
  [SCRIPT_FRAMEWORK.SELENIUM]: { fn: toSelenium, ext: 'py', language: 'python' },
};

/**
 * Exporta el flow al framework pedido. Devuelve { content, filename, language, framework }.
 * Lanza si el framework no está soportado.
 */
export function exportFlow(flow, framework) {
  const exporter = EXPORTERS[framework];
  if (!exporter) {
    throw new Error(`Framework no soportado: ${framework}`);
  }
  const content = exporter.fn(flow);
  const base = safeName(flow.name).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() || 'flow';
  return { content, filename: `${base}.${exporter.ext}`, language: exporter.language, framework };
}
