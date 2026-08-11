# ADR 0001: Provider-neutral core

## Status
Accepted for C00 freeze.

## Decision
Domain, policy, storage, and orchestration contracts contain no host-specific semantics. Thin adapters consume the SDK and adapter SPI. Adapters cannot import storage/orchestrator internals, schedule work, decide admission, or write installation state.

## Consequences
Every required host implements a native contribution and conformance suite while canonical truth remains replayable without that host.
