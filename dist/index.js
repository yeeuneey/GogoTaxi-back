"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const pino_1 = __importDefault(require("pino"));
const pino_http_1 = __importDefault(require("pino-http"));
const http_1 = require("http");
const env_1 = require("./config/env");
// Use the routes/index.ts (folder) router which includes ride-related endpoints.
// Explicitly import the router defined in src/routes/index.ts (not the legacy src/routes.ts)
const index_1 = require("./routes/index");
const security_1 = require("./middlewares/security");
const error_1 = require("./middlewares/error");
const socket_1 = require("./lib/socket");
const logger = (0, pino_1.default)({ transport: { target: 'pino-pretty' } });
const app = (0, express_1.default)();
const PORT = Number(env_1.ENV.PORT) || 8080;
app.set('etag', false);
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: [
        "http://localhost:5173",
        "https://ansangah.github.io",
    ],
    credentials: true,
}));
app.use(express_1.default.raw({
    type: () => true,
    limit: '1mb'
}));
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
        }
        catch (error) {
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
app.use((0, pino_http_1.default)({ logger }));
app.use(security_1.requestLimiter);
app.get('/health', (_req, res) => {
    res.json({ ok: true, env: env_1.ENV.NODE_ENV, time: new Date().toISOString() });
});
app.use('/api', index_1.router);
app.use(error_1.notFoundHandler);
app.use(error_1.errorHandler);
const server = (0, http_1.createServer)(app);
(0, socket_1.initSocket)(server);
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on ${PORT}`);
});
