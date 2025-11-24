import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { ENV } from './config/env';
import { router } from './routes';
import { requestLimiter } from './middlewares/security';
import { errorHandler, notFoundHandler } from './middlewares/error';

const logger = pino({ transport: { target: 'pino-pretty' } });
const app = express();

const PORT = Number(ENV.PORT) || 8080;

app.use(helmet());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://ansangah.github.io",
    ],
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));
app.use(requestLimiter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: ENV.NODE_ENV, time: new Date().toISOString() });
});

app.use('/api', router);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on ${PORT}`);
});
