CREATE TABLE ray_app.research_context (
    namespace text NOT NULL,
    room_id text NOT NULL,
    user_id text NOT NULL,
    turns jsonb NOT NULL DEFAULT '[]',
    version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY(namespace,room_id,user_id)
);
CREATE TABLE ray_app.research_replies (
    namespace text NOT NULL,
    room_id text NOT NULL,
    message_id text NOT NULL,
    turn jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(namespace,room_id,message_id)
);
CREATE INDEX research_replies_recent ON ray_app.research_replies(namespace,room_id,created_at);
