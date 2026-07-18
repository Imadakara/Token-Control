ALTER TABLE "queues" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "queues" SET "activated_at" = now() WHERE "status" = 'active';