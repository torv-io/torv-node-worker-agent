/**
 * Node worker agent: loads and runs bundled stage code with the given context.
 * Expects WORK_DIR and CONTEXT env vars (bootstrap sets CONTEXT from stdin JSON or CONTEXT_JSON after S3 fetch).
 *
 * Output protocol (JSON lines to stdout):
 * - Log lines: {"type":"log","level":"info","message":"..."}
 * - Final result: {"type":"result","success":true,"outputs":{...},...}
 * pipe-worker-agent reads these lines and forwards logs to the orchestrator.
 */
import { createRequire } from 'module';
import { join } from 'path';

const workDir = process.env.WORK_DIR;
const contextJson = process.env.CONTEXT;

if (!workDir || !contextJson) {
  process.stderr.write(
    'Error: WORK_DIR and CONTEXT environment variables must be set\n',
  );
  process.exit(1);
}

// Writes a structured log line to stdout for pipe-worker-agent to forward via gRPC.
function writeLog(level, message, args = []) {
  const line = JSON.stringify({
    type: 'log',
    level,
    message,
    args: args.length > 0 ? args : undefined,
  }) + '\n';
  process.stdout.write(line);
}

/** Logger implementation that emits structured JSON lines for remote forwarding. */
function createStageLogger() {
  return {
    debug: (msg, ...args) => writeLog('debug', msg, args),
    info: (msg, ...args) => writeLog('info', msg, args),
    warn: (msg, ...args) => writeLog('warn', msg, args),
    error: (msg, ...args) => writeLog('error', msg, args),
  };
}

(async () => {
  try {
    const context = JSON.parse(contextJson);
    context.logger = createStageLogger();

    const stageRequire = createRequire(join(workDir, 'package.json'));
    const stageRunner = stageRequire(join(workDir, 'stage.js')).default;

    if (typeof stageRunner !== 'function') {
      throw new Error(
        'Stage code must export a default function (StageRunner)',
      );
    }

    const result = await Promise.resolve(stageRunner(context));

    if (!result || typeof result !== 'object') {
      throw new Error('Stage runner must return a StageResult object');
    }

    // Final result line (pipe-worker-agent stops reading after this)
    process.stdout.write(
      JSON.stringify({
        type: 'result',
        success: result.success !== false,
        outputs: result.outputs || {},
        error: result.error || null,
        metadata: result.metadata || {},
      }) + '\n',
    );
    process.exit(0);
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        type: 'result',
        success: false,
        outputs: {},
        error: error.message || String(error),
        metadata: { stack: error.stack },
      }) + '\n',
    );
    process.exit(1);
  }
})();
