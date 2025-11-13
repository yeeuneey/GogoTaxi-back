import express, { type Request, type Response } from 'express';
import cors, { type CorsOptions } from 'cors';
import dotenv from 'dotenv';
import { PrismaClient, type User } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { randomUUID } from 'node:crypto';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 4000;

const prisma = new PrismaClient();
const prismaAny = prisma as Record<string, any>;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not configured.');
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const RAW_ALLOWED_ORIGINS =
  process.env.ALLOWED_ORIGINS ??
  'http://localhost:5173,https://yeeuneey.github.io';
const allowedOrigins = RAW_ALLOWED_ORIGINS.split(',')
  .map(origin => origin.trim())
  .filter(origin => origin.length > 0);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(
      new Error(
        `Origin ${origin} is not allowed by CORS (configure ALLOWED_ORIGINS).`
      )
    );
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

const toTrimmedString = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]).trim() : '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
};

const toBoolean = (value: unknown) => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return Boolean(value);
};

type SocialProvider = 'kakao' | 'google';

interface ProviderProfile {
  provider: SocialProvider;
  providerUserId: string;
  email?: string;
  name?: string;
  profileImage?: string;
}

interface SocialLoginRequestBody {
  provider?: SocialProvider;
  accessToken?: string;
  idToken?: string;
}

interface KakaoProfileResponse {
  id: number | string;
  kakao_account?: {
    email?: string;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
      thumbnail_image_url?: string;
    };
  };
  properties?: {
    nickname?: string;
    profile_image?: string;
    thumbnail_image?: string;
  };
}

interface GoogleTokenInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  aud: string;
}

const createJwt = (userId: string) =>
  jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });

const fetchKakaoProfile = async (accessToken: string): Promise<ProviderProfile> => {
  const response = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kakao API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as KakaoProfileResponse;
  const providerUserId = String(data.id);
  const kakaoAccount = data.kakao_account;
  const nickname =
    kakaoAccount?.profile?.nickname ??
    data.properties?.nickname ??
    'Kakao User';
  const profileImage =
    kakaoAccount?.profile?.profile_image_url ??
    data.properties?.profile_image;

  const profile: ProviderProfile = {
    provider: 'kakao',
    providerUserId,
    name: nickname,
  };

  if (kakaoAccount?.email) {
    profile.email = kakaoAccount.email;
  }

  if (profileImage) {
    profile.profileImage = profileImage;
  }

  return profile;
};

const fetchGoogleProfile = async (token: string): Promise<ProviderProfile> => {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Google token verification error: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as GoogleTokenInfo;

  if (GOOGLE_CLIENT_ID && data.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Google token audience mismatch.');
  }

  const profile: ProviderProfile = {
    provider: 'google',
    providerUserId: data.sub,
    name: data.name ?? 'Google User',
  };

  if (data.email) {
    profile.email = data.email;
  }

  if (data.picture) {
    profile.profileImage = data.picture;
  }

  return profile;
};

const ensureUserForSocialProfile = async (
  profile: ProviderProfile
): Promise<User> => {
  const existingSocial = await prismaAny.socialAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    },
    include: { user: true },
  });

  if (existingSocial) {
    await prismaAny.socialAccount.update({
      where: { id: existingSocial.id },
      data: {
        email: profile.email ?? existingSocial.email,
        displayName: profile.name ?? existingSocial.displayName,
        profileImage: profile.profileImage ?? existingSocial.profileImage,
      },
    });

    return existingSocial.user;
  }

  const hashedPassword = await bcrypt.hash(randomUUID(), 10);
  const defaultName =
    profile.name ??
    (profile.provider === 'kakao' ? 'Kakao User' : 'Google User');

  const user = await prisma.user.create({
    data: {
      userid: `${profile.provider}_${profile.providerUserId}`,
      password: hashedPassword,
      name: defaultName,
      gender: null,
      socialAccounts: {
        create: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
          displayName: profile.name ?? defaultName,
          profileImage: profile.profileImage,
        },
      },
    } as any,
  } as any);

  return user;
};

app.use(cors(corsOptions));
app.options('/{*splat}', cors(corsOptions));
app.use(express.json());

app.get('/api/test', (_req, res) => {
  res.json({ message: 'Backend server running' });
});

