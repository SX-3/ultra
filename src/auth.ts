import type { BaseContext } from './context';
import type { Middleware } from './middleware';
import type { SessionContext } from './session';
import type { JSONValue, Promisable } from './types';
import { UnauthorizedError } from './error';
import { Ultra } from './ultra';

export interface AuthProvider<User> {
  user: User | null;
  check: () => Promisable<boolean>;
  login: (user: User) => Promisable<void>;
  logout: () => Promisable<void>;
  setUser: (user: User) => Promisable<void>;
}

type AuthProviderFactory<User = any> = (context: BaseContext) => AuthProvider<User>;

interface AuthConfig<P extends Record<string, AuthProviderFactory> = Record<string, AuthProviderFactory>> {
  provider: keyof P;
  providers: P;
}

export interface AuthContext<User> extends BaseContext {
  auth: Auth<User>;
}

export function defineConfig<
  User,
  P extends Record<string, AuthProviderFactory<User>> = Record<string, AuthProviderFactory<User>>,
>(config: AuthConfig<P>) {
  return config;
}

export function createAuthModule<
  User,
  P extends Record<string, AuthProviderFactory<User>> = Record<string, AuthProviderFactory<User>>,
>(config: AuthConfig<P>) {
  return new Ultra().derive(context => ({
    auth: new Auth<User, P>(config, context),
  }));
}

export const isAuthenticated: Middleware<any, any, AuthContext<any>> = async (options) => {
  if (!await options.context.auth.check()) return new UnauthorizedError();
  return options.next();
};

export const isGuest: Middleware<any, any, AuthContext<any>> = async (options) => {
  if (await options.context.auth.check()) return new UnauthorizedError();
  return options.next();
};

export class Auth<
  User,
  Providers extends Record<string, AuthProviderFactory<User>> = Record<string, AuthProviderFactory<User>>,
> {
  protected readonly config: AuthConfig<Providers>;
  protected readonly context: BaseContext;
  protected readonly usingProvider: keyof Providers;
  protected readonly providerCache: Map<keyof Providers, AuthProvider<User>>;

  constructor(
    config: AuthConfig<Providers>,
    context: BaseContext,
    provider: keyof Providers = config.provider,
    providerCache = new Map<keyof Providers, AuthProvider<User>>(),
  ) {
    this.config = config;
    this.context = context;
    this.usingProvider = provider;
    this.providerCache = providerCache;
  }

  use(provider: keyof Providers) {
    return new Auth<User, Providers>(this.config, this.context, provider, this.providerCache);
  }

  get user() {
    return this.provider.user;
  }

  check() {
    return this.provider.check();
  }

  login(user: User) {
    return this.provider.login(user);
  }

  logout() {
    return this.provider.logout();
  }

  setUser(user: User) {
    return this.provider.setUser(user);
  }

  protected get provider(): AuthProvider<User> {
    const cached = this.providerCache.get(this.usingProvider);
    if (cached) return cached;

    const providerFactory = this.config.providers[this.usingProvider]!;
    if (!providerFactory) throw new Error(`Auth provider "${String(this.usingProvider)}" is not configured.`);
    const instance = providerFactory(this.context);
    this.providerCache.set(this.usingProvider, instance);
    return instance;
  }
}

// ===== Build in providers =====

export class SessionAuthProvider<User> implements AuthProvider<User> {
  protected readonly context: SessionContext;
  protected readonly sessionKey: string;

  constructor(context: SessionContext, sessionKey = 'user') {
    this.context = context;
    this.sessionKey = sessionKey;
  }

  get user() {
    return this.context.session.get(this.sessionKey) as User || null;
  }

  check() {
    return this.user !== null;
  }

  login(user: User) {
    this.setUser(user);
    this.context.session.regenerate();
  }

  logout() {
    this.context.session.delete(this.sessionKey);
  }

  setUser(user: User) {
    this.context.session.set(this.sessionKey, user as JSONValue);
  }
}
