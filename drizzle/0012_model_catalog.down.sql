DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM model_policies) THEN
		RAISE EXCEPTION 'Cannot roll back model catalog after organization policies exist';
	END IF;
	IF EXISTS (
		SELECT 1 FROM model_definitions
		WHERE id <> 'MODEL-AXIOM-STRUCTURED-FIXTURE-V1'
	) OR EXISTS (
		SELECT 1 FROM model_providers
		WHERE id NOT IN ('MPROV-LOCAL-FIXTURE', 'MPROV-OPENAI', 'MPROV-GROQ')
	) THEN
		RAISE EXCEPTION 'Cannot roll back model catalog after additional providers or models exist';
	END IF;
END;
$$;

DROP TABLE "model_policies";
DROP TABLE "model_definitions";
DROP TABLE "model_providers";
