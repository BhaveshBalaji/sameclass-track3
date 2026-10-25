CREATE TABLE ray_app.planning_rooms (
    namespace text NOT NULL,
    room_id text NOT NULL,
    state jsonb,
    PRIMARY KEY(namespace, room_id)
);
CREATE TABLE ray_app.planning_events (
    namespace text NOT NULL,
    event_id text NOT NULL,
    room_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(namespace,event_id),
    FOREIGN KEY(namespace,room_id) REFERENCES ray_app.planning_rooms ON DELETE CASCADE
);
CREATE TABLE ray_app.planning_outbox (
    id uuid PRIMARY KEY,
    namespace text NOT NULL,
    room_id text NOT NULL,
    session_id text,
    snapshot_version bigint,
    body jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','uncertain','cancelled')),
    deliveries jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(namespace,room_id) REFERENCES ray_app.planning_rooms ON DELETE CASCADE
);
CREATE INDEX planning_outbox_pending ON ray_app.planning_outbox(namespace, created_at) WHERE status='pending';
