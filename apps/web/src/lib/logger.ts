/**
 * Structured logger. In production this could be wired to Datadog/Sentry.
 * Output is JSON in production, pretty in development.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const levelOrder: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel: Level = (process.env.LOG_LEVEL as Level) ?? 'info';

function format(level: Level, message: string, context?: LogContext) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  if (process.env.NODE_ENV === 'production') {
    return JSON.stringify(entry);
  }
  const color: Record<Level, string> = {
    debug: '\x1b[90m',
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
  };
  const reset = '\x1b[0m';
  const ctxStr = context ? ' ' + JSON.stringify(context) : '';
  return `${color[level]}[${level.toUpperCase()}]${reset} ${message}${ctxStr}`;
}

function log(level: Level, message: string, context?: LogContext) {
  if (levelOrder[level] < levelOrder[minLevel]) return;
  const out = format(level, message, context);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => log('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => log('error', msg, ctx),
  child: (defaults: LogContext) => ({
    debug: (msg: string, ctx?: LogContext) => log('debug', msg, { ...defaults, ...ctx }),
    info: (msg: string, ctx?: LogContext) => log('info', msg, { ...defaults, ...ctx }),
    warn: (msg: string, ctx?: LogContext) => log('warn', msg, { ...defaults, ...ctx }),
    error: (msg: string, ctx?: LogContext) => log('error', msg, { ...defaults, ...ctx }),
  }),
};
