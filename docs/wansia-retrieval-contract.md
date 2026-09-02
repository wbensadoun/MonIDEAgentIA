# Wansia retrieval interop — v1

Code Companion exposes an optional main-process capability for a future
authenticated Wansia transport. It is deliberately disabled unless both a
trusted identity resolver and a transport are injected. The default desktop
build therefore returns `WANSIA_RETRIEVAL_UNAVAILABLE`; it does not simulate a
Wansia connection.

## Boundary

The renderer may send only `protocolVersion`, `requestId`, `query`, `topK`,
`sourceIds` and `includeConversations`. `subjectId`, `tenantType`,
`workspaceId` and `scope` are rejected. The main process resolves the user
identity and passes an immutable `{ tenantType: "user", subjectId }` to the
transport. A response with a missing or different scope is rejected before it
reaches the renderer.

## Version negotiation

`wansia:retrieval:negotiate` selects the highest common integer version from
the peer list. No common version is an error. Queries also repeat the selected
version, so an accidentally stale client cannot fall through to another
protocol.

## Evidence contract

Responses contain scoped passages and server-verified Wansia citations. A
citation must carry a stable 32-hex identifier, UUID `sourceId`, SHA-256
`sourceHash` and `quoteHash`, bounded offsets, and a bounded quote. Citations
whose source is not among the returned passages are rejected. Code Companion
does not turn lexical fingerprints or model-generated labels into semantic
evidence.

IPC channels:

- `wansia:retrieval:metadata`
- `wansia:retrieval:negotiate`
- `wansia:retrieval:query`

The current registration is a capability contract and fail-closed adapter;
real API/auth wiring remains a separate deployment task requiring a trusted
Wansia endpoint and authenticated user resolver.
