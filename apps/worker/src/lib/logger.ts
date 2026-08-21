/**
 * Minimal structured logger. Deliberately not a dependency (pino/winston) — this process runs on a
 * t3.small with ~1GiB available (doc 08 §3) and journald already handles rotation, timestamps and
 * persistence for a systemd unit, so line-delimited JSON on stdout is the whole requirement.
 *
 * JSON rather than pretty text because the runbook's incident commands grep these fields
 * (`journalctl -u oplier-worker | jq`), and a stuck-worker diagnosis depends on being able to
 * filter by `event` reliably.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

/**
 * Errors are not JSON-serializable: `JSON.stringify(new Error("boom"))` is `{}`, because `message`
 * and `stack` are non-enumerable. Any Error reaching a log line therefore has to be unwrapped
 * explicitly or the diagnostic silently disappears.
 *
 * This runs on EVERY field, not only ones named `err`/`error` as it used to. That earlier
 * key-name-based approach meant a caller passing an Error under any other key logged `{}` — observed
 * live in `activation_failed`, which reports its cause as `detail` and so printed
 * `"detail":{}` for a real grant failure, making the first two failures undiagnosable.
 *
 * `cause` is followed because the vendor SDK errors this worker deals with (viem / Alchemy) put the
 * actionable text there — the bundler's `precheck failed: preVerificationGas is 0` arrives as a
 * nested cause, not on the top-level message. Depth is bounded so a self-referential cause chain
 * cannot spin.
 */
function serializeError(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    // viem attaches these and they are usually the most useful part of the message.
    for (const extra of ["shortMessage", "details", "metaMessages", "code"] as const) {
      const v = (value as unknown as Record<string, unknown>)[extra];
      if (v !== undefined) out[extra] = v;
    }
    if (value.cause !== undefined && value.cause !== null && depth < 3) {
      out.cause = serializeError(value.cause, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(level: LogLevel, bindings: Record<string, unknown> = {}): Logger {
  const threshold = LEVEL_ORDER[level];

  function emit(lineLevel: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[lineLevel] < threshold) return;
    const payload: Record<string, unknown> = {
      t: new Date().toISOString(),
      level: lineLevel,
      event,
      ...bindings,
    };
    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        payload[k] = serializeError(v);
      }
    }
    const line = JSON.stringify(payload);
    if (lineLevel === "error" || lineLevel === "warn") {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    child: (extra) => createLogger(level, { ...bindings, ...extra }),
  };
}
