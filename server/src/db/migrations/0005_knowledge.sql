CREATE TABLE "player_knowledge" (
	"player_id" text NOT NULL,
	"entry_id" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_knowledge_player_id_entry_id_pk" PRIMARY KEY("player_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "player_tech" (
	"player_id" text NOT NULL,
	"tech_id" text NOT NULL,
	"researched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_tech_player_id_tech_id_pk" PRIMARY KEY("player_id","tech_id")
);
--> statement-breakpoint
ALTER TABLE "player_knowledge" ADD CONSTRAINT "player_knowledge_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_tech" ADD CONSTRAINT "player_tech_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;