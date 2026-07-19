-- Флот: ships (один корабль на игрока) → entities (ТЗ v0.02 п. 2).
-- Порядок правлен вручную: drizzle-kit не генерирует бэкфилл, а NOT NULL
-- колонки нельзя добавить в непустые queues/cargo без него.
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"name" text NOT NULL,
	"class_id" text NOT NULL,
	"sector_id" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"docked_object_id" uuid,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hp" integer NOT NULL,
	"hp_max" integer NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "home_sector_id" text;--> statement-breakpoint

-- Бэкфилл: каждый существующий корабль становится сущностью класса scout_mk1.
INSERT INTO "entities" ("player_id", "name", "class_id", "sector_id", "x", "y", "docked_object_id", "modules", "hp", "hp_max")
SELECT "player_id", 'БОРТ-001', 'scout_mk1', "sector_id", "x", "y", "docked_object_id",
       '["mining_laser","survey_array"]'::jsonb, 10, 10
FROM "ships";--> statement-breakpoint
UPDATE "players" p SET "home_sector_id" = s."sector_id" FROM "ships" s WHERE s."player_id" = p."id";--> statement-breakpoint

-- Очередь переезжает на сущность. Осиротевшие строки (игрок без корабля)
-- удаляются: восстановить их не из чего, а NOT NULL их не пропустит.
ALTER TABLE "queues" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
UPDATE "queues" q SET "entity_id" = e."id" FROM "entities" e WHERE e."player_id" = q."player_id";--> statement-breakpoint
DELETE FROM "queues" WHERE "entity_id" IS NULL;--> statement-breakpoint
ALTER TABLE "queues" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "queues" DROP CONSTRAINT "queues_player_id_slot_pk";--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_entity_id_slot_pk" PRIMARY KEY("entity_id","slot");--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queues_player_idx" ON "queues" USING btree ("player_id");--> statement-breakpoint

-- Трюм переезжает на сущность: груз физически локализован.
ALTER TABLE "cargo" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
UPDATE "cargo" c SET "entity_id" = e."id" FROM "entities" e WHERE e."player_id" = c."player_id";--> statement-breakpoint
DELETE FROM "cargo" WHERE "entity_id" IS NULL;--> statement-breakpoint
ALTER TABLE "cargo" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
