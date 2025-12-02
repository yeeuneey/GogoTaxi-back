import { Router } from "express";
import roomRouter from "./routes/room.routes";

// 인증
import { authRouter } from "./modules/auth/routes";
import { requireAuth } from "./middlewares/auth";

// 프로필 관련 서비스
import { getProfile, updateProfile, changePassword } from "./modules/auth/service";
import { UpdateProfileDto, ChangePasswordDto } from "./modules/auth/dto";

// 지갑 / 결제 / 정산
import { walletRouter } from "./modules/wallet/routes";
import { paymentsRouter } from "./modules/payments/routes";
import { settlementRouter } from "./modules/settlement/routes";

// 후기 / 신고
import { reviewRouter } from "./modules/review/routes";
import { reportRouter } from "./modules/report/routes";

// Prisma (알림 조회용)
import { prisma } from "./lib/prisma";

export const router = Router();

/* ============================================
   상태 확인
=============================================== */
router.get("/", (_req, res) => res.json({ message: "GogoTaxi backend up" }));
/* ============================================
   인증 관련
=============================================== */
router.use("/auth", authRouter);

/* ============================================
   지갑 / 결제 / 정산
=============================================== */
router.use("/wallet", walletRouter);
router.use("/payments", paymentsRouter);
router.use("/settlements", settlementRouter);
router.use(roomRouter);

/* ============================================
   알림
   (보호 라우트: 로그인 필요)
=============================================== */
router.get("/notifications", requireAuth, async (_req, res) => {
  try {
    const notifications = await prisma.notice.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return res.json({ notifications });
  } catch (error) {
    console.error("notifications error", error);
    return res.status(500).json({ message: "Failed to load notifications" });
  }
});

/* ============================================
   후기 / 신고
=============================================== */
router.use("/reviews", reviewRouter);
router.use("/reports", reportRouter);

/* ============================================
   보호 API (로그인 필요)
=============================================== */
router.get("/me", requireAuth, async (req, res) => {
  try {
    const me = await getProfile(req.userId);
    res.json({ me });
  } catch (e) {
    if (e?.message === "USER_NOT_FOUND")
      return res.status(404).json({ message: "User not found" });

    console.error(e);
    res.status(500).json({ message: "Internal error" });
  }
});

router.patch("/me", requireAuth, async (req, res) => {
  try {
    const input = UpdateProfileDto.parse(req.body);
    const me = await updateProfile(req.userId, input);
    res.json({ me });
  } catch (e) {
    if (e?.name === "ZodError")
      return res.status(400).json({ message: "Validation failed", issues: e.issues });
    if (e?.message === "USER_NOT_FOUND")
      return res.status(404).json({ message: "User not found" });

    console.error(e);
    res.status(500).json({ message: "Internal error" });
  }
});

router.patch("/me/password", requireAuth, async (req, res) => {
  try {
    const input = ChangePasswordDto.parse(req.body);
    await changePassword(req.userId, input);
    res.json({ success: true });
  } catch (e) {
    if (e?.name === "ZodError")
      return res.status(400).json({ message: "Validation failed", issues: e.issues });
    if (e?.message === "INVALID_CURRENT_PASSWORD")
      return res.status(401).json({ message: "Current password is incorrect" });
    if (e?.message === "PASSWORD_NOT_SET")
      return res.status(400).json({ message: "Password not set for this account" });

    console.error(e);
    res.status(500).json({ message: "Internal error" });
  }
});
