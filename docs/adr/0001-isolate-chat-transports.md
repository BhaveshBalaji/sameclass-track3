---
status: accepted
---

# Isolate chat transports from the planning core

The team wants to experiment in Discord first and optionally add an owned chat UI with minimal changes. Use application-owned message, identity, clarification, and structured-response contracts, with Discord SDK objects and presentation kept in an adapter; this adds a small normalization and identity-mapping boundary now, in exchange for reusing preference state, research, and matching across chat surfaces. Account linking and cross-platform room synchronization remain separate product decisions rather than implied consequences of sharing the backend.

The team accepted the recommended direction on October 24, 2026. The optional first web UI will use independent rooms; Discord synchronization is deferred.
