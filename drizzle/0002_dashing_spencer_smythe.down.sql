ALTER TABLE "architecture_options" DROP CONSTRAINT "architecture_options_position_check";--> statement-breakpoint
ALTER TABLE "clarification_questions" DROP CONSTRAINT "clarification_questions_position_check";--> statement-breakpoint
ALTER TABLE "knowledge_entities" DROP CONSTRAINT "knowledge_entities_position_check";--> statement-breakpoint
ALTER TABLE "project_gaps" DROP CONSTRAINT "project_gaps_position_check";--> statement-breakpoint
ALTER TABLE "tech_stack_recommendations" DROP CONSTRAINT "tech_stack_recommendations_position_check";--> statement-breakpoint
ALTER TABLE "architecture_options" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "clarification_questions" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "knowledge_entities" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "project_gaps" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "tech_stack_recommendations" DROP COLUMN "position";
