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

app.set('etag', false);

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
app.use(
  express.raw({
    type: () => true,
    limit: '6mb'
  })
);

app.use((req, _res, next) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    req.body = {};
    return next();
  }
  const rawText = req.body.toString('utf-8').trim();
  if (!rawText) {
    req.body = {};
    return next();
  }

  const jsonStart = rawText.indexOf('{');
  if (jsonStart !== -1) {
    const candidate = rawText.slice(jsonStart);
    try {
      req.body = JSON.parse(candidate);
      return next();
    } catch (error) {
      // fall through
    }
  }

  if (!rawText.includes('\n') && rawText.includes('=')) {
    req.body = Object.fromEntries(new URLSearchParams(rawText));
    return next();
  }

  req.body = { raw: rawText };
  next();
});
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
