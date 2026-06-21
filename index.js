import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join } from 'path';

const workDir = process.env.WORK_DIR;

if (!workDir) {
  process.stderr.write('Error: WORK_DIR environment variable must be set\n');
  process.exit(1);
}

const MAX_LOG_ARGS_BYTES = 32 * 1024;
function writeLog(level, message, args = []) {
  let safeArgs;
  if (args.length > 0) {
    try {
      const serialized = JSON.stringify(args);
      if (serialized.length > MAX_LOG_ARGS_BYTES) {
        safeArgs = [
          {
            _truncated: true,
            originalBytes: serialized.length,
            preview: serialized.slice(0, MAX_LOG_ARGS_BYTES),
          },
        ];
      } else {
        safeArgs = args;
      }
    } catch (_) {
      safeArgs = [{ _unserializable: true }];
    }
  }
  const line =
    JSON.stringify({
      type: 'log',
      level,
      message,
      args: safeArgs,
    }) + '\n';
  process.stdout.write(line);
}

function createStageLogger() {
  return {
    debug: (msg, ...args) => writeLog('debug', msg, args),
    info: (msg, ...args) => writeLog('info', msg, args),
    warn: (msg, ...args) => writeLog('warn', msg, args),
    error: (msg, ...args) => writeLog('error', msg, args),
  };
}

function readJsonObjectFile(path, label) {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function loadRuntime() {
  const paramsRaw = process.env.TORV_PARAMS_JSON;
  if (!paramsRaw) {
    throw new Error('TORV_PARAMS_JSON must be set (params are delivered via gRPC on the run command)');
  }
  const params = JSON.parse(paramsRaw);
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw new Error('TORV_PARAMS_JSON must be a JSON object');
  }

  const inputsFile = process.env.INPUTS_FILE;
  if (!inputsFile) {
    throw new Error('INPUTS_FILE must be set');
  }

  return {
    params,
    inputs: readJsonObjectFile(inputsFile, 'INPUTS_FILE'),
  };
}

(async () => {
  try {
    const runtime = loadRuntime();
    const context = {
      ...runtime,
      params: runtime.params ?? {},
      inputs: runtime.inputs ?? {},
      logger: createStageLogger(),
    };

    const stageRequire = createRequire(join(workDir, 'package.json'));
    const stageRunner = stageRequire(join(workDir, 'stage.js')).default;

    if (typeof stageRunner !== 'function') {
      throw new Error('Stage code must export a default function (StageRunner)');
    }

    const result = await Promise.resolve(stageRunner(context));

    if (!result || typeof result !== 'object') {
      throw new Error('Stage runner must return a StageResult object');
    }

    await emitResult({
      type: 'result',
      success: result.success !== false,
      outputs: result.outputs || {},
      error: result.error || null,
      metadata: result.metadata || {},
    });
    process.exit(0);
  } catch (error) {
    await emitResult({
      type: 'result',
      success: false,
      outputs: {},
      error: error.message || String(error),
      metadata: { stack: error.stack },
    });
    process.exit(1);
  }
})();

function emitResult(payload) {
  return new Promise((resolve) => {
    const line = JSON.stringify(payload) + '\n';
    const flushed = process.stdout.write(line);
    const done = () => {
      if (typeof process.stdout.uncork === 'function') process.stdout.uncork();
      setImmediate(resolve);
    };
    if (flushed) done();
    else process.stdout.once('drain', done);
  });
}
