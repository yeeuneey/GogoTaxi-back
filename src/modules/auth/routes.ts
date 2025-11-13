import { Router } from 'express';
import { SignUpDto, LoginDto } from './dto';
import { signUp, login } from './service';

export const authRouter = Router();

// 회원가입
authRouter.post('/signup', async (req, res) => {
  try {
    const input = SignUpDto.parse(req.body);
    const result = await signUp(input);
    res.status(201).json(result);
  } catch (e: any) {
    if (e?.message === 'EMAIL_TAKEN') return res.status(409).json({ message: 'Email already in use' });
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});

// 로그인
authRouter.post('/login', async (req, res) => {
  try {
    const input = LoginDto.parse(req.body);
    const result = await login(input);
    res.json(result);
  } catch (e: any) {
    if (e?.message === 'INVALID_CREDENTIALS') return res.status(401).json({ message: 'Invalid email or password' });
    if (e?.name === 'ZodError') return res.status(400).json({ message: 'Validation failed', issues: e.issues });
    console.error(e);
    res.status(500).json({ message: 'Internal error' });
  }
});