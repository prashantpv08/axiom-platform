ALTER TABLE "architecture_options" ADD COLUMN "position" integer;--> statement-breakpoint
WITH ranked AS (SELECT ctid, row_number() OVER (PARTITION BY organization_id, project_id, graph_version ORDER BY id) - 1 AS position FROM architecture_options) UPDATE architecture_options AS target SET position = ranked.position FROM ranked WHERE target.ctid = ranked.ctid;--> statement-breakpoint
ALTER TABLE "architecture_options" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "clarification_questions" ADD COLUMN "position" integer;--> statement-breakpoint
WITH ranked AS (SELECT ctid, row_number() OVER (PARTITION BY organization_id, project_id, graph_version ORDER BY id) - 1 AS position FROM clarification_questions) UPDATE clarification_questions AS target SET position = ranked.position FROM ranked WHERE target.ctid = ranked.ctid;--> statement-breakpoint
ALTER TABLE "clarification_questions" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD COLUMN "position" integer;--> statement-breakpoint
WITH ranked AS (SELECT ctid, row_number() OVER (PARTITION BY organization_id, project_id, graph_version ORDER BY id) - 1 AS position FROM knowledge_entities) UPDATE knowledge_entities AS target SET position = ranked.position FROM ranked WHERE target.ctid = ranked.ctid;--> statement-breakpoint
ALTER TABLE "knowledge_entities" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_gaps" ADD COLUMN "position" integer;--> statement-breakpoint
WITH ranked AS (SELECT ctid, row_number() OVER (PARTITION BY organization_id, project_id, graph_version ORDER BY id) - 1 AS position FROM project_gaps) UPDATE project_gaps AS target SET position = ranked.position FROM ranked WHERE target.ctid = ranked.ctid;--> statement-breakpoint
ALTER TABLE "project_gaps" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tech_stack_recommendations" ADD COLUMN "position" integer;--> statement-breakpoint
WITH ranked AS (SELECT ctid, row_number() OVER (PARTITION BY organization_id, project_id, graph_version ORDER BY id) - 1 AS position FROM tech_stack_recommendations) UPDATE tech_stack_recommendations AS target SET position = ranked.position FROM ranked WHERE target.ctid = ranked.ctid;--> statement-breakpoint
ALTER TABLE "tech_stack_recommendations" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "architecture_options" ADD CONSTRAINT "architecture_options_position_check" CHECK ("architecture_options"."position" >= 0);--> statement-breakpoint
ALTER TABLE "clarification_questions" ADD CONSTRAINT "clarification_questions_position_check" CHECK ("clarification_questions"."position" >= 0);--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD CONSTRAINT "knowledge_entities_position_check" CHECK ("knowledge_entities"."position" >= 0);--> statement-breakpoint
ALTER TABLE "project_gaps" ADD CONSTRAINT "project_gaps_position_check" CHECK ("project_gaps"."position" >= 0);--> statement-breakpoint
ALTER TABLE "tech_stack_recommendations" ADD CONSTRAINT "tech_stack_recommendations_position_check" CHECK ("tech_stack_recommendations"."position" >= 0);
