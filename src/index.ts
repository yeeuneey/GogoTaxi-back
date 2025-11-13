import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { ENV } from './config/env';
import { router } from './routes';

const logger = pino({ transport: { target: 'pino-pretty' } });
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: ENV.NODE_ENV, time: new Date().toISOString() });
});

app.use('/api', router);

app.listen(ENV.PORT, () => {
  logger.info(`🚀 Server listening on http://localhost:${ENV.PORT}`);
});