import { z } from 'zod';

export const SignUpDto = z.object({
<<<<<<< HEAD
  email: z.string().email(),
  password: z.string().min(8).max(64),
  nickname: z.string().min(1).max(30)
=======
  loginId: z.string().min(4).max(30),
  password: z.string().min(8).max(64),
  name: z.string().min(1).max(50),
  gender: z.enum(['M', 'F']),
  phone: z.string().min(5).max(20),
  birthDate: z.coerce.date(),
  smsConsent: z.boolean(),
  termsConsent: z.boolean()
>>>>>>> upstream/main
});
export type SignUpDto = z.infer<typeof SignUpDto>;

export const LoginDto = z.object({
<<<<<<< HEAD
  email: z.string().email(),
  password: z.string().min(8).max(64)
});
export type LoginDto = z.infer<typeof LoginDto>;
=======
  loginId: z.string().min(4).max(30),
  password: z.string().min(8).max(64)
});
export type LoginDto = z.infer<typeof LoginDto>;

export const RefreshTokenDto = z.object({
  refreshToken: z.string().min(20)
});
export type RefreshTokenDto = z.infer<typeof RefreshTokenDto>;

export const UpdateProfileDto = z
  .object({
    name: z.string().min(1).max(50).optional(),
    phone: z.string().min(5).max(20).optional(),
    gender: z.enum(['M', 'F']).optional(),
    birthDate: z.coerce.date().optional()
  })
  .refine((val) => Object.values(val).some((v) => v !== undefined), {
    message: 'At least one field is required'
  });
export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;

export const ChangePasswordDto = z.object({
  currentPassword: z.string().min(8).max(64),
  newPassword: z.string().min(8).max(64)
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordDto>;

export const SocialLoginDto = z
  .object({
    provider: z.enum(['kakao', 'google']),
    code: z.string().min(4).optional(),
    accessToken: z.string().min(8).optional(),
    profile: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1).max(50).optional(),
        email: z.string().email().optional()
      })
      .optional(),
    redirectUri: z.string().optional()
  })
  .superRefine((val, ctx) => {
    if (!val.code && !val.accessToken) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Either code or accessToken is required' });
    }
  });
export type SocialLoginDto = z.infer<typeof SocialLoginDto>;

export const SocialConsentDto = z.object({
  pendingToken: z.string().min(10),
  termsConsent: z.boolean(),
  smsConsent: z.boolean().optional(),
  name: z.string().min(1).max(50).optional(),
  gender: z.enum(['M', 'F']).optional(),
  phone: z.string().min(5).max(20).optional(),
  birthDate: z.coerce.date().optional()
});
export type SocialConsentDto = z.infer<typeof SocialConsentDto>;
>>>>>>> upstream/main
