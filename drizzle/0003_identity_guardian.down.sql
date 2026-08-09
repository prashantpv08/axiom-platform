DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
DROP FUNCTION IF EXISTS axiom_prevent_audit_event_mutation();
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
