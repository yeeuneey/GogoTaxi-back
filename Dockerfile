# 1️⃣ Node 베이스 이미지
FROM node:20-alpine

# 2️⃣ Alpine 빌드 도구 설치 (bcrypt, prisma 등)
RUN apk add --no-cache openssl python3 make g++

# 3️⃣ 작업 디렉토리
WORKDIR /app

# 4️⃣ 패키지 복사 및 설치 (devDependencies 포함)
COPY package*.json ./
RUN npm install --include=dev

# 5️⃣ Prisma 및 TypeScript CLI 전역 설치
RUN npm install -g prisma typescript

# 6️⃣ 소스 복사
COPY . .

# 7️⃣ Prisma Client 생성
RUN npx prisma generate

# 8️⃣ TypeScript 빌드
RUN npx tsc

# 9️⃣ 포트 노출
EXPOSE 3000

# 🔟 실행 명령
CMD ["npm", "run", "start"]
