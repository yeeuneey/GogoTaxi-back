import { z } from 'zod';

export const SignUpDto = z.object({
  loginId: z.string().min(4).max(30),
  password: z.string().min(8).max(64),
  name: z.string().min(1).max(50),
  gender: z.enum(['M', 'F']),
  phone: z.string().min(5).max(20),
  birthDate: z.coerce.date(),
  smsConsent: z.boolean(),
  termsConsent: z.boolean()
});
export type SignUpDto = z.infer<typeof SignUpDto>;

export const LoginDto = z.object({
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
