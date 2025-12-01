CREATE TABLE "RideHistory" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "SettlementRole" NOT NULL,
    "deposit" INTEGER NOT NULL DEFAULT 0,
    "extra_collect" INTEGER NOT NULL DEFAULT 0,
    "refund" INTEGER NOT NULL DEFAULT 0,
    "net_amount" INTEGER NOT NULL DEFAULT 0,
    "actual_fare" INTEGER NOT NULL,
    "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RideHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RideHistory_room_id_user_id_key" ON "RideHistory"("room_id", "user_id");

CREATE INDEX "RideHistory_user_id_idx" ON "RideHistory"("user_id");

ALTER TABLE "RideHistory" ADD CONSTRAINT "RideHistory_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RideHistory" ADD CONSTRAINT "RideHistory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
