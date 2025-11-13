import { z } from 'zod';

export const SignUpDto = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(64),
  nickname: z.string().min(1).max(30)
});
export type SignUpDto = z.infer<typeof SignUpDto>;

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(64)
});
export type LoginDto = z.infer<typeof LoginDto>;