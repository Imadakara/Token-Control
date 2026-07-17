CREATE TABLE "action_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"result" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "cargo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"kind" text NOT NULL,
	"item_type" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"props" jsonb
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"packet_seq" integer NOT NULL,
	"ovm_submitted" numeric(14, 3) NOT NULL,
	"ovm_accepted" numeric(14, 3) NOT NULL,
	"tokens" jsonb NOT NULL,
	"interval_start" timestamp with time zone NOT NULL,
	"interval_end" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_player_id_packet_seq_unique" UNIQUE("player_id","packet_seq")
);
--> statement-breakpoint
CREATE TABLE "game_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "known_objects" (
	"player_id" text NOT NULL,
	"object_id" uuid NOT NULL,
	"level" text NOT NULL,
	CONSTRAINT "known_objects_player_id_object_id_pk" PRIMARY KEY("player_id","object_id")
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sector_id" text NOT NULL,
	"type" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resource_type" text,
	"resource_amount" integer,
	"max_resource" integer,
	"respawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"steam_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ovm_buffer" numeric(14, 3) DEFAULT '0' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "players_steam_id_unique" UNIQUE("steam_id")
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"player_id" text NOT NULL,
	"slot" smallint NOT NULL,
	"action_type" text NOT NULL,
	"params" jsonb,
	"cost_ovm" numeric(14, 3) NOT NULL,
	"progress_ovm" numeric(14, 3) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	CONSTRAINT "queues_player_id_slot_pk" PRIMARY KEY("player_id","slot")
);
--> statement-breakpoint
CREATE TABLE "sectors" (
	"id" text PRIMARY KEY NOT NULL,
	"gx" integer NOT NULL,
	"gy" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ships" (
	"player_id" text PRIMARY KEY NOT NULL,
	"sector_id" text NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"docked_object_id" uuid
);
--> statement-breakpoint
CREATE TABLE "visited_sectors" (
	"player_id" text NOT NULL,
	"sector_id" text NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visited_sectors_player_id_sector_id_pk" PRIMARY KEY("player_id","sector_id")
);
--> statement-breakpoint
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_objects" ADD CONSTRAINT "known_objects_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "known_objects" ADD CONSTRAINT "known_objects_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ships" ADD CONSTRAINT "ships_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visited_sectors" ADD CONSTRAINT "visited_sectors_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;