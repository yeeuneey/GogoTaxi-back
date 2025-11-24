"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.issueAccessToken = issueAccessToken;
exports.issueRefreshToken = issueRefreshToken;
exports.verifyAccessJwt = verifyAccessJwt;
exports.verifyRefreshJwt = verifyRefreshJwt;
exports.getExpiryDate = getExpiryDate;
exports.issueSocialPendingToken = issueSocialPendingToken;
exports.verifySocialPendingToken = verifySocialPendingToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = require("crypto");
const env_1 = require("../config/env");
const ACCESS_SECRET = env_1.ENV.JWT_SECRET;
const REFRESH_SECRET = env_1.ENV.JWT_REFRESH_SECRET;
const SOCIAL_PENDING_SECRET = env_1.ENV.JWT_SECRET;
const ACCESS_EXPIRES_IN = env_1.ENV.JWT_ACCESS_EXPIRES_IN;
const REFRESH_EXPIRES_IN = env_1.ENV.JWT_REFRESH_EXPIRES_IN;
const SOCIAL_PENDING_EXPIRES_IN = '30m';
function decodeExpiry(token) {
    const decoded = jsonwebtoken_1.default.decode(token);
    if (!decoded?.exp)
        return null;
    return new Date(decoded.exp * 1000);
}
function signToken(type, payload) {
    const jti = (0, crypto_1.randomUUID)();
    const tokenPayload = { ...payload, type, jti };
    const secret = type === 'access' ? ACCESS_SECRET : REFRESH_SECRET;
    const expiresIn = type === 'access' ? ACCESS_EXPIRES_IN : REFRESH_EXPIRES_IN;
    const token = jsonwebtoken_1.default.sign(tokenPayload, secret, { expiresIn });
    return { token, payload: tokenPayload, expiresAt: decodeExpiry(token) };
}
function verifyToken(type, token) {
    const secret = type === 'access' ? ACCESS_SECRET : REFRESH_SECRET;
    const payload = jsonwebtoken_1.default.verify(token, secret);
    if (payload.type !== type) {
        throw new Error('INVALID_TOKEN_TYPE');
    }
    return payload;
}
function issueAccessToken(payload) {
    return signToken('access', payload);
}
function issueRefreshToken(payload) {
    return signToken('refresh', payload);
}
function verifyAccessJwt(token) {
    return verifyToken('access', token);
}
function verifyRefreshJwt(token) {
    return verifyToken('refresh', token);
}
function getExpiryDate(token) {
    return decodeExpiry(token);
}
function issueSocialPendingToken(payload) {
    const jti = (0, crypto_1.randomUUID)();
    const tokenPayload = { ...payload, jti, type: 'social_pending' };
    const token = jsonwebtoken_1.default.sign(tokenPayload, SOCIAL_PENDING_SECRET, {
        expiresIn: SOCIAL_PENDING_EXPIRES_IN
    });
    return { token, payload: tokenPayload, expiresAt: decodeExpiry(token) };
}
function verifySocialPendingToken(token) {
    const payload = jsonwebtoken_1.default.verify(token, SOCIAL_PENDING_SECRET);
    if (payload.type !== 'social_pending') {
        throw new Error('INVALID_TOKEN_TYPE');
    }
    return payload;
}
