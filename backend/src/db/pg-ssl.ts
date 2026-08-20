/**
 * TLS для node-postgres к Yandex Managed PostgreSQL.
 *
 * `sslmode` из URL вычищается: его понимает libpq, а node-pg — нет; оставленный
 * в connectionString параметр конфликтует с объектом `ssl` и даёт
 * «self-signed certificate in certificate chain» (см. technic migration-client).
 * Режим TLS задаётся только через `ssl` + CA из DB_CA_CERT_PATH.
 */
import fs from 'node:fs';

export function pgConnectionOptions(
  databaseUrl: string,
  caCertPath?: string,
): { connectionString: string; ssl: { ca: string; rejectUnauthorized: true } | undefined } {
  const url = new URL(databaseUrl);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslrootcert');
  return {
    connectionString: url.toString(),
    ssl: caCertPath
      ? { ca: fs.readFileSync(caCertPath, 'utf8'), rejectUnauthorized: true }
      : undefined,
  };
}
