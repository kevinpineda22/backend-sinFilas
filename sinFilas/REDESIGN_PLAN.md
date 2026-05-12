# Sin Filas — Plan de Rediseño Visual

> Alineación con el sistema corporativo Merkahorro (Glass Design System, referencia: `pages/ecommerce/admin/PedidosAdmin`).
> Alcance: panel admin de Sin Filas + reskin del panel VIP.

---

## 1. Diagnóstico

### Panel admin (`pages/sinFilas/views/`)
**Shell ya alineado.** `SFAdminDashboard.css` copia los tokens `--pa-admin-*`, el sidebar deep purple en gradiente, KPIs glass y los radial gradients de PedidosAdmin. El `SFSessionDetailModal.css` también ya implementa el patrón premium (header gradient + info grid + products scrollable + footer pill).

**Gap visual real (qué hace que se sienta "genérico"):**
- Tipografía: el admin usa system font genérica; PedidosAdmin usa **Plus Jakarta Sans**.
- Sidebar: faltan section labels jerárquicas y mejor footer.
- Header de content: la frase motivacional pasa desapercibida.
- `SFHistoryView`: usa tabla plana; PedidosAdmin agrupa por **date group separators** con línea gradient azul.
- Inconsistencia: `SFHistoryView` (tabla) vs `SFCancelledView` (ticket cards). Se unifican a ticket cards para coherencia Apple-style.
- `SFIntelligenceView`: los toggles de período (7/30/90 días) se podrían pulir como pill toggles.
- Empty states: planos, sin presencia visual.

### Panel VIP (`pages/sinFilas/SFApp.css`)
**Desalineado del sistema corporativo.** Usa:
- `Inter` (no Plus Jakarta Sans).
- Paleta indigo `#4F46E5` (no el deep purple `#1a0a4e / #2d1578`).
- Surfaces sólidas (no glass con backdrop-filter).
- Variables `--sf-*` desconectadas del sistema `--pa-admin-*`.

Es funcional pero NO se siente parte de la misma plataforma Merkahorro.

**Decisión: reskin (no rediseño completo).** Mantenemos la estructura: card centrada 480px (correcto para mobile-first), header + sede bar + body + footer. Solo cambian paleta, tipografía, surfaces y radios.

---

## 2. Tokens compartidos (fuente única)

Para evitar duplicación entre admin y VIP, se introduce un archivo común con los tokens corporativos:

**Nuevo archivo:** `pages/sinFilas/styles/sf-corporate-tokens.css`

