# 05 — Estructura del código y convenciones

Layout completo del proyecto cuando esté implementado.

## Layout

```
Backend-sinFilas/
├── docs/                            ← documentación (este lugar)
│
├── src/
│   ├── app.ts                       ← Express app, monta rutas + middleware
│   ├── server.ts                    ← bootstrap (listen) — solo en dev local
│   ├── config/
│   │   ├── env.ts                   ← validación Zod de process.env
│   │   └── constants.ts             ← TTLs, límites, magic numbers
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.middleware.ts   ← verifyJwt + requireRole
│   │   │   └── auth.schemas.ts      ← Zod
│   │   │
│   │   ├── catalog/
│   │   │   ├── catalog.routes.ts
│   │   │   ├── catalog.controller.ts
│   │   │   ├── catalog.service.ts
│   │   │   ├── catalog.repository.ts
│   │   │   └── catalog.schemas.ts
│   │   │
│   │   ├── sessions/
│   │   │   ├── sessions.routes.ts
│   │   │   ├── sessions.controller.ts
│   │   │   ├── sessions.service.ts
│   │   │   ├── sessions.repository.ts
│   │   │   └── sessions.schemas.ts
│   │   │
│   │   ├── items/
│   │   │   ├── items.routes.ts
│   │   │   ├── items.controller.ts
│   │   │   ├── items.service.ts
│   │   │   ├── items.repository.ts
│   │   │   └── items.schemas.ts
│   │   │
│   │   └── checkout/
│   │       ├── checkout.routes.ts
│   │       ├── checkout.controller.ts
│   │       ├── checkout.service.ts
│   │       ├── checkout.repository.ts
│   │       ├── checkout.qr.ts       ← firma/verificación HMAC
│   │       └── checkout.schemas.ts
│   │
│   └── shared/
│       ├── db/
│       │   ├── supabase.ts          ← cliente Supabase tipado
│       │   └── types.ts             ← tipos de las tablas (idealmente generados)
│       ├── errors/
│       │   ├── AppError.ts          ← clase base
│       │   ├── NotFoundError.ts
│       │   ├── UnauthorizedError.ts
│       │   ├── ForbiddenError.ts
│       │   ├── ConflictError.ts
│       │   └── ValidationError.ts
│       ├── middleware/
│       │   ├── errorHandler.ts      ← maps AppError → JSON response
│       │   ├── requestId.ts         ← uuid por request, inyectado al logger
│       │   ├── sede.ts              ← lee X-Sede-ID
│       │   └── audit.ts             ← helper logAudit(action, payload)
│       ├── barcode/
│       │   ├── gs1.ts               ← parseGS1, copiado del picking
│       │   └── classifier.ts        ← detecta tipo (EAN/GS1/inválido)
│       ├── pricing/
│       │   └── manifestPricing.ts   ← calcLineCharge, copiado del picking
│       ├── units/
│       │   └── weighableUnits.ts    ← clasificación KL/LB/500GR/UND
│       ├── logger/
│       │   └── logger.ts            ← Pino instance
│       └── utils/
│           ├── asyncHandler.ts      ← wrapper para controllers async
│           └── dates.ts
│
├── tests/
│   ├── unit/
│   │   └── shared/
│   │       └── barcode/
│   │           └── gs1.test.ts
│   ├── integration/
│   │   ├── sessions.test.ts
│   │   ├── items.test.ts
│   │   └── checkout.test.ts
│   └── helpers/
│       └── supabaseMock.ts
│
├── supabase/
│   └── migrations/
│       └── 20260508000000_init_sin_filas.sql
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── vercel.json
├── nodemon.json (opcional, si no usás tsx watch)
└── README.md
```

## Anatomía de un módulo

Tomamos `items` como ejemplo. Cada módulo sigue este patrón:

### `items.routes.ts`

```typescript
import { Router } from 'express'
import { itemsController } from './items.controller'
import { verifyJwt, requireRole } from '../auth/auth.middleware'
import { sedeMiddleware } from '../../shared/middleware/sede'

export const itemsRouter = Router({ mergeParams: true })

itemsRouter.use(verifyJwt, requireRole(['cliente_vip', 'admin_sf']), sedeMiddleware)

itemsRouter.post('/', itemsController.add)
itemsRouter.patch('/:itemId', itemsController.update)
itemsRouter.delete('/:itemId', itemsController.remove)
```

### `items.controller.ts`

```typescript
import { Request, Response } from 'express'
import { itemsService } from './items.service'
import { addItemBodySchema, updateItemBodySchema } from './items.schemas'
import { asyncHandler } from '../../shared/utils/asyncHandler'

export const itemsController = {
  add: asyncHandler(async (req: Request, res: Response) => {
    const body = addItemBodySchema.parse(req.body)
    const sessionId = req.params.sessionId
    const item = await itemsService.add(sessionId, req.user!.id, body)
    res.status(201).json({ item })
  }),

  // update, remove, etc.
}
```

### `items.service.ts`

Lógica de negocio, sin tocar `req`/`res`.

