import type { BunRequest, CookieSameSite, RedisClient } from 'bun';
import type { BaseContext, HTTPContext } from './context';
import type { DeepReadonly, JSONObject, JSONValue, Promisable } from './types';
import { randomBytes } from 'node:crypto';
import { Cookie } from 'bun';
import { isHTTP, isWS } from './context';
import { sign, unsign } from './crypto';
import { UnsupportedProtocolError } from './error';
import { Ultra } from './ultra';

export type SessionData = Record<string, JSONValue>;

/** Session store interface */
export interface SessionStore {
  read: (sessionId: string) => Promisable<SessionData | null>;
  write: (sessionId: string, data: SessionData) => Promisable<void>;
  destroy: (sessionId: string) => Promisable<void>;
  touch: (sessionId: string) => Promisable<void>;
}

/** Options user for set session cookie */
interface SessionCookieOptions {
  /** @default "/" */
  path: string;
  /** @default true */
  httpOnly: boolean;
  /** @default true */
  secure: boolean;
  /** @default "lax" */
  sameSite: CookieSameSite;
  /** In seconds. @default config.ttlSec */
  maxAge: number;
}

/** Factory for create session store  */
export type SessionStoreFactory = (config: SessionConfig<any>, context: BaseContext) => SessionStore;

export interface SessionConfig<
  S extends Record<string, SessionStoreFactory> = Record<string, SessionStoreFactory>,
> {
  /** The name is used as a prefix to cookies and storage with such as Redis  */
  name: string;
  /** Session time to live in seconds */
  ttlSec: number;
  /** Secret used to sign session ID cookie */
  secret: string;
  /** Options used to set session cookie */
  cookie?: Partial<SessionCookieOptions>;
  /** Default store */
  store: Extract<keyof S, string>;
  /** Available session stores as factories */
  stores: S;
}

/** Session socket data extensions */
export interface SessionSocketData {
  sessionId: string;
}

export type SessionContext = BaseContext<{ sessionId: string }> & {
  session: Session<any>;
};

export function defineConfig<S extends Record<string, SessionStoreFactory>>(config: SessionConfig<S>): SessionConfig<S> {
  return {
    ...config,
    cookie: {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: config.ttlSec,
      ...config?.cookie,
    },
  };
}

/** Extends context and socket data, initiate session instance every request */
export function createSessionModule<S extends Record<string, SessionStoreFactory>>(config: SessionConfig<S>) {
  return new Ultra()
    .deriveUpgrade((context) => {
      const id = Session.getOrCreateId((context as HTTPContext).request, config);
      return {
        headers: { 'Set-Cookie': new Cookie(config.name, sign(id, config.secret), config.cookie).toString() },
        data: { sessionId: id },
      };
    })
    .derive(context => ({ session: new Session(config, context) }))
    .use(async ({ context, next }) => {
      await context.session.initiate();
      const response = await next();
      await context.session.commit();
      return response;
    });
}

/** Stores the ID in a cookie, then moves it to the socket and uses it for requests  */
export class Session<
  Stores extends Record<string, SessionStoreFactory> = Record<string, SessionStoreFactory>,
