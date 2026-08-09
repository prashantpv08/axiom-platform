DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM agent_runs) OR EXISTS (SELECT 1 FROM model_calls) OR EXISTS (SELECT 1 FROM work_item_generations WHERE agent_run_id IS NOT NULL) THEN
		RAISE EXCEPTION 'remove Agent Kernel evidence through the retention workflow before rollback';
	END IF;
END;
$$;
DROP TRIGGER IF EXISTS agent_runs_guarded ON agent_runs;
DROP FUNCTION IF EXISTS axiom_guard_agent_run_update();
DROP TRIGGER IF EXISTS model_calls_immutable ON model_calls;
DROP TRIGGER IF EXISTS agent_workflow_versions_immutable ON agent_workflow_versions;
DROP TRIGGER IF EXISTS prompt_versions_immutable ON prompt_versions;
DROP FUNCTION IF EXISTS axiom_prevent_agent_evidence_update();
ALTER TABLE "work_item_generations" DROP CONSTRAINT "work_item_generations_agent_run_scope_fk";
DROP INDEX "work_item_generations_agent_run_uidx";
ALTER TABLE "work_item_generations" DROP COLUMN "agent_run_id";
ALTER TABLE "agent_runs" DROP CONSTRAINT "agent_runs_final_model_call_fk";
DROP TABLE "model_calls";
DROP TABLE "agent_runs";
DROP TABLE "agent_workflow_versions";
DROP TABLE "prompt_versions";
