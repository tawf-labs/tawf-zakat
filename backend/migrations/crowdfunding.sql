-- Explicitly applied by bun run crowdfunding:migrate; never run at API startup.
CREATE TABLE IF NOT EXISTS crowdfunding_state (
  id integer PRIMARY KEY CHECK (id = 1),
  state jsonb NOT NULL
);
INSERT INTO crowdfunding_state (id, state)
VALUES (1, '{"users":{},"sessions":{},"campaigns":{},"payments":{},"outbox":{},"attempts":{}}'::jsonb)
ON CONFLICT (id) DO NOTHING;
