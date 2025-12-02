-- Add ride state enum used for Uber dispatch workflow
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RoomRideStage') THEN
    CREATE TYPE "RoomRideStage" AS ENUM (
      'idle',
      'requesting',
      'deeplink_ready',
      'dispatching',
      'driver_assigned',
      'arriving',
      'onboard',
      'completed',
      'canceled'
    );
  END IF;
END$$;

-- Create 1:1 table storing the latest ride request state for each room
CREATE TABLE IF NOT EXISTS "RoomRideState" (
  "id" TEXT NOT NULL,
  "room_id" TEXT NOT NULL,
  "stage" "RoomRideStage" NOT NULL DEFAULT 'idle',
  "deeplink_url" TEXT,
  "pickup_label" TEXT,
  "pickup_lat" DECIMAL(10, 6),
  "pickup_lng" DECIMAL(10, 6),
  "dropoff_label" TEXT,
  "dropoff_lat" DECIMAL(10, 6),
  "dropoff_lng" DECIMAL(10, 6),
  "driver_name" TEXT,
  "car_model" TEXT,
  "car_number" TEXT,
  "note" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RoomRideState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoomRideState_room_id_key" UNIQUE ("room_id"),
  CONSTRAINT "RoomRideState_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "Room"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
