import { createRequire } from 'module';
import { join } from 'path';

const workDir = process.env.WORK_DIR;

if (!workDir) {
  process.stderr.write('Error: WORK_DIR must be set\n');
  process.exit(1);
}

function writeLog(level, message) {
  process.stdout.write(JSON.stringify({ type: 'log', level, message }) + '\n');
}

function createStageLogger() {
  return {
    debug: (msg) => writeLog('debug', msg),
    info: (msg) => writeLog('info', msg),
    warn: (msg) => writeLog('warn', msg),
    error: (msg) => writeLog('error', msg),
  };
}

async function loadInputs() {
  const url = process.env.INPUTS_URL?.trim();
  if (!url) return {};

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download inputs: HTTP ${res.status}`);
  }
  const parsed = await res.json();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Inputs must be a JSON object');
  }
  return parsed;
}

function loadParams() {
  const raw = process.env.TORV_PARAMS_JSON;
  if (!raw) {
    throw new Error('TORV_PARAMS_JSON must be set');
  }
  const params = JSON.parse(raw);
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('TORV_PARAMS_JSON must be a JSON object');
  }
  return params;
}

function emitResult(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

(async () => {
  try {
    const [params, inputs] = await Promise.all([Promise.resolve(loadParams()), loadInputs()]);
    const stageRequire = createRequire(join(workDir, 'package.json'));
    const stageRunner = stageRequire(join(workDir, 'stage.js')).default;

    if (typeof stageRunner !== 'function') {
      throw new Error('stage.js must default-export a StageRunner function');
    }

    const result = await Promise.resolve(
      stageRunner({
        params,
        inputs,
        logger: createStageLogger(),
      }),
    );

    emitResult({
      type: 'result',
      success: result?.success !== false,
      outputs: result?.outputs ?? {},
      error: result?.error ?? null,
    });
    process.exit(0);
  } catch (error) {
    emitResult({
      type: 'result',
      success: false,
      outputs: {},
      error: error.message || String(error),
    });
    process.exit(1);
  }
})();
