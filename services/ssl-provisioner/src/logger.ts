type Level = 'debug' | 'info' | 'warn' | 'error';
function fmt(level: Level, msg: string, ctx?: Record<string, unknown>) {
  return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx });
}
export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => console.log(fmt('debug', m, c)),
  info: (m: string, c?: Record<string, unknown>) => console.log(fmt('info', m, c)),
  warn: (m: string, c?: Record<string, unknown>) => console.warn(fmt('warn', m, c)),
  error: (m: string, c?: Record<string, unknown>) => console.error(fmt('error', m, c)),
};
