"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = notFoundHandler;
exports.errorHandler = errorHandler;
function notFoundHandler(_req, res) {
    res.status(404).json({ message: 'Not found' });
}
function errorHandler(err, _req, res, _next) {
    console.error(err);
    if (res.headersSent)
        return;
    const status = err?.status ?? 500;
    const message = err?.message ?? 'Internal error';
    res.status(status).json({ message });
}
