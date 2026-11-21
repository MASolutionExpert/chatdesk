import knex from "knex";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

// node-pg returns BIGINT (int8) columns as strings by default, but "0" is
// truthy in JS, which breaks flag checks (e.g. users.banned, users.verified)
// and diverges from better-sqlite3, which returns numbers. Parse int8 as a
// Number so both drivers behave the same. All bigint values in this schema
// (flags, counts) are well within Number-safe range.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) =>
  value === null ? null : Number.parseInt(value, 10),
);

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRootDir = path.resolve(serverDir, "..", "..");
const serverRootDir = path.resolve(serverDir, "..");
dotenv.config({ path: path.join(projectRootDir, ".env"), quiet: true });
dotenv.config({ path: path.join(serverRootDir, ".env"), quiet: true });

const dataDir = path.resolve(
  process.env.DATA_DIR || path.resolve(projectRootDir, "data"),
);
const dbPath = path.join(dataDir, "chatdesk.db");

// ---------------------------------------------------------------------------
// Timeout hardening (v1.1.0-dev.10).
//
// The default node-pg / knex configuration has NO timeouts: a TCP connect to
// an unreachable/firewalled Postgres server, a stalled SSL handshake, a lock
// wait or a dropped connection can hang a single query FOREVER. During
// migrations a hang looks like the updater freezing at "Running database
// migrations" and the only way out (Ctrl+C) breaks the site behind nginx.
//
// Every timeout below fails FAST and is overridable through the environment
// so operators with genuinely large databases can raise the limits.
// ---------------------------------------------------------------------------

const PG_TIMEOUT_DEFAULTS = {
  // TCP connect + TLS handshake to the Postgres server (node-pg client).
  CONNECTION_TIMEOUT_MS: 10_000,
  // Waiting for a free connection from the knex pool.
  ACQUIRE_TIMEOUT_MS: 15_000,
  // Creating a new pooled connection (knex tarn create).
  POOL_CREATE_TIMEOUT_MS: 10_000,
  // Single SQL statement server-side (statement_timeout). Migrations that
  // legitimately need longer can raise DB_STATEMENT_TIMEOUT_MS.
  STATEMENT_TIMEOUT_MS: 30_000,
  // A session that opens a transaction and then goes idle is almost always a
  // bug or a crashed client — let the server kill it instead of holding locks.
  IDLE_IN_TRANSACTION_TIMEOUT_MS: 30_000,
};

const pgTimeoutMs = (key) => {
  const raw = process.env[`DB_${key}`];
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return PG_TIMEOUT_DEFAULTS[key];
};

export function describePgTarget() {
  // Human-readable, password-free description of the configured Postgres
  // target, used by preflight errors and db:doctor.
  const explicitUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (explicitUrl) {
    try {
      const parsed = new URL(explicitUrl);
      const urlHasSslMode = /sslmode=/i.test(explicitUrl);
      return {
        mode: "url",
        host: parsed.hostname,
        port: parsed.port || "5432",
        database: parsed.pathname.replace(/^\//, "") || "(default)",
        user: parsed.username || "(default)",
        ssl: urlHasSslMode || process.env.POSTGRES_SSL === "true",
      };
    } catch {
      return { mode: "url", host: "(unparseable URL)", port: "?", database: "?", user: "?", ssl: process.env.POSTGRES_SSL === "true" };
    }
  }
  return {
    mode: "parts",
    host: process.env.POSTGRES_HOST || "127.0.0.1",
    port: String(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "chatdesk",
    user: process.env.POSTGRES_USER || "postgres",
    ssl: process.env.POSTGRES_SSL === "true",
  };
}

export function getPostgresTimeouts() {
  return {
    connectionTimeoutMs: pgTimeoutMs("CONNECTION_TIMEOUT_MS"),
    acquireTimeoutMs: pgTimeoutMs("ACQUIRE_TIMEOUT_MS"),
    poolCreateTimeoutMs: pgTimeoutMs("POOL_CREATE_TIMEOUT_MS"),
    statementTimeoutMs: pgTimeoutMs("STATEMENT_TIMEOUT_MS"),
    idleInTransactionTimeoutMs: pgTimeoutMs("IDLE_IN_TRANSACTION_TIMEOUT_MS"),
  };
}

function buildPgConnection() {
  const timeouts = getPostgresTimeouts();
  const explicitUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  // Always pass the client options as a config object: node-pg applies
  // connectionTimeoutMillis / statement_timeout /
  // idle_in_transaction_session_timeout regardless of whether the target is
  // given as a URL string or as individual parts.
  if (explicitUrl) {
    const connection = {
      connectionString: explicitUrl,
      connectionTimeoutMillis: timeouts.connectionTimeoutMs,
      statement_timeout: timeouts.statementTimeoutMs,
      idle_in_transaction_session_timeout: timeouts.idleInTransactionTimeoutMs,
      keepAlive: true,
      application_name: "chatdesk",
    };

    // POSTGRES_SSL=true must also work when the target is given as a URL.
    // If the URL already carries an explicit sslmode parameter it wins;
    // otherwise POSTGRES_SSL=true enables SSL with relaxed certificate
    // verification so self-signed Postgres servers work in both modes.
    if (process.env.POSTGRES_SSL === "true" && !/[?&]sslmode=/i.test(explicitUrl)) {
      connection.ssl = { rejectUnauthorized: false };
    }
    return connection;
  }

  return {
    host: process.env.POSTGRES_HOST || "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    database: process.env.POSTGRES_DB || "chatdesk",
    ssl:
      process.env.POSTGRES_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
    connectionTimeoutMillis: timeouts.connectionTimeoutMs,
    statement_timeout: timeouts.statementTimeoutMs,
    idle_in_transaction_session_timeout: timeouts.idleInTransactionTimeoutMs,
    keepAlive: true,
    application_name: "chatdesk",
  };
}

export function createKnexInstance() {
  const dbClient = (
    process.env.DB_CLIENT ||
    (process.env.POSTGRES_URL || process.env.DATABASE_URL ? "postgres" : "sqlite3")
  ).toLowerCase();

  if (
    dbClient === "postgres" ||
    dbClient === "postgresql" ||
    dbClient === "pg"
  ) {
    const timeouts = getPostgresTimeouts();

    return knex({
      client: "pg",
      connection: buildPgConnection(),
      pool: {
        // min 0: never keep idle connections alive to a server that may have
        // gone away (serverless / firewalled Postgres) — stale sockets are a
        // classic cause of infinite hangs on the next query.
        min: 0,
        max: Number(process.env.DB_POOL_MAX || 10),
        createTimeoutMillis: timeouts.poolCreateTimeoutMs,
        acquireTimeoutMillis: timeouts.acquireTimeoutMs,
        idleTimeoutMillis: 30_000,
        reapIntervalMillis: 1_000,
      },
      acquireConnectionTimeout: timeouts.acquireTimeoutMs,
      useNullAsDefault: true,
    });
  }

  // Default: better-sqlite3
  return knex({
    client: "better-sqlite3",
    connection: {
      filename: dbPath,
    },
    useNullAsDefault: true,
  });
}

export const dbKnex = createKnexInstance();
