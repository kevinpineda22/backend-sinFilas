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
│   ├── modules/
│   │   ├── catalog/
│   │   │   ├── catalog.route.ts
│   │   │   └── catalog.controller.ts
│   │   │
│   │   ├── sessions/
│   │   │   ├── sessions.route.ts
│   │   │   └── sessions.controller.ts
│   │   │
│   │   └── admin/
│   │       ├── admin.route.ts
│   │       └── admin.controller.ts
│   │
│   └── shared/
│       └── db/
│           └── supabaseClient.ts   (cliente service_role, único)
│
├── .env                             (NO commiteado)
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
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

> Los controllers hoy hacen **todo**: parsean query/body, llaman a Supabase, formatean response y manejan errores. La separación en `service` + `repository` queda como roadmap.

## Convenciones actuales

### Naming

- Archivos: `kebab-case.ts` (ej. `catalog.controller.ts`).
- Funciones, variables: `camelCase`.
- Tipos, interfaces, clases: `PascalCase`.
- Tablas DB: `snake_case` con prefijo `sf_`.
- Endpoints REST: paths en kebab-case (`/sessions/checkout-direct`).

### TypeScript

- `tsconfig.json` con `strict: false`, `esModuleInterop: true`. Es lo que está cargado en el repo.
- **Endurecer pendiente**: activar `noImplicitAny`, `strictNullChecks`, y eventualmente `strict: true`.

### Errores

- Cada controller usa `try/catch` + `console.error` + `res.status(500).json({ error })`.
- **No hay middleware global** de errores ni clases tipadas. Pendiente refactor.

### Logs

- `morgan('dev')` para HTTP en consola.
- `console.error` en catches.
- **No hay Pino ni logs estructurados.** Pendiente.

### Tests

- **No hay tests.** No hay `vitest.config.ts` ni archivos `*.test.ts`.

## `tsconfig.json` actual

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": false,
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
    "start": "node dist/server.js"
  },
  "type": "commonjs",
  "dependencies": {
    "@supabase/supabase-js": "^2.105.4",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "helmet": "^8.1.0",
    "morgan": "^1.10.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/morgan": "^1.9.10",
    "@types/node": "^25.6.2",
    "nodemon": "^3.1.14",
    "ts-node": "^10.9.2",
    "typescript": "^6.0.3"
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
| `SUPABASE_JWT_SECRET` | Secret para validar JWT de Supabase (uso futuro) | No (hoy no se usa) |
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
| Validación Zod en bodies | Sólo en `env.ts` | En todos los inputs |
| Errores tipados + middleware central | No | `AppError` + subclases + middleware al final del pipeline |
| `console.error` | Sí | Logger Pino con niveles |
| `tsconfig` strict | `false` | Al menos `noImplicitAny` + `strictNullChecks` |
| Tests | Ninguno | Vitest con tests unitarios e integración |
| Audit log con cola | No | Inserción en transacción cuando sea posible |

Cuando se haga el refactor, ir un módulo a la vez (empezar por el de mayor riesgo: `sessions/checkout-direct`).