app.get('/api/auth/check-id', async (req, res) => {
  try {
    const userid = toTrimmedString(req.query.userid);
    if (!userid) {
      return res
        .status(400)
        .json({ error: 'Query parameter "userid" is required.' });
    }

    const existing = await prisma.user.findUnique({
      where: { userid },
      select: { id: true },
    });

    res.status(200).json({ available: !existing });
  } catch (error) {
    console.error('check-id error:', error);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

const handleRegister = async (req: Request, res: Response) => {
  try {
    const { userid, pw, name, gender, sms, terms, phone, birthDate } = req.body;

    const normalizedUserid = toTrimmedString(userid);
    const normalizedName = toTrimmedString(name);
    const password = typeof pw === 'string' ? pw : '';

    if (!normalizedUserid || !password || !normalizedName) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const digitsOnlyPhone = toTrimmedString(phone).replace(/\D/g, '');
    const normalizedPhone = digitsOnlyPhone.length > 0 ? digitsOnlyPhone : null;

    let parsedBirthDate: Date | null = null;
    const birthDateInput = toTrimmedString(birthDate);
    if (birthDateInput) {
      const candidate = new Date(birthDateInput);
      if (Number.isNaN(candidate.getTime())) {
        return res.status(400).json({ error: 'Invalid birthDate format.' });
      }
      parsedBirthDate = candidate;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        userid: normalizedUserid,
        password: hashedPassword,
        name: normalizedName,
        gender: toTrimmedString(gender) || null,
        smsConsent: toBoolean(sms),
        termsConsent: toBoolean(terms),
        phone: normalizedPhone,
        birthDate: parsedBirthDate,
      },
    });

    res.status(201).json({
      message: 'Signup successful.',
      userId: newUser.id,
      user: {
        id: newUser.id,
        userid: newUser.userid,
        name: newUser.name,
      },
    });
  } catch (error: any) {
    if (error.code === 'P2002' && error.meta?.target?.includes('userid')) {
      return res.status(409).json({ error: 'User ID already in use.' });
    }
    console.error('register error:', error);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
};

app.post('/api/auth/register', handleRegister);
app.post('/api/auth/signup', handleRegister);

app.post('/api/auth/login', async (req, res) => {
  try {
    const { id, userid, pw } = req.body;

    const loginId = toTrimmedString(userid) || toTrimmedString(id);
    const password = typeof pw === 'string' ? pw : '';

    if (!loginId || !password) {
      return res
        .status(400)
        .json({ error: 'User ID and password are required.' });
    }

    const user = await prisma.user.findUnique({
      where: { userid: loginId },
    });

    if (!user) {
      return res.status(404).json({ error: 'User does not exist.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Password mismatch.' });
    }

    const token = createJwt(user.id);

    res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        userid: user.userid,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('login error:', error);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

app.post('/api/auth/social', async (req, res) => {
  try {
    const { provider, accessToken, idToken } =
      req.body as SocialLoginRequestBody;

    if (provider !== 'kakao' && provider !== 'google') {
      return res.status(400).json({ error: 'Unsupported social provider.' });
    }

    let profile: ProviderProfile;

    if (provider === 'kakao') {
      if (!accessToken) {
        return res.status(400).json({ error: 'Kakao accessToken is required.' });
      }
      profile = await fetchKakaoProfile(accessToken);
    } else {
      const tokenToVerify = idToken ?? accessToken;
      if (!tokenToVerify) {
        return res.status(400).json({ error: 'Google idToken is required.' });
      }
      profile = await fetchGoogleProfile(tokenToVerify);
    }

    const user = await ensureUserForSocialProfile(profile);
    const token = createJwt(user.id);

    return res.status(200).json({
      message: 'Social login successful.',
      token,
      user: {
        id: user.id,
        userid: user.userid,
        name: user.name,
      },
      providerProfile: profile,
    });
  } catch (error) {
    console.error('social login error:', error);
    res.status(500).json({ error: 'Social login failed.' });
  }
});

app.get('/api/profile/:userid', async (req, res) => {
  try {
    const normalizedUserid = toTrimmedString(req.params.userid);
    if (!normalizedUserid) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    const user = await prisma.user.findUnique({
      where: { userid: normalizedUserid },
      select: {
        id: true,
        userid: true,
        name: true,
        gender: true,
        phone: true,
        birthDate: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('profile error:', error);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

app.listen(port, () => {
  console.log(`🚕 Backend server listening on http://localhost:${port}`);
});