> {
  /** Make random session id */
  static makeId() {
    return randomBytes(16).toString('base64url');
  }

  /** Get existing session ID from request cookie or create a new one */
  static getOrCreateId(request: BunRequest, config: SessionConfig<any>): string {
    const cookie = request.cookies.get(config.name);
    if (cookie) return unsign(cookie, config.secret) || Session.makeId();
    return Session.makeId();
  }

  protected readonly config: SessionConfig<Stores>;
  protected readonly context: BaseContext;
  protected readonly store: SessionStore;
  protected readonly sessionIdFromClient: string | null = null;
  protected sessionId: string;
  protected sessionState: JSONObject | null = null;
  protected modified = false;

  constructor(config: SessionConfig<Stores>, context: BaseContext) {
    this.config = config;
    this.context = context;
    this.store = config.stores[config.store]!(config, context);

    switch (true) {
      case isHTTP(context): {
        const cookie = context.request.cookies.get(config.name);
        if (cookie) this.sessionIdFromClient = unsign(cookie, config.secret);
        break;
      }
      case isWS(context): {
        this.sessionIdFromClient = (context.ws.data as SessionSocketData).sessionId || null;
        break;
      }
      default: {
        throw new UnsupportedProtocolError('Session management is only supported for HTTP and WebSocket protocols.');
      }
    }

    this.sessionId = this.sessionIdFromClient || Session.makeId();
  }

  get id() {
    return this.sessionId;
  }

  /** Load data from session store */
  async initiate() {
    if (this.sessionState) return;
    this.sessionState = await this.store.read(this.sessionId) || {};
  }

  /** Commit data to session store */
  async commit() {
    // Touch session cookie
    this.touch();

    // Destroy empty session
    if (this.isEmpty && this.sessionIdFromClient) return this.store.destroy(this.sessionIdFromClient);

    // If session was regenerated, destroy old session and write new one
    if (this.sessionIdFromClient && this.sessionIdFromClient !== this.sessionId) {
      await this.store.destroy(this.sessionIdFromClient);
      await this.store.write(this.sessionId, this.state);
    }
    // If session was not regenerated, just write or touch it
    else {
      if (this.modified) await this.store.write(this.sessionId, this.state);
      else await this.store.touch(this.sessionId);
    }
  }

  /** Change session id */
  regenerate() {
    this.sessionId = Session.makeId();
  }

  get<T extends JSONValue>(key: string): DeepReadonly<T> | null;
  get<T extends JSONValue>(key: string, defaultValue: T): DeepReadonly<T>;
  get<T extends JSONValue>(key: string, defaultValue?: T) {
    return this.state[key] as T | undefined ?? defaultValue ?? null;
  }

  set(key: string, value: JSONValue) {
    this.state[key] = value;
    this.modified = true;
  }

  has(key: string) {
    return Object.hasOwn(this.state, key);
  }

  all(): DeepReadonly<JSONObject> {
    return this.state;
  }

  delete(key: string) {
    delete this.state[key];
    this.modified = true;
  }

  clear() {
    this.sessionState = {};
    this.modified = true;
  }

  protected get state() {
    if (!this.sessionState) throw new Error('Session is not initiated yet.');
    return this.sessionState;
  }

  protected get isEmpty() {
    return Object.keys(this.state).length === 0;
  }

  protected touch() {
    // Is HTTP context
    if ('request' in this.context) {
      this.context.request.cookies.set(
        this.config.name,
        sign(this.sessionId, this.config.secret),
        this.config.cookie,
      );
    }
  }
}

// ===== Build in stores =====

export class RedisSessionStore implements SessionStore {
  protected readonly config: SessionConfig<any>;
  protected readonly connection: RedisClient;

  constructor(config: SessionConfig<any>, connection: RedisClient) {
    this.config = config;
    this.connection = connection;
  }

  async read(sessionId: string) {
    const value = await this.connection.get(`${this.config.name}:${sessionId}`);
    if (!value) return null;
    return JSON.parse(value) as SessionData;
  }

  async write(sessionId: string, data: SessionData): Promise<void> {
    await this.connection.set(
      `${this.config.name}:${sessionId}`,
      JSON.stringify(data),
      'EX',
      this.config.ttlSec,
    );
  }

  async destroy(sessionId: string): Promise<void> {
    await this.connection.del(`${this.config.name}:${sessionId}`);
  }

  async touch(sessionId: string): Promise<void> {
    await this.connection.expire(`${this.config.name}:${sessionId}`, this.config.ttlSec);
  }
}

const memoryStore = new Map<string, { data: SessionData; touched: number }>();
export class MemorySessionStore implements SessionStore {
  protected readonly config: SessionConfig<any>;
  protected readonly sweepIntervalMs: number;
  protected readonly ttlMs: number;
  protected lastSweepAt = Date.now();

  constructor(config: SessionConfig<any>, sweepIntervalSec = config.ttlSec) {
    this.config = config;
    this.sweepIntervalMs = sweepIntervalSec * 1000;
    this.ttlMs = config.ttlSec * 1000;
  }

  read(sessionId: string) {
    this.maybeSweep();
    return memoryStore.get(sessionId)?.data ?? null;
  }

  write(sessionId: string, data: SessionData) {
    this.maybeSweep();
    memoryStore.set(sessionId, { data, touched: Date.now() });
  }

  destroy(sessionId: string) {
    this.maybeSweep();
    memoryStore.delete(sessionId);
  }

  touch(sessionId: string) {
    this.maybeSweep();
    const entry = memoryStore.get(sessionId);
    if (entry) entry.touched = Date.now();
  }

  protected maybeSweep(now = Date.now()) {
    if (now - this.lastSweepAt < this.sweepIntervalMs) return;
    this.lastSweepAt = now;
    for (const [sessionId, entry] of memoryStore) {
      if (now - entry.touched > this.ttlMs) memoryStore.delete(sessionId);
    }
  }
}
