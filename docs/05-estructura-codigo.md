# 05 — Estructura del código (estado real)

Layout real del backend tal como está hoy. Lo que era plan inicial y todavía no se materializó queda anotado al final como _Roadmap de estructura_.

## Layout actual

```
Backend-sinFilas/
├── docs/
│   ├── 01-arquitectura.md
│   ├── 02-base-de-datos.md
│   ├── 03-api.md
│   ├── 04-flujos.md
│   ├── 05-estructura-codigo.md     (este archivo)
│   ├── 06-supabase-setup.sql       (schema canónico)
│   └── 07-roles-setup.sql          (role_permissions)
│
├── src/
│   ├── app.ts                      (Express app, middlewares, monta routers)
│   ├── server.ts                   (bootstrap; no llama listen en Vercel)
│   │
│   ├── config/
│   │   └── env.ts                  (validación Zod de process.env)
│   │
│   ├── types/
│   │   └── express.d.ts            (augmenta Request con user + sedeId)
│   │
│   ├── modules/
│   │   ├── catalog/
│   │   │   ├── catalog.route.ts
│   │   │   ├── catalog.controller.ts
│   │   │   ├── catalog.schemas.ts  (Zod del query string)
│   │   │   └── catalog.utils.ts    (isManualSearchPresentation)
│   │   │
│   │   ├── sessions/
│   │   │   ├── sessions.route.ts
│   │   │   ├── sessions.controller.ts
│   │   │   └── sessions.schemas.ts (Zod body + params)
│   │   │
│   │   └── admin/
│   │       ├── admin.route.ts      (requireAuth + optionalSede globales)
│   │       └── admin.controller.ts (Zod inline en queries/params)
│   │
│   └── shared/
│       ├── db/
│       │   └── supabaseClient.ts   (cliente service_role)
│       ├── middleware/
│       │   ├── auth.ts             (requireAuth — JWT con jsonwebtoken)
│       │   └── sede.ts             (requireSede + optionalSede)
│       └── audit/
│           └── auditWriter.ts      (logAudit fire-and-forget)
│
├── tests/                          (Vitest + supertest)
│   ├── setup.ts
│   ├── helpers/supabaseMock.ts
│   ├── health.test.ts
│   ├── modules/
│   │   ├── catalog/{schemas,controller,utils}.test.ts
│   │   └── sessions/{schemas,controller,redeem}.test.ts
│   └── shared/
│       ├── middleware/{auth,sede}.test.ts
│       └── audit/auditWriter.test.ts
│
├── sinFilas/                       (módulo frontend embebido en Pagina-web_React)
│   ├── SFApp.jsx
│   ├── api/sfApi.js
│   ├── views/
│   │   ├── SFAdminDashboard.jsx    (shell sidebar + router)
│   │   └── admin/                  (vistas del panel admin)
│   │       ├── SFHistoryView.jsx
│   │       ├── SFCancelledView.jsx
│   │       ├── SFIntelligenceView.jsx
│   │       └── SFSessionDetailModal.jsx
│   ├── components/ hooks/ store/ utils/
│   └── *.css
│
├── .env                             (NO commiteado)
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── vitest.config.ts
└── vercel.json
```

## Anatomía de un módulo

Los módulos hoy tienen sólo `route + controller`. Ejemplo real (`catalog`):

### `catalog/catalog.route.ts`

```ts
import { Router } from 'express';
import { searchProduct } from './catalog.controller';

const router = Router();

router.get('/search', searchProduct);

export default router;
```

### `catalog/catalog.controller.ts`

```ts
import { Request, Response } from 'express';
import { supabaseAdmin } from '../../shared/db/supabaseClient';

export const searchProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { query } = req.query;
    // ... lógica de búsqueda con detección GS1 y join contra siesa
    res.json(results);
  } catch (error: any) {
    console.error('Error in searchProduct:', error);
    res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
};
```

> Los controllers hoy hacen **todo**: parsean query/body con Zod, llaman a Supabase, formatean response y manejan errores. La separación en `service` + `repository` queda como roadmap.

> El módulo `admin` ya monta sus middlewares globales con `router.use(requireAuth); router.use(optionalSede);` antes de registrar las rutas. Es el patrón sugerido para módulos donde todos los endpoints comparten el mismo contrato de auth/sede.

## Convenciones actuales

### Naming

- Archivos: `kebab-case.ts` (ej. `catalog.controller.ts`).
- Funciones, variables: `camelCase`.
- Tipos, interfaces, clases: `PascalCase`.
- Tablas DB: `snake_case` con prefijo `sf_`.
- Endpoints REST: paths en kebab-case (`/sessions/checkout-direct`).

### TypeScript

- `tsconfig.json` con `strict: false` pero `noImplicitAny: true` + `strictNullChecks: true` activados explícitamente.
- **Endurecer pendiente**: activar `strict: true` (alcanza efectos colaterales como `strictFunctionTypes`, `strictBindCallApply`, etc.).

### Errores

- Cada controller usa `try/catch` + `console.error` + `res.status(500).json({ error })`.
- **No hay middleware global** de errores ni clases tipadas. Pendiente refactor.

