import { createAuthModule, isGuest, SessionAuthProvider } from './auth';
import { createHTTPClient } from './client';
import { createSessionModule, defineConfig, MemorySessionStore } from './session';

import { Ultra } from './ultra';

interface User {
  id: number;
  name: string;
}

const session = createSessionModule(defineConfig({
  secret: 'supersecretkey',
  name: '',
  ttlSec: 0,
  store: 'memory',
  cookie: {},
  stores: {
    memory: c => new MemorySessionStore(c),
  },
}));

const auth = createAuthModule<User>({
  provider: 'session',
  providers: {
    session: context => new SessionAuthProvider(context),
  },
}).use(session);

const _app = new Ultra()
  .use(auth)
  .use(isGuest);

const _http = createHTTPClient<typeof _app>({
  baseUrl: 'dasd',
});
