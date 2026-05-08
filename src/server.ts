import 'dotenv/config';
import app from './app';

const PORT = process.env.PORT || 3000;

// En Vercel serverless, NO debemos llamar app.listen() — el runtime
// invoca el default export como handler. listen() sólo en dev local.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Servidor Sin Filas corriendo en el puerto ${PORT}`);
  });
}

export default app;
