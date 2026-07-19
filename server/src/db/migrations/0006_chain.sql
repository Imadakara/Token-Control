CREATE TABLE "chain_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"target_sector_id" text,
	"source" text DEFAULT 'debug' NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sector_links" (
	"a_sector_id" text NOT NULL,
	"b_sector_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_links_a_sector_id_b_sector_id_pk" PRIMARY KEY("a_sector_id","b_sector_id")
);
--> statement-breakpoint
ALTER TABLE "chain_keys" ADD CONSTRAINT "chain_keys_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;