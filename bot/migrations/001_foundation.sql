-- Milestone 0 foundation only. Session/profile domain tables arrive in Milestone 1.
CREATE TABLE ray_app.runtime_metadata (
    name text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
