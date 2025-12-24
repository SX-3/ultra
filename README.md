[![npm](https://img.shields.io/npm/v/@sx3/ultra)](https://www.npmjs.com/package/@sx3/ultra)

# Ultra

Type-safe and fast RPC over HTTP/WebSocket for [Bun](https://bun.sh).

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
  - [Modules](#modules)
  - [Type safety](#type-safety)
  - [Protocol independence](#protocol-independence)
- [Middleware](#middleware)
- [Validation](#validation)
- [Context](#context)
- [Built-in features](#built-in-features)
  - [CORS](#cors)
  - [Sessions](#sessions)
  - [Authentication](#authentication)
  - [Crypto](#crypto)

## Install

```bash
bun add @sx3/ultra
```

## Quick start

Write a simple server with two modules: users and books.

```ts
// server.ts
import { Ultra } from '@sx3/ultra';

// User module
const users = new Ultra().routes(input => ({
  users: {
    list: input().http().handler(() => [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ])
  }
}));

// Book module
const books = new Ultra().routes(input => ({
  books: {
    list: input().http().handler(() => [
      { id: 1, title: 'TypeScript' },
      { id: 2, title: 'Brave New World' }
    ]),
  }
}));

// Root module
const server = new Ultra()
  .use(users)
  .use(books)
  .on('server:started', (bunServer) => {
    console.log(`Server started at ${bunServer.url}`);
  })
  .start();

// Type for client usage
export type Server = typeof server;
```

Create a client to call the server methods.

```ts
// clients.ts
import type { Server } from './server';
import { createHTTPClient } from '@sx3/ultra/client';

const http = createHTTPClient<Server>({
  baseUrl: 'http://localhost:3000',
});

const users = await http.users.list(); // [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
const books = await http.books.list(); // [{ id: 1, title: 'TypeScript' }, ...]
```

Create WebSocket client to call server methods over WebSocket.

```ts
// clients.ts
import type { Server } from './server';
import { createWebSocketClient } from '@sx3/ultra/client';

let socket = new WebSocket('ws://localhost:3000/ws');
const ws = createWebSocketClient<Server>({
  // Socket getter function
  socket: () => socket,
});

const users = await ws.users.list(); // [{ id: 1, name: 'Alice' } ...]
```

Or create [super client](#protocol-independence) for dynamic transport switching.

## Middleware

Middleware just functions that run before your route handlers. You can use them to add authentication, logging, error handling, etc.

```ts
import { Ultra } from '@sx3/ultra';
import { UnauthorizedError } from '@sx3/ultra/error';

// Simple authentication middleware
async function isAuthenticated({ context, next }) {
  if (!await context.auth.check()) return new UnauthorizedError();
  return next();
}

const app = new Ultra()
  .use(isAuthenticated) // Apply middleware globally
  .routes(input => ({
    profile: {
      get: input()
        .use(isAuthenticated) // Apply middleware to specific route
        .http()
        .handler(({ context }) => {
          return context.auth.user; // Access authenticated user
        }),
    },
  }));
```

## Validation

Ultra supports any library compatible with [Standard Schema](https://standardschema.dev/schema#what-schema-libraries-implement-the-spec).

```ts
import { Ultra } from '@sx3/ultra';
import { createHTTPClient } from '@sx3/ultra/client';
// import * as z from 'zod';
import * as s from 'sury';

const LoginSchema = s.schema({
  name: s.string(),
  password: s.string(),
});

const UserSchema = s.schema({
  id: s.number(),
  name: s.string(),
});

const auth = new Ultra().routes(input => ({
  auth: {
    // Schema for runtime input validation
    login: input(LoginSchema)
      // Schema for runtime output validation
      .output(UserSchema)
      .http()
      .handler(({ input }) => {
        // input is typed and validated as { name: string; password: string }
        const user = { id: 1, name: input.name };

        return user;
      }),
  }
}));

const client = createHTTPClient<typeof auth>({
  baseUrl: 'http://localhost:3000',
});

const user = await client.auth.login({ name: 'Alice', password: 'secret' }); // user is typed as { id: number; name: string }
```

Difference between runtime validation and TypeScript types:

```ts
import * as z from 'zod';

const api = new Ultra().routes(input => ({
  // Ultra checks input and output data
  validated: input(z.object({ a: z.number(), b: z.number() }))
    .output(z.number())
    .http()
    .handler(({ input }) => {
      // input is typed and validated as { a: number; b: number }
      return input.a + input.b;
    }),

  // You are confident in your types and don't want to waste CPU/memory on validation.
  typed: input<{ a: number; b: number }>()
    .output<number>()
    .http()
    .handler(({ input }) => {
      // input is typed as { a: number; b: number } but NOT validated
      return input.a + input.b;
    }),
}));
```

## Context

Ultra provides context system that allows you to share data across your application.
You can extend the context with a function or value. Example from session module:

```ts
// session.ts

export function createSessionModule<S extends Record<string, SessionStoreFactory>>(config: SessionConfig<S>) {
  // Create module
  return new Ultra()
  // deriveWS to add sessionId to WebSocket data object | run each socket connection | use for store data in WS connection
    .deriveWS((context: HTTPContext) => ({ sessionId: Session.getOrCreateId(context.request, config) }))
  // derive function add session instance to context | run each request
    .derive(context => ({ session: new Session(config, context) }))
  // Middleware to initiate and commit session on each request
    .use(async ({ context, next }) => {
      await context.session.initiate();
      const response = await next();
      await context.session.commit();
      return response;
    });
}
```

You can add a static value for each request:

```ts
const app = new Ultra().derive({ appName: 'My Ultra App' });
```

## Core concepts

### Modules

Each module is a self-contained application.

```ts
// auth.ts

// This is a self-contained application. It declares all its dependencies.
const auth = new Ultra()
  .use(cors) // Use CORS middleware
  .use(session) // Use session module
  .routes(input => ({
    auth: {
      login: input(s.schema({ login: s.string(), password: s.string() }))
        .http()
        .handler(({ input }) => {
        // Handle login
        }),
    }
  }));

// You can run it independently
auth.start();

// Or use it as a module in another application
const main = new Ultra()
  .use(auth)
  .start();
```

You can use modules as many times as you like.

```ts
const moduleA = new Ultra();

const moduleB = new Ultra()
  .use(moduleA); // Use first time

const moduleC = new Ultra()
  .use(moduleB)
  .use(moduleA); // Use second time

const mainApp = new Ultra()
  .use(moduleA)
  .use(moduleB)
  .use(moduleC)
  .start();
```

It may seem like modules will be duplicated and cause conflicts, but Ultra, under the hood, deduplicates everything that is connected to it.

This applies not only to modules:

```ts
// Derive function
function requestIdDerive(context) {
  console.log('Deriving!');
  return { requestId: crypto.randomUUID() };
}

// Middleware
async function logger({ next }) {
  console.log('Request!');
  return next();
}

// Routes
function routes(input) {
  return {
    ping: input().http().handler(() => {
      console.log('Handling ping!');
      return 'pong';
    }),
  };
}

const a = new Ultra()
  .derive(requestIdDerive)
  .use(logger)
  .routes(routes);

const b = new Ultra()
  .derive(requestIdDerive)
  .use(logger)
  .routes(routes);

const app = new Ultra()
  .derive(requestIdDerive)
  .use(logger)
  .use(a)
  .use(b)
  .routes(routes)
  .start();

fetch('http://localhost:3000/ping'); // Printed: Deriving!, Request!, Handling ping!
```

### Type safety

Ultra provides end-to-end type safety for your server and clients.

```ts
import { Ultra } from '@sx3/ultra';
import { createSuperClient } from '@sx3/ultra/client';

const math = new Ultra().routes(input => ({
  math: {
    add: input<{ a: number; b: number }>()
      .http()
      .handler(({ input }) => {
        // input is typed as { a: number; b: number }
        return input.a + input.b;
      }),
  }
}));

const client = createSuperClient<typeof math>({/** ... */});

const result = await client.math.add({ a: 1, b: 2 }); // the result is automatically inferred as a number
```

### Protocol independence

Ultra strives to be independent of specific protocols. You simply call functions and the application decides how to send the data.

```ts
// clients.ts
import type { Server } from './server';
import { createHTTPClient, createSuperClient, createWebSocketClient } from '@sx3/ultra/client';

const http = createHTTPClient<Server>({
  baseUrl: 'http://localhost:3000',
});

let socket = new WebSocket('ws://localhost:3000/ws');
const ws = createWebSocketClient<Server>({
  socket: () => socket,
});

const api = createSuperClient<Server>({
  // Transport picker function | if WebSocket is open, use it; otherwise, use HTTP
  pick: (method: string, params: unknown, options?: any) => {
    if (socket.readyState === WebSocket.OPEN) return ws;
    return http;
  }
});

const users = await api.users.list(); // [{ id: 1, name: 'Alice' } ...]
```

Currently only HTTP and WebSockets are supported.

## Built-in features

Ultra has several built-in features to make your life easier.

### CORS

```ts
import { Ultra } from '@sx3/ultra';
import { createCORSMiddleware } from '@sx3/ultra/cors';

const cors = createCORSMiddleware({
  origin: ['http://localhost:5173'],
  credentials: true,
  // methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // allowedHeaders: ['Content-Type', 'Authorization'],
  // exposedHeaders: ['X-Custom-Header'],
  // maxAge: 3600,
});

const app = new Ultra().use(cors); // Apply CORS middleware globally
```

### Sessions

Multiple session stores are supported: in-memory, Redis, and custom stores.

```ts
// session.ts
import { env } from '#app/env';
import { createSessionModule, defineConfig, MemorySessionStore, RedisSessionStore } from '@/sx3/ultra/session';

export const config = defineConfig({
  // Name for cookie or prefix for redis key
  name: 'session',
  ttl: 3600, // 1 hour
  store: 'redis',
  secret: env.APP_KEY,
  cookie: {
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
  stores: {
    redis: config => new RedisSessionStore(config, redis),
    memory: config => new MemorySessionStore(config),
  },
});

export const session = createSessionModule(config);

// server.ts
import { Ultra } from '@sx3/ultra';
import { session } from './session';

const app = new Ultra().use(session).routes(input => ({
  profile: {
    get: input().http().handler(({ context: { session } }) => {
      // Access session data
      session.get('user');
      session.set('user', { id: 1, name: 'Alice' });
    }),
  },
})).start();
```

### Authentication

```ts
// auth.ts
import { Ultra } from '@sx3/ultra';
import { createAuthModule, defineConfig, SessionAuthProvider } from '@sx3/ultra/auth';
import type { SessionContext } from '@sx3/ultra/session';

interface User {
  name: string;
  age: number;
}

const config = defineConfig<User>({
  provider: 'session',
  providers: {
    session: context => new SessionAuthProvider<User>(context as SessionContext),
  },
});

export const auth = createAuthModule<User>(config);

// server.ts
import { auth } from './auth';
import { session } from './session';
import { isAuthenticated, isGuest } from '@sx3/ultra/auth';

const app = new Ultra()
  .use(session)
  .use(auth)
  .routes(input => ({
    // Just example
    auth: {
      login: input(LoginSchema)
        .output(UserSchema)
        .http()
        .use(isGuest)
        .handler(async ({ input, context }) => {
          // ... check credentials logic
          // then
          await context.auth.login(user);
          return user;
        }),

      logout: input()
        .http()
        .use(isAuthenticated)
        .handler(({ context }) => context.auth.logout()),

      profile: input().use(isAuthenticated).http().handler(({ context }) => context.auth.user!),
    }
  }))
  .start();
```

### Crypto

Crypto functions are available [here](https://github.com/SX-3/ultra/blob/main/src/crypto.ts).

Inspired by [Elysia](https://elysiajs.com/) and [oRPC](https://orpc.dev/) powered by [Bun](https://bun.sh).
