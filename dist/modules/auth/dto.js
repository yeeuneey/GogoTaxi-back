"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocialConsentDto = exports.SocialLoginDto = exports.ChangePasswordDto = exports.UpdateProfileDto = exports.RefreshTokenDto = exports.LoginDto = exports.SignUpDto = void 0;
const zod_1 = require("zod");
exports.SignUpDto = zod_1.z.object({
    loginId: zod_1.z.string().min(4).max(30),
    password: zod_1.z.string().min(8).max(64),
    name: zod_1.z.string().min(1).max(50),
    gender: zod_1.z.enum(['M', 'F']),
    phone: zod_1.z.string().min(5).max(20),
    birthDate: zod_1.z.coerce.date(),
    smsConsent: zod_1.z.boolean(),
    termsConsent: zod_1.z.boolean()
});
exports.LoginDto = zod_1.z.object({
    loginId: zod_1.z.string().min(4).max(30),
    password: zod_1.z.string().min(8).max(64)
});
exports.RefreshTokenDto = zod_1.z.object({
    refreshToken: zod_1.z.string().min(20)
});
exports.UpdateProfileDto = zod_1.z
    .object({
    name: zod_1.z.string().min(1).max(50).optional(),
    phone: zod_1.z.string().min(5).max(20).optional(),
    gender: zod_1.z.enum(['M', 'F']).optional(),
    birthDate: zod_1.z.coerce.date().optional()
})
    .refine((val) => Object.values(val).some((v) => v !== undefined), {
    message: 'At least one field is required'
});
exports.ChangePasswordDto = zod_1.z.object({
    currentPassword: zod_1.z.string().min(8).max(64),
    newPassword: zod_1.z.string().min(8).max(64)
});
exports.SocialLoginDto = zod_1.z
    .object({
    provider: zod_1.z.enum(['kakao', 'google']),
    code: zod_1.z.string().min(4).optional(),
    accessToken: zod_1.z.string().min(8).optional(),
    profile: zod_1.z
        .object({
        id: zod_1.z.string().min(1),
        name: zod_1.z.string().min(1).max(50).optional(),
        email: zod_1.z.string().email().optional()
    })
        .optional(),
    redirectUri: zod_1.z.string().optional()
})
    .superRefine((val, ctx) => {
    if (!val.code && !val.accessToken) {
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: 'Either code or accessToken is required' });
    }
    if (val.provider === 'kakao' && !val.accessToken) {
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: 'Kakao login requires accessToken' });
    }
});
exports.SocialConsentDto = zod_1.z.object({
    pendingToken: zod_1.z.string().min(10),
    termsConsent: zod_1.z.boolean(),
    smsConsent: zod_1.z.boolean().optional(),
    name: zod_1.z.string().min(1).max(50).optional(),
    gender: zod_1.z.enum(['M', 'F']).optional()
});
