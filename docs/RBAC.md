# Role / Permission Matrix

## Design

Roles and their permission ceilings are a **static code matrix** (`packages/shared/src/rbac.ts`), not admin-editable database tables. L1 does not need dynamic permission editing — every role's capabilities are reviewed in code and covered by `apps/api/test/unit/rbac.test.ts`. Promoting this to DB-backed, admin-editable roles/permissions is a recommended L2 improvement (the spec's `Role`/`Permission` data-model entries map to this file instead of a table — see `docs/ARCHITECTURE.md`).

A user's *actual* access is the intersection of two things:
1. **Role permission ceiling** — can this role ever perform this kind of action at all (`hasPermission(role, permission)`).
2. **Scope** — even with the right role, is this user allowed to act on *this particular* site/event (`UserSiteAccess` / `EventAssignment` rows).

## Permission ceiling by role

| Permission | Master Admin | Marketing Head | Event Manager | Photographer | Support Executive |
|---|:-:|:-:|:-:|:-:|:-:|
| `site:manage` | ✅ | | | | |
| `site:view` | ✅ | ✅ | | | |
| `user:manage` | ✅ | | | | |
| `event:create` | ✅ | ✅ | | | |
| `event:edit` | ✅ | ✅ | ✅ | | |
| `event:view` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `event:close` | ✅ | ✅ | ✅ | | |
| `event:delete` | ✅ | | | | |
| `event:manage_qr` | ✅ | ✅ | ✅ | | |
| `event:manage_assignments` | ✅ | ✅ | | | |
| `event:manage_threshold` | ✅ | | | | |
| `photo:upload` | ✅ | | ✅ | ✅ | |
| `photo:view` | ✅ | ✅ | ✅ | ✅ | |
| `photo:delete` | ✅ | | ✅ | | |
| `consent:manage` | ✅ | | | | |
| `retention:manage` | ✅ | | | | |
| `audit:view` | ✅ | | | | |
| `settings:manage` | ✅ | | | | |
| `report:view` | ✅ | ✅ | ✅ | | ✅ |
| `report:resolve` | ✅ | | ✅ | | ✅ |
| `analytics:view` | ✅ | ✅ | ✅ | | |

Note: `event:manage_threshold` (changing the face-match confidence threshold) is deliberately **never** granted to Support Executive — matches the spec's explicit "cannot change face-match thresholds" requirement — and Support Executive has no `photo:view`/`photo:upload` at all, matching "cannot browse the complete photograph library unless explicitly authorised."

## Scoping rules

| Role | Scoped by | Enforced by |
|---|---|---|
| Master Admin | Nothing — full access | `requireSiteAccess`/`requireEventAssignment` short-circuit for this role |
| Marketing Head | `UserSiteAccess` rows (which sites they can see) | `requireSiteAccess`; event visibility is derived from the site (`scopedEventWhere`) |
| Event Manager | `EventAssignment` rows (which specific events) | `requireEventAssignment` |
| Photographer | `EventAssignment` rows (which specific events) | `requireEventAssignment` |
| Support Executive | Not scoped — sees reports/events across the board for context, but has no `photo:*` permission at all so can never browse the photo library regardless | `requirePermission` alone (no site/event scoping middleware applied) |

Backend middleware: `apps/api/src/middleware/rbac.ts`. A request must pass **both** `requirePermission(...)` and, where applicable, `requireSiteAccess(...)`/`requireEventAssignment(...)` — failing either returns `403 FORBIDDEN`. Tested explicitly in `apps/api/test/integration/auth.test.ts` and `events.test.ts` ("denies a MARKETING_HEAD from creating an event at a site they have no access to", "denies a PHOTOGRAPHER access to an event they are not assigned to").

## Frontend

The sidebar (`apps/web/src/layout/Sidebar.tsx`) filters nav items through the same `hasPermission()` function from `@neoteric-memories/shared` — the exact same matrix used server-side, so the UI can never show a link the backend would reject. This is a UX convenience only; every route is independently protected server-side regardless of what the UI shows.

## Guest "role"

Guests are unauthenticated and have no role at all — their access boundary is entirely different (event-scoped access token + session-cookie-must-match-URL, see `apps/api/src/middleware/guestAuth.ts`), not a point on this matrix.
