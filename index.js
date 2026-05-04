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
//
// We deliberately keep `args` BUT cap their serialized size. A stage that does
// `logger.error('...', { jsonData: hugeApiResponse })` would otherwise produce
// a multi-MB stdout line. Two things go wrong with that:
//   1. The worker's bufio scanner has a (large but finite) buffer; an
//      especially huge line trips `bufio.Scanner: token too long` and the
//      worker stops reading further events, including the final `result`.
//   2. Even within the buffer, Node's stdout pipe is asynchronous; if we
//      write a huge line and immediately exit, the kernel/pipe may drop
//      queued bytes before the worker reads them.
// Both manifest as "stage finished successfully but no outputs were captured".
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

/**
 * Write the final `result` event and wait for stdout to fully drain before
 * resolving. Calling `process.exit` while bytes are still queued in the
 * stdout pipe can drop them silently — for the `result` event that means the
 * orchestrator records a successful run with NO outputs, and the user sees an
 * empty Outputs tab.
 */
function emitResult(payload) {
  return new Promise((resolve) => {
    const line = JSON.stringify(payload) + '\n';
    const flushed = process.stdout.write(line);
    const done = () => {
      // Best-effort second pass: wait for any prior buffered writes too.
      if (typeof process.stdout.uncork === 'function') process.stdout.uncork();
      // A microtask delay gives the kernel a moment to drain the pipe.
      setImmediate(resolve);
    };
    if (flushed) done();
    else process.stdout.once('drain', done);
  });
}
