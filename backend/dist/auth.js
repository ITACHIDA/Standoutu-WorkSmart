"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authGuard = void 0;
exports.signToken = signToken;
exports.forbidObserver = forbidObserver;
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("./db");
const JWT_SECRET = process.env.JWT_SECRET || 'dev-smartwork-jwt-secret';
function signToken(user) {
    const payload = { sub: user.id, role: user.role, email: user.email, name: user.name };
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}
exports.authGuard = (0, fastify_plugin_1.default)(async (instance) => {
    instance.addHook('preHandler', async (request, reply) => {
        const routeUrl = request.routeOptions?.url;
        if (routeUrl === '/health' ||
            routeUrl === '/auth/login' ||
            routeUrl === '/auth/signup') {
            return;
        }
        const header = request.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) {
            return reply.status(401).send({ message: 'Missing token' });
        }
        const token = header.slice('Bearer '.length);
        try {
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            const user = await (0, db_1.findUserById)(decoded.sub);
            if (!user) {
                return reply.status(401).send({ message: 'Invalid token' });
            }
            request.authUser = user;
        }
        catch {
            return reply.status(401).send({ message: 'Invalid token' });
        }
    });
});
function forbidObserver(reply, user) {
    if (user?.role === 'OBSERVER') {
        reply.status(403).send({ message: 'Observer role cannot access this resource' });
        return true;
    }
    return false;
}
