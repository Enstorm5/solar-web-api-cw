# 06 – Security

*PLAN.md §12*

Every request faces two separate questions:

1. **May this caller do this kind of operation?** Answered by the token's **scope** (a capability).
2. **May they see this data?** Answered by their **area**, read from the database (an attribute check).

A scope alone cannot express "which data": one `analyst-read-district` scope covers all 25 district analysts. Scopes gate operations; database attributes gate data. This is the ABAC idea from G §12.3, without a full XACML service.

## Who may do what

| Caller (`principal` claim) | Scope | Allowed | Denied |
|---|---|---|---|
| Installation device (`device`) | `installation-write` | POST readings to **its own** installation | All reads, other installations (403), editing anything |
| National analyst (`user`) | `analyst-read-national` | Read everything | All writes |
| Provincial analyst (`user`) | `analyst-read-province` | Read own province and below | Other provinces (404), all writes |
| District analyst (`user`) | `analyst-read-district` | Read own district and below | Other districts (404), all writes |
| Provisioning service (`service`) | `installation-manage` | Create, replace and delete installation metadata; read installations | Readings, history, analytics |

The provisioning service resolves Q1. The brief asks for CRUD, but forbids devices and analysts from writing anything except a device's own readings. A separate service that edits only installation details provides CRUD without breaking that split. It is not a seventh entity, and no national analyst gets admin rights silently. As built, it is token-only, with no database row.

## Tokens

- **Format:** signed JWT (ES256, asymmetric) with `iss`, `aud`, `sub`, `iat`, `exp`, `principal` and `scope`.
  - Device: `sub` = installation UUID.
  - Analyst: `sub` = `users.subject` (e.g. `analyst-cmb`).
- **Checks:** signature with the algorithm pinned, issuer, audience, expiry and claim types. The token is never just decoded. `alg: none` and HMAC key-confusion tokens are rejected, as is a user token pretending to be a device.
- **Live state wins:** role, area and active status are re-read from the database on every request. A revoked user loses access even with an unexpired token, and the effective permission is the token scope ∩ the current database record.
- **Never trusted from the request:** a role or installation sent in a body or query string.

### Token lifecycle

- An offline command-line tool (`npm run token`) creates the key pair and issues tokens. The deployed API holds **only the public key**, so a leak of the server's configuration cannot be used to mint tokens.
- The private key and issued tokens never go into Git, Swagger examples, the README or prompt logs (they live in `.secrets/`, which is git-ignored).
- There is no public token endpoint and no never-expiring token.
- The examiner gets scoped tokens through the private submission channel, with a lifetime that covers marking and a way to renew them.

## Less obvious leaks (plan §12.3)

- The area filter is applied **inside SQL, before** rows are selected, counted, grouped or summed. The API never loads national data and filters it afterwards.
- Counts, paging links, overviews, the latest reading, summaries and even **304 responses** are all scoped.
- A caller may see their own province's or district's metadata, but never sibling assets or their counts.
- Out-of-area items return **404, not 403**, so a response never confirms that a foreign item exists.
- CORS is not treated as security. Swagger is same-origin, so no broad CORS policy is needed.

## Defence in depth (as built)

- HTTPS only: plain HTTP is redirected with 308; HSTS max-age is two years.
- Headers: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Referrer-Policy: no-referrer`.
- The database role cannot modify readings, and a trigger blocks changes even from the owner.

## Tests the plan requires

Bad signature, wrong algorithm, expired token, wrong issuer or audience; wrong principal; revoked user; cross-area ids, counts, paging links, summaries, composites, latest reading, 304s and conflicting filters.
