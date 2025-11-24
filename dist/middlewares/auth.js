"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
const jwt_1 = require("../lib/jwt");
function requireAuth(req, res, next) {
    const header = req.headers.authorization; // "Bearer <token>"
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized: missing Bearer token' });
    }
    const token = header.slice('Bearer '.length);
    try {
        const payload = (0, jwt_1.verifyAccessJwt)(token);
        req.user = payload;
        req.userId = payload.sub;
        next();
    }
    catch (err) {
        const message = err?.message === 'INVALID_TOKEN_TYPE' ? 'Unauthorized: invalid token type' : 'Unauthorized: invalid token';
        return res.status(401).json({ message });
    }
}
