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
const env_1 = require("./config/env");
const routes_1 = require("./routes");
const room_routes_1 = __importDefault(require("./routes/room.routes"));
const security_1 = require("./middlewares/security");
const error_1 = require("./middlewares/error");
const logger = (0, pino_1.default)({ transport: { target: 'pino-pretty' } });
const app = (0, express_1.default)();
const PORT = Number(env_1.ENV.PORT) || 8080;
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: [
        "http://localhost:5173",
        "https://ansangah.github.io",
    ],
    credentials: true,
}));
app.use(express_1.default.json({ limit: '1mb' }));
app.use((0, pino_http_1.default)({ logger }));
app.use(security_1.requestLimiter);
app.get('/health', (_req, res) => {
    res.json({ ok: true, env: env_1.ENV.NODE_ENV, time: new Date().toISOString() });
});
app.use('/api', routes_1.router);
app.use(error_1.notFoundHandler);
app.use(error_1.errorHandler);
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on ${PORT}`);
});
app.use("/api", room_routes_1.default);
