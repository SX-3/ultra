import { createHTTPClient } from '../src/client';
import { Ultra } from '../src/ultra';

const module1 = new Ultra().derive({ static: true }).use(({ next }) => next()).deriveUpgrade(() => ({ data: { module1: 'module-data1' } })).derive(() => ({ module1: 'module1' })).routes(input => ({
  module1route1: input<string>().handler(() => 1),
  module1route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
  module1route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
  nested: {
    module1route1: input<string>().handler(() => 1),
    module1route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
    module1route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
    deep: {
      deep: {
        module1route1: input<string>().handler(() => 1),
        module1route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
        mroute3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
      },
    },
  },
}));
const module2 = new Ultra().use(module1).derive({ bus: '12321' }).use(({ next }) => next()).deriveUpgrade(() => ({ data: { module2: 'module-data2' } })).derive(() => ({ module2: 'module2', random: Math.random() })).routes(input => ({
  module2route1: input<string>().handler(() => 2),
  module2route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
  module2route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
  nested: {
    module2route1: input<string>().handler(() => 2),
    module2route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
    module2route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
    deep: {
      module2route1: input<string>().handler(() => 2),
      module2route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
      module2route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
    },
  },
}));
const module3 = new Ultra().use(module2).use(module1).deriveUpgrade(() => ({ data: { module3: 'module-data3' } })).derive(() => ({ module3: 'module3' })).routes(input => ({
  module3route1: input<string>().handler(() => 3),
  module3route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
  module3route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
  module3route4: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
  nested: {
    deep: {
      deeper: {
        module3route1: input<string>().handler(() => 3),
        module3route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
        module3route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
      },
    },
  },
}));
const module4 = new Ultra().use(module3).use(({ next }) => next()).use(module1).deriveUpgrade(() => ({ data: { module4: 'module-data4' } })).derive(() => ({ module4: 'module4' })).routes(input => ({
  module4route1: input<string>().handler(() => {
    return 4;
  }),
  module4route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
  module4route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
}));

export const module5 = new Ultra().use(module4).use(module4).use(module3).use(module2).deriveUpgrade(() => ({ data: { module5: 'module-data5' } })).derive(() => ({ module5: 'module5' })).routes(input => ({
  module5route1: input<string>().handler(() => 5),
  module5route2: input<{ id: string }>().output<{ id: string; name: string }>().handler(() => ({ id: 'id', name: 'name' })),
  module5route3: input<{ id: string }>().handler(() => ({ id: 'id', name: 'name' })),
}));

const buba1 = new Ultra()
  .derive(() => ({ auth: true }))
  .derive(() => ({ other: 'dada' }))
  .derive({ random: 'data' })
  .deriveUpgrade(() => ({ data: { auth: 'data' } }))
  .deriveUpgrade(() => ({ data: { session: 'data' } }))
  .routes(input => ({
    users: {
      services: {
        list: input().handler(() => ['pau', 'pau']),
      },
    },
  }));

export const buba2 = new Ultra()
  .use(buba1);

const client = createHTTPClient<typeof module5>({
  baseUrl: 'http://localhost:3000',
});

export const result = client.nested.deep.deeper.module3route3({ id: 'id' });
