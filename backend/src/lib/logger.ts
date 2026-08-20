import { pino } from 'pino';
import { loadConfig } from '../config.js';

/**
 * JSON-логи через pino с redaction чувствительных данных (корпстандарт §20).
 */
export function createLogger(name: string) {
  const cfg = loadConfig();
  return pino({
    name,
    level: cfg.NODE_ENV === 'test' ? 'silent' : 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.refreshToken',
        '*.accessToken',
        'password',
        'token',
      ],
      censor: '[REDACTED]',
    },
    transport:
      cfg.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
        : undefined,
  });
}