```css
/* Tokens corporativos Merkahorro Sin Filas
   Importar en SFApp.css y en SFAdminDashboard.css */
@import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap");

:root {
  /* Palette — Deep Purple Corporate */
  --sfc-dark: #1a0a4e;
  --sfc-medium: #2d1578;
  --sfc-light: #4f35a1;
  --sfc-accent-blue: #0071e3;
  --sfc-accent-green: #30d158;
  --sfc-accent-orange: #ff9f0a;
  --sfc-accent-red: #ff453a;

  /* Surfaces — Glass */
  --sfc-bg: #f5f5f7;
  --sfc-card-bg: rgba(255, 255, 255, 0.72);
  --sfc-card-solid: #ffffff;
  --sfc-glass: rgba(255, 255, 255, 0.55);
  --sfc-glass-border: rgba(255, 255, 255, 0.45);

  /* Text */
  --sfc-text-dark: #1d1d1f;
  --sfc-text-secondary: #86868b;
  --sfc-text-muted: #6e6e73;

  /* Structure */
  --sfc-border: rgba(0, 0, 0, 0.06);
  --sfc-separator: rgba(0, 0, 0, 0.04);
  --sfc-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  --sfc-shadow-hover: 0 8px 30px rgba(0, 0, 0, 0.08);
  --sfc-radius: 20px;
  --sfc-radius-sm: 14px;
  --sfc-radius-pill: 980px;
  --sfc-transition: all 0.3s cubic-bezier(0.25, 0.1, 0.25, 1);

  --sfc-font: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

> Los archivos existentes (admin y VIP) seguirán usando sus prefijos locales pero referenciando estos tokens corporativos como fuente única de verdad.

---

## 3. Cambios — Panel admin

### 3.1 `SFAdminDashboard.css`
- Importar `sf-corporate-tokens.css` al tope.
- Reemplazar `font-family` por `var(--sfc-font)`.
- Mantener tokens `--pa-admin-*` apuntando a los `--sfc-*` (compatibilidad sin tocar JSX).
- Agregar al sidebar: estilos para `.sf-admin-nav-section-label` (uppercase + tracking) y `.sf-admin-sidebar-footer-quote`.
- Header content: refinar `.sf-admin-content-header-quote` (tamaño 0.78rem, color secondary, padding-top reducido).

### 3.2 `SFAdminDashboard.jsx`
- Agrupar items del sidebar en secciones: **OPERACIÓN** (History, Cancelled) y **ANALYTICS** (Intelligence). Renderizar `<span className="sf-admin-nav-section-label">…</span>` entre grupos.
- Mover la frase motivacional al footer del sidebar (como PedidosAdmin) en vez de al header.
- En el header del content: título + subtitle dinámico por vista (ya existe el dato en `VIEW_TITLES`).

### 3.3 `SFAdminShared.css`
- Agregar bloque **Date group separators** (`.sfa-date-group`, `.sfa-date-separator`, `.sfa-date-label`, `.sfa-date-count`, `.sfa-date-line`) replicando el patrón de PedidosAdmin (línea gradient azul + count badge azul).
- Empty state: agregar icono circular con background `rgba(99, 102, 241, 0.06)` 80×80 + título más grande.

### 3.4 `SFHistoryView.jsx`
- Sustituir la tabla `.sfa-table` por ticket-grid con cards (consistente con `SFCancelledView`).
- Agrupar sesiones por **fecha** (hoy / ayer / fechas específicas) usando los date group separators del paso 3.3.
- Cada card: id corto monospace + fecha hora-minuto + avatar tonalizado + nombre + email + badges (items, estado).

### 3.5 `SFIntelligenceView.css`
- `sfi-period-btn`: convertir a pill toggle activo/inactivo con `border-radius: 980px` y estado activo en `var(--sfc-accent-blue)`.
- `sfi-total-card`: aumentar glass blur, alinear tipográficamente con KPIs del dashboard.
- `sfi-chart-card`: aplicar `var(--sfc-card-bg)` + `backdrop-filter` consistente con el resto.

### 3.6 `SFSessionDetailModal.css`
- **No tocar** (ya está alineado al patrón premium). Solo verificar que use `var(--sfc-font)` heredado del padre.

---

## 4. Cambios — Panel VIP (reskin)

### 4.1 `SFApp.css`
- Importar `sf-corporate-tokens.css` al tope (reemplaza el `@import` de Inter).
- Reemplazar el bloque `:root { --sf-* }` por aliases que apunten a los `--sfc-*`:
  - `--sf-primary` → `var(--sfc-medium)` (deep purple)
  - `--sf-primary-hover` → `var(--sfc-dark)`
  - `--sf-primary-light` → `rgba(45, 21, 120, 0.08)`
  - `--sf-bg` → `var(--sfc-bg)`
  - `--sf-surface` → `var(--sfc-card-solid)` (mantiene solid donde corresponda)
  - `--sf-font` → `var(--sfc-font)`
- `.sf-app-card`: agregar `backdrop-filter` ligero + border glass.
- `.sf-app-header`: cambiar gradient a `linear-gradient(135deg, var(--sfc-dark), var(--sfc-medium))`.
- `.sf-sede-bar`: glass surface con accent corporativo, no indigo plano.
- Botones primarios (CTAs): aplicar `border-radius: var(--sfc-radius-pill)` para pill style.
- Agregar glow decorativo sutil en `::after` del card (radial gradient morado bottom-right, opacidad 0.08).

### 4.2 `SFApp.jsx`
- **Sin cambios estructurales.** Reskin es CSS-only.
- Posibles ajustes menores: agregar `aria-label` corporativo a header. Solo si encaja sin riesgo.

---

## 5. Orden de ejecución

1. Crear `pages/sinFilas/styles/sf-corporate-tokens.css`.
2. Aplicar cambios CSS del panel VIP (`SFApp.css`) — reskin completo.
3. Aplicar cambios CSS del admin (`SFAdminDashboard.css`, `SFAdminShared.css`, `SFIntelligenceView.css`).
4. Aplicar cambios JSX del admin (`SFAdminDashboard.jsx`, `SFHistoryView.jsx`) — secciones sidebar + date groups + tarjetas en History.
5. Verificación visual en navegador (admin + VIP) y verificación de regresión en otras vistas que importen `SFAdminShared.css`.

---

## 6. Criterios de aceptación

- [ ] Tipografía Plus Jakarta Sans aplicada en admin y VIP.
- [ ] Panel VIP usa gradient deep purple corporativo en header.
- [ ] Sidebar admin tiene secciones (OPERACIÓN / ANALYTICS) con section labels.
- [ ] `SFHistoryView` muestra ticket cards agrupadas por fecha con date separators.
- [ ] Botones de período en `SFIntelligenceView` son pill toggles.
- [ ] Sin regresiones funcionales (filtros, modales, navegación, refresh).
- [ ] Responsive intacto en breakpoints 1024 / 768 / 480.
- [ ] El panel VIP y el admin se sienten parte de la **misma plataforma**.

---

## 7. Fuera de alcance (no se toca en este pase)

- Lógica de negocio, llamadas a `sfApi.js`, schemas, controllers.
- Rediseño funcional del flujo VIP (mantiene card 480px y vistas internas).
- Lógica del `SFSessionDetailModal` (el CSS ya está alineado).
- Estilos de `pages/admin/` (gestión de usuarios general — proyecto distinto).
- Internacionalización, accesibilidad avanzada, tests visuales.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper otros componentes que importen `SFAdminShared.css` | Solo se **agregan** clases nuevas (date groups), no se modifican las existentes. |
| Conflicto entre tokens `--sf-*` y `--sfc-*` en el VIP | Se mantienen los `--sf-*` como aliases que apuntan a `--sfc-*`. JSX no se rompe. |
| Que el reskin del VIP rompa la legibilidad | El reskin mantiene contraste WCAG (white sobre deep purple = AAA). Se verifica en breakpoints mobile. |
| Cambio de fuente afecta layout (Plus Jakarta es ligeramente más ancha que system) | Verificación visual breakpoint por breakpoint antes de cerrar. |

---

**Estado: PROPUESTO — esperando aprobación del usuario antes de ejecutar.**
