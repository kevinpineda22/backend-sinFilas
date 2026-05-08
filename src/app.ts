import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Ruta base
app.get('/api/sf/health', (req, res) => {
  res.json({ status: 'ok', service: 'Sin Filas API' });
});

export default app;