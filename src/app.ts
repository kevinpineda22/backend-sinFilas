import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import catalogRoutes from './modules/catalog/catalog.route';
import sessionsRoutes from './modules/sessions/sessions.route';
import adminRoutes from './modules/admin/admin.route';

const app = express();

app.use(helmet());
app.use(cors({
  origin: '*', // Permitir cualquier origen
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Sede-ID']
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
