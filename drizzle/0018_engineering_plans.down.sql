DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM engineering_plan_generations) THEN
		RAISE EXCEPTION 'remove Engineering Plan evidence through the retention workflow before rollback';
	END IF;
END;
$$;
DROP TRIGGER IF EXISTS engineering_plan_generations_immutable ON engineering_plan_generations;
ALTER TABLE agent_workflow_versions DISABLE TRIGGER agent_workflow_versions_immutable;
DELETE FROM agent_workflow_versions WHERE id = 'AWFV-ENGINEERING-PLAN-V1';
ALTER TABLE agent_workflow_versions ENABLE TRIGGER agent_workflow_versions_immutable;
ALTER TABLE prompt_versions DISABLE TRIGGER prompt_versions_immutable;
DELETE FROM prompt_versions WHERE id = 'PROMPT-ENGINEERING-PLAN-V1';
ALTER TABLE prompt_versions ENABLE TRIGGER prompt_versions_immutable;
DROP TABLE engineering_plan_generations;