### Logs

- `morgan('dev')` para HTTP en consola.
- `console.error` en catches.
- **No hay Pino ni logs estructurados.** Pendiente.

### Tests

- **Vitest + supertest** configurados (`vitest.config.ts`, `tests/setup.ts`).
- Cobertura actual: schemas (catalog/sessions), controllers (catalog/sessions/redeem), utilidades (`catalog.utils`), middlewares (`auth`, `sede`), `auditWriter`, health.
- Helper compartido: `tests/helpers/supabaseMock.ts` con mock encadenable del builder de Supabase.

## `tsconfig.json` actual

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": false,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

## `package.json` actual

```json
{
  "name": "backend-sinfilas",
  "version": "1.0.0",
  "scripts": {
    "dev": "nodemon src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "type": "commonjs",
  "dependencies": {
    "@supabase/supabase-js": "^2.105.4",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "helmet": "^8.1.0",
    "jsonwebtoken": "^9.0.3",
    "morgan": "^1.10.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/morgan": "^1.9.10",
    "@types/node": "^25.6.2",
    "@types/supertest": "^7.2.0",
    "nodemon": "^3.1.14",
    "supertest": "^7.2.2",
    "ts-node": "^10.9.2",
    "typescript": "^6.0.3",
    "vitest": "^4.1.6"
  }
}
```

## Variables de entorno (.env)

| Variable | Uso | Requerida |
|---|---|---|
| `PORT` | Puerto local (default 3000) | No |
| `NODE_ENV` | `development` o `production` | No |
| `SUPABASE_URL` | URL del proyecto Supabase | **Sí** |
| `SUPABASE_KEY` | Service role key (bypassa RLS) | **Sí** |
| `SUPABASE_JWT_SECRET` | Secret para validar JWT de Supabase (lo usa `requireAuth`) | **Sí** (sin él, `requireAuth` responde 500) |
| `QR_SIGNING_SECRET` | Secret para firmar tokens HMAC (uso futuro) | No (hoy no se usa) |

> `env.ts` valida estas variables con Zod al arrancar. Si falta `SUPABASE_URL` o `SUPABASE_KEY`, el proceso muere antes de levantar el server.

## Cómo agregar un módulo nuevo (hoy)

1. Crear carpeta `src/modules/<nombre>/`
2. Crear `<nombre>.route.ts` y `<nombre>.controller.ts`
3. Montar el router en `src/app.ts`:
   ```ts
   import nombreRoutes from './modules/<nombre>/<nombre>.route';
   app.use('/api/sf/<nombre>', nombreRoutes);
   ```
4. Documentar los endpoints en `docs/03-api.md`.
5. Si requiere nuevas tablas, sumarlas a `docs/06-supabase-setup.sql`.

## Roadmap de estructura (lo que queremos pero no está)

```
src/
├── modules/
│   ├── auth/                     ← verifyJwt middleware + requireRole
│   │   ├── auth.route.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.middleware.ts
│   │   └── auth.schemas.ts
│   │
│   ├── catalog/
│   │   ├── catalog.route.ts
│   │   ├── catalog.controller.ts
│   │   ├── catalog.service.ts    ← extraer lógica
│   │   ├── catalog.repository.ts ← queries puras a Supabase
│   │   └── catalog.schemas.ts    ← Zod del query string + response shape
│   │   (mismo patrón para sessions y admin)
│   │
│   └── ...
│
├── shared/
│   ├── db/
│   ├── errors/                   ← AppError + subclases (NotFound, Validation, etc.)
│   ├── middleware/
│   │   ├── errorHandler.ts       ← maps AppError → JSON
│   │   ├── requestId.ts
│   │   └── auditWriter.ts        ← logAudit(action, payload) hacia sf_audit_log
│   ├── barcode/
│   │   └── gs1.ts                ← parseGS1 (copiado del picking)
│   ├── units/
│   │   └── weighableUnits.ts
│   └── logger/
│       └── logger.ts             ← Pino instance
│
└── tests/
    ├── unit/
    └── integration/
```

## Convenciones que queremos adoptar (lecciones del picking)

| Práctica | Estado actual | Estado deseado |
|---|---|---|
| Capas `route → controller → service → repository` | Sólo `route → controller` | Las 4 capas |
| Validación Zod en bodies/queries/params | ✅ Cubierto (`*.schemas.ts` + Zod inline en admin) | — |
| Errores tipados + middleware central | No | `AppError` + subclases + middleware al final del pipeline |
| `console.error` | Sí | Logger Pino con niveles |
| `tsconfig` strict | `noImplicitAny` + `strictNullChecks` ON, `strict` aún OFF | `strict: true` |
| Tests | ✅ Vitest + supertest activos | Subir cobertura de admin (hoy faltan tests del controller) |
| Audit log con cola | ✅ Conectado fire-and-forget | Reintento + cola persistente cuando se necesite |

Cuando se haga el refactor, ir un módulo a la vez (empezar por el de mayor riesgo: `sessions/checkout-direct`).
