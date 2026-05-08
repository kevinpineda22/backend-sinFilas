# Sistema "Sin Filas" - Estado y Arquitectura del Proyecto

Este documento refleja el estado actual y la arquitectura del ecosistema "Sin Filas", un sistema de pre-escaneo interno (VIP) que permite a los empleados escanear y pesar productos, generando un manifiesto QR compatible con el sistema POS externo para un cobro rápido.

## 1. Repositorios y Estructura

El proyecto está dividido en dos partes principales, además de la base de datos:

### A. Frontend (Pagina-web_React/src/pages/sinFilas)
Aplicación React (Vite) incrustada en el repositorio principal de la web.
- **Convención de Nombres:** Todos los componentes específicos de este módulo usan el prefijo SF (ej. SFApp.jsx, SFManualSearch.jsx) para evitar colisiones con el resto del eCommerce.
- **Enrutamiento:** Rutas bajo /sin-filas (App de escaneo) y /sin-filas/admin (Dashboard de control).
- **Lógica QR:** El backend ya no firma JWTs. El frontend formatea la cadena exacta requerida por el POS (ej. QTY*CODE\r\n o GS1 de 13 dígitos para pesables) y la renderiza usando qrcode.react. La lógica vive en gs1Utils.js.
- **Estado:** Offline-first / Local-first. El carrito se acumula en el estado de React y se envía en un solo bloque al hacer checkout.

### B. Backend (Backend-sinFilas)
Servidor Express ligero, optimizado para despliegue Serverless en Vercel.
- **Punto de Entrada:** src/server.ts (App Express instanciada en src/app.ts).
- **Despliegue:** Configurado vía ercel.json usando el builder @vercel/node.
- **Módulos Activos:**
  - /api/sf/sessions: Gestión de sesiones de escaneo (Checkout Directo).
  - /api/sf/admin: Panel de control (Lectura de sesiones y usuarios).
  - /api/sf/catalog: Búsqueda y listado de productos.
- **CORS:** Configurado para aceptar solicitudes preflight (OPTIONS) de cualquier origen, permitiendo la conexión fluida desde el frontend local y de producción.

### C. Base de Datos (Supabase)
Esquema relacional estricto gestionado mediante consultas directas (sin ORM pesado).
- **Tablas principales:** 
  - sf_sessions: Cabecera del carrito.
  - sf_session_items: Items escaneados y pesados.
  - sf_qr_tokens: Tokens de sesión.
  - sf_audit_log: Registro de eventos inmutables.
- **Reglas Especiales:** Los roles de usuario se manejan vía el enum user_role. Se resolvió la restricción edirect NOT NULL en ole_permissions asegurando que todos los accesos tengan una ruta base configurada.
- **Expiración QR:** Para compatibilidad futura del POS offline, los tokens insertados en la base de datos no expiran (se inserta 2099-12-31T23:59:59Z programáticamente).

## 2. Decisiones Arquitectónicas Clave (ADRs)

1. **Lazy Sync Session (Checkout Directo):** A diferencia de la app de Picking (donde cada acción viaja al backend), en "Sin Filas" el dispositivo móvil acumula el carrito localmente de forma rápida y offline. Solo al presionar "Finalizar", se envía el array completo de items a /api/sf/sessions/checkout-direct, reduciendo latencia y peticiones.
2. **Generación Local del QR:** El string de texto para el POS es altamente específico. Generarlo en el frontend elimina la necesidad de transferir blobs o strings largos, manteniendo el backend exclusivamente para la persistencia transaccional.
3. **Limpieza de Módulos:** Se eliminaron las carpetas uth, checkout e items del backend, fusionando sus responsabilidades de forma más cohesiva en sessions y dmin para simplificar el mantenimiento.

## 3. Scripts y Comandos Backend
- \
pm run dev\: Inicia el servidor de desarrollo (nodemon).
- \
pm run build\: Compila TypeScript a dist/.
- \
pm start\: Ejecuta el servidor compilado.

---
*Documentación generada y mantenida para el ecosistema Sin Filas (Frontend React + Backend Express Vercel).*
