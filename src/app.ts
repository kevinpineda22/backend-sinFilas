import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import catalogRoutes from './modules/catalog/catalog.route';
import sessionsRoutes from './modules/sessions/sessions.route';
import adminRoutes from './modules/admin/admin.route';

const app = express();

// CORS primero — antes que cualquier otro middleware que pueda terminar la respuesta.
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Sede-ID']
}));

// helmet con CORP relajado: por default bloquea recursos cross-origin y para una
// API consumida desde otro dominio (localhost:5173 / web pública) eso rompe todo.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/sf/health', (req, res) => {
  res.json({ status: 'ok', service: 'Sin Filas API' });
});

app.use('/api/sf/catalog', catalogRoutes);
app.use('/api/sf/sessions', sessionsRoutes);
app.use('/api/sf/admin', adminRoutes);

export default app;
