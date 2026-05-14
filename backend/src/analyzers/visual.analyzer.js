// Visual regression: compara el screenshot del scan actual contra el baseline
// guardado para la misma tupla (url, deviceProfile, browserEngine). Si no
// existe baseline, este scan inaugura el baseline y devuelve INFO. Si hay,
// computa pixel-diff con pixelmatch y genera una imagen diff (rojo donde
// difiere). Devuelve { status, data, error }.

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import { prisma } from '../db/client.js';
import { RESULT_STATUS } from '../../../shared/constants.js';

// Si los tamaños no coinciden, normalizamos al ancho mínimo y la altura mínima
// (corte en la esquina superior-izquierda). Una alternativa sería rechazar el
// diff, pero queremos algún hint igual.
const PIXEL_DIFF_THRESHOLD = 0.1; // sensibilidad de pixelmatch (0.0..1.0)

const TOLERANCE_PERCENT_FAIL = 5; // >5% pixels distintos → fail
const TOLERANCE_PERCENT_WARN = 1; // >1% → warning, hasta 5

/**
 * @param {object} opts
 * @param {string} opts.scanId — scan actual (el current)
 * @param {string} opts.url — URL exacta que se scaneó
 * @param {string} opts.deviceProfile
 * @param {string} opts.browserEngine
 * @param {string} opts.currentB64 — screenshot del playwright.capture (PNG base64)
 * @returns {Promise<{status, data, error}>}
 */
export async function analyzeVisualRegression({
  scanId,
  url,
  deviceProfile,
  browserEngine,
  currentB64,
}) {
  if (!currentB64) {
    return {
      status: RESULT_STATUS.INFO,
      data: { skipped: 'sin screenshot del capture' },
      error: null,
    };
  }

  const current = decodePng(currentB64);
  if (!current) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: 'No se pudo decodificar el PNG del scan actual',
    };
  }

  // Buscamos baseline previo. Usamos el último baseline confirmado.
  const baseline = await prisma.screenshot.findFirst({
    where: {
      url,
      deviceProfile,
      browserEngine,
      kind: 'baseline',
      scanId: { not: scanId }, // por si una corrida previa ya guardó un baseline para este scan
    },
    orderBy: { createdAt: 'desc' },
  });

  // Persistir el screenshot actual como current (siempre).
  await prisma.screenshot.create({
    data: {
      scanId,
      url,
      deviceProfile,
      browserEngine,
      kind: 'current',
      width: current.width,
      height: current.height,
      dataB64: currentB64,
    },
  });

  // Si no había baseline → este scan lo inaugura.
  if (!baseline) {
    await prisma.screenshot.create({
      data: {
        scanId,
        url,
        deviceProfile,
        browserEngine,
        kind: 'baseline',
        width: current.width,
        height: current.height,
        dataB64: currentB64,
      },
    });
    return {
      status: RESULT_STATUS.INFO,
      data: {
        firstBaseline: true,
        width: current.width,
        height: current.height,
        message: 'Primer scan para esta tupla — guardado como baseline.',
      },
      error: null,
    };
  }

  const base = decodePng(baseline.dataB64);
  if (!base) {
    return {
      status: RESULT_STATUS.FAIL,
      data: null,
      error: 'No se pudo decodificar el PNG del baseline persistido',
    };
  }

  // Normalizamos a las dimensiones mínimas comunes. Si difieren, ya es un
  // indicio de cambio fuerte: lo marcamos como part del diff.
  const width = Math.min(base.width, current.width);
  const height = Math.min(base.height, current.height);
  const totalPixels = width * height;
  const baseBuf = cropToBuffer(base, width, height);
  const curBuf = cropToBuffer(current, width, height);
  const diffPng = new PNG({ width, height });

  const diffPixels = pixelmatch(baseBuf, curBuf, diffPng.data, width, height, {
    threshold: PIXEL_DIFF_THRESHOLD,
    alpha: 0.3,
  });
  const mismatchPercent = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;
  const sizeMismatch = base.width !== current.width || base.height !== current.height;

  const diffB64 = PNG.sync.write(diffPng).toString('base64');
  await prisma.screenshot.create({
    data: {
      scanId,
      url,
      deviceProfile,
      browserEngine,
      kind: 'diff',
      width,
      height,
      dataB64: diffB64,
    },
  });

  let status;
  if (mismatchPercent >= TOLERANCE_PERCENT_FAIL || sizeMismatch) {
    status = RESULT_STATUS.FAIL;
  } else if (mismatchPercent >= TOLERANCE_PERCENT_WARN) {
    status = RESULT_STATUS.WARNING;
  } else {
    status = RESULT_STATUS.PASS;
  }

  // Score 0-100: 100 - mismatchPercent (clamp). Penalty extra por size mismatch.
  const score = Math.max(
    0,
    Math.round(100 - mismatchPercent - (sizeMismatch ? 10 : 0)),
  );

  return {
    status,
    data: {
      diffPixels,
      totalPixels,
      mismatchPercent: Number(mismatchPercent.toFixed(3)),
      score,
      sizeMismatch,
      baseline: { width: base.width, height: base.height, scanId: baseline.scanId },
      current: { width: current.width, height: current.height },
      // No incluimos los PNGs en details (se sirven via endpoint /visual-diff).
      hasDiffImage: true,
    },
    error: null,
  };
}

function decodePng(b64) {
  try {
    const buf = Buffer.from(b64, 'base64');
    return PNG.sync.read(buf);
  } catch {
    return null;
  }
}

/**
 * Crea un buffer RGBA en el tamaño (w, h) tomando el corte superior-izquierdo
 * del PNG. pixelmatch espera buffers de 4 bytes por pixel del mismo tamaño.
 */
function cropToBuffer(png, w, h) {
  if (png.width === w && png.height === h) return png.data;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * w + x) * 4;
      out[dstIdx] = png.data[srcIdx];
      out[dstIdx + 1] = png.data[srcIdx + 1];
      out[dstIdx + 2] = png.data[srcIdx + 2];
      out[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return out;
}
