INSERT INTO "model_definitions" (
	"id", "provider_id", "immutable_model_id", "display_name", "lifecycle_status", "execution_status",
	"capabilities", "context_window_tokens", "max_output_tokens", "pricing", "data_policy_status",
	"allowed_regions", "evaluation_status", "evaluation_scores"
) VALUES
	('MODEL-OPENAI-GPT-5-6-LUNA', 'MPROV-OPENAI', 'gpt-5.6-luna', 'OpenAI GPT-5.6 Luna candidate', 'CANDIDATE', 'DISABLED', '{"structuredOutput":true,"tools":false,"vision":false}'::jsonb, NULL, NULL, '{"status":"UNVERIFIED"}'::jsonb, 'REQUIRES_REVIEW', ARRAY[]::text[], 'NOT_EVALUATED', '{}'::jsonb),
	('MODEL-OPENAI-GPT-5-6-TERRA', 'MPROV-OPENAI', 'gpt-5.6-terra', 'OpenAI GPT-5.6 Terra candidate', 'CANDIDATE', 'DISABLED', '{"structuredOutput":true,"tools":false,"vision":false}'::jsonb, NULL, NULL, '{"status":"UNVERIFIED"}'::jsonb, 'REQUIRES_REVIEW', ARRAY[]::text[], 'NOT_EVALUATED', '{}'::jsonb),
	('MODEL-OPENAI-GPT-5-6-SOL', 'MPROV-OPENAI', 'gpt-5.6-sol', 'OpenAI GPT-5.6 Sol candidate', 'CANDIDATE', 'DISABLED', '{"structuredOutput":true,"tools":false,"vision":false}'::jsonb, NULL, NULL, '{"status":"UNVERIFIED"}'::jsonb, 'REQUIRES_REVIEW', ARRAY[]::text[], 'NOT_EVALUATED', '{}'::jsonb),
	('MODEL-GROQ-GPT-OSS-20B', 'MPROV-GROQ', 'openai/gpt-oss-20b', 'Groq GPT-OSS 20B candidate', 'CANDIDATE', 'DISABLED', '{"structuredOutput":true,"tools":false,"vision":false}'::jsonb, NULL, NULL, '{"status":"UNVERIFIED"}'::jsonb, 'REQUIRES_REVIEW', ARRAY[]::text[], 'NOT_EVALUATED', '{}'::jsonb),
	('MODEL-GROQ-GPT-OSS-120B', 'MPROV-GROQ', 'openai/gpt-oss-120b', 'Groq GPT-OSS 120B candidate', 'CANDIDATE', 'DISABLED', '{"structuredOutput":true,"tools":false,"vision":false}'::jsonb, NULL, NULL, '{"status":"UNVERIFIED"}'::jsonb, 'REQUIRES_REVIEW', ARRAY[]::text[], 'NOT_EVALUATED', '{}'::jsonb);