```typescript
import { itemsRepository } from './items.repository'
import { sessionsRepository } from '../sessions/sessions.repository'
import { ConflictError, NotFoundError } from '../../shared/errors'
import { logAudit } from '../../shared/middleware/audit'

export const itemsService = {
  async add(sessionId: string, userId: string, input: AddItemInput) {
    const session = await sessionsRepository.findById(sessionId)
    if (!session) throw new NotFoundError('session')
    if (session.estado !== 'abierta') throw new ConflictError('session-not-editable')
    if (session.vip_user_id !== userId) throw new ForbiddenError()

    const item = await itemsRepository.insert({ session_id: sessionId, ...input })
    await sessionsRepository.bumpItemCount(sessionId, 1)
    await logAudit({ session_id: sessionId, user_id: userId, action: 'item.added', payload: { item_id: item.id, ...input } })
    return item
  },
}
```

### `items.repository.ts`

Queries puras a Supabase. **No hay lógica de negocio acá.**

```typescript
import { supabase } from '../../shared/db/supabase'

export const itemsRepository = {
  async insert(row: NewItem) {
    const { data, error } = await supabase
      .from('sf_items')
      .insert(row)
      .select()
      .single()
    if (error) throw error
    return data
  },

  async findBySession(sessionId: string) {
    const { data, error } = await supabase
      .from('sf_items')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data
  },

  // update, delete, etc.
}
```

### `items.schemas.ts`

Schemas Zod. Acá viven los **contratos de la API**.

```typescript
import { z } from 'zod'

const unidadMedidaSchema = z.enum(['KL', 'LB', '500GR', 'UND', 'P6'])

const cantidadSchema = z.string().regex(/^\d+(\.\d{1,3})?$/, 'cantidad inválida')

export const addItemBodySchema = z.object({
  siesa_codigo: z.string().min(1),
  unidad_medida: unidadMedidaSchema,
  cantidad: cantidadSchema,
  origen: z.enum(['scan_ean', 'scan_gs1', 'busqueda_manual']),
  ean_escaneado: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export type AddItemInput = z.infer<typeof addItemBodySchema>
```

## Convenciones

### Naming
- Archivos: `kebab-case.ts` (excepto clases/componentes que pueden ser `PascalCase.ts` si exportan una clase principal).
- Funciones, variables: `camelCase`.
- Tipos, interfaces, clases: `PascalCase`.
- Constantes globales: `SCREAMING_SNAKE_CASE`.
- Tablas DB: `snake_case` con prefijo `sf_`.
- Endpoints REST: `kebab-case` (`/sessions/:id/finalize`).

### TypeScript
- `tsconfig.json` con `strict: false` al inicio (lo subimos a `true` cuando estés cómodo).
- **Cero `any`.** Usar `unknown` si algo es realmente opaco.
- `import type` para tipos:
  ```typescript
  import type { Session } from '../sessions/sessions.types'
  ```
- Inferí tipos desde Zod con `z.infer<typeof schema>` en vez de duplicar.

### Errores
- **No usar `console.error` en código de producción.** Usar `logger.error(...)`.
- Lanzar instancias de `AppError` y subclases. El middleware global las mapea a JSON.
- En el catch global, errores no controlados se loguean con stack y se devuelven como `500 internal-error`.

### Async/await
- **Nunca** mezclar promesas con callbacks.
- Wrappers: usar `asyncHandler` para que los controllers async no necesiten try/catch.

### Logs (Pino)
- Niveles: `trace`, `debug`, `info`, `warn`, `error`.
- Cada request tiene un `requestId` (uuid) que se inyecta al logger.
- Logs estructurados (JSON), no strings concatenados.

## `tsconfig.json` recomendado para arrancar

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": false,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

> Empezamos con `strict: false` pero `noImplicitAny: true` y `strictNullChecks: true`. Eso te da los chequeos más útiles sin volverte loco con los tipos exactos. Cuando estés cómodo, subimos `strict: true`.

## Cómo agregar un módulo nuevo

1. Crear carpeta `src/modules/<nombre>/`
2. Crear los 5 archivos: `routes`, `controller`, `service`, `repository`, `schemas`
3. Si el módulo tiene tablas propias, agregarlas a `supabase/migrations/`
4. Montar el router en `src/app.ts`:
   ```typescript
   app.use('/api/sf/<nombre>', <nombre>Router)
   ```
5. Crear tests en `tests/integration/<nombre>.test.ts`
6. Documentar los endpoints en `docs/03-api.md`

## `package.json` esperado

```json
{
  "name": "backend-sin-filas",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.x",
    "express": "^5.x",
    "pino": "^9.x",
    "pino-http": "^10.x",
    "zod": "^4.x"
  },
  "devDependencies": {
    "@types/express": "^5.x",
    "@types/node": "^22.x",
    "tsx": "^4.x",
    "typescript": "^5.x",
    "vitest": "^2.x"
  }
}
```

## `.env.example`

```env
PORT=3001
NODE_ENV=development
LOG_LEVEL=info

SUPABASE_URL=
SUPABASE_KEY=
SUPABASE_JWT_SECRET=

QR_SIGNING_SECRET=
QR_TTL_MINUTES=15
```
