type Level = 'debug' | 'info' | 'warn' | 'error';

function fmt(level: Level, msg: string, ctx?: Record<string, unknown>) {
  return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx });
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => console.log(fmt('debug', msg, ctx)),
  info: (msg: string, ctx?: Record<string, unknown>) => console.log(fmt('info', msg, ctx)),
  warn: (msg: string, ctx?: Record<string, unknown>) => console.warn(fmt('warn', msg, ctx)),
  error: (msg: string, ctx?: Record<string, unknown>) => console.error(fmt('error', msg, ctx)),
};
