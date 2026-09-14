# Role / Permission Matrix

## Design

Permissions are **per-user and admin-editable** (`User.permissions` in `apps/api/prisma/schema.prisma`), managed via a toggle matrix in the admin Users page (`apps/web/src/components/PermissionMatrix.tsx`). `Role` is still a fixed 5-value enum, but a role is no longer itself a permission ceiling — it now only drives site/event **scoping** (see below) and is used as a one-time convenience default (`ROLE_PERMISSIONS` in `packages/shared/src/rbac.ts`, exposed via the matrix UI's "Load role defaults" button) when a new user is first created. The live enforcement check is `hasUserPermission(user, permission)`, not `hasPermission(role, permission)` — see `apps/api/test/unit/rbac.test.ts`.

**MASTER_ADMIN always bypasses** regardless of what's actually stored in its `permissions` array — this is a deliberate exception so this role can never be self-locked-out by an incomplete permissions array (e.g. accidentally editing your own account and removing `user:manage`).

A user's *actual* access is the intersection of two things:
1. **Their own stored permissions** — can this specific user ever perform this kind of action at all (`hasUserPermission(user, permission)`).
2. **Scope** — even with the right permission, is this user allowed to act on *this particular* site/event (`UserSiteAccess` / `EventAssignment` rows, still keyed off `role`).

## The 22 permissions and their reference role defaults

`ROLE_PERMISSIONS` below is no longer live-enforced — it's the starting-point data offered by the "Load role defaults" button when creating/editing a user, and what existing users were backfilled to (`apps/api/scripts/backfillUserPermissions.ts`) the moment this feature shipped, so nobody's access silently changed on deploy.

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

These defaults are just a convenience — an admin can grant or remove any permission for any specific user regardless of role, via the matrix UI.

## Scoping rules

| Role | Scoped by | Enforced by |
|---|---|---|
| Master Admin | Nothing — full access | `requireSiteAccess`/`requireEventAssignment` short-circuit for this role |
| Marketing Head | `UserSiteAccess` rows (which sites they can see) | `requireSiteAccess`; event visibility is derived from the site (`scopedEventWhere`) |
| Event Manager | `EventAssignment` rows (which specific events) | `requireEventAssignment` |
| Photographer | `EventAssignment` rows (which specific events) | `requireEventAssignment` |
| Support Executive | Not scoped — sees reports/events across the board for context, but has no `photo:*` permission at all so can never browse the photo library regardless | `requirePermission` alone (no site/event scoping middleware applied) |

Backend middleware: `apps/api/src/middleware/rbac.ts`. A request must pass **both** `requirePermission(...)` (now backed by `hasUserPermission`) and, where applicable, `requireSiteAccess(...)`/`requireEventAssignment(...)` — failing either returns `403 FORBIDDEN`. Tested explicitly in `apps/api/test/integration/auth.test.ts` ("denies a MARKETING_HEAD from creating an event at a site they have no access to", "denies a PHOTOGRAPHER access to an event they are not assigned to", and the "Per-user permission overrides" block proving a user's stored permissions — not their role — decide access).

## Frontend

The sidebar (`apps/web/src/layout/Sidebar.tsx`) filters nav items through `hasUserPermission()` from `@neoteric-memories/shared` — the exact same check used server-side, so the UI can never show a link the backend would reject. This is a UX convenience only; every route is independently protected server-side regardless of what the UI shows.

The Users admin page (`apps/web/src/pages/admin/UsersPage.tsx`) is where permissions are actually managed: creating or editing a user shows a `PermissionMatrix` (grouped by module, with a per-module bulk toggle and a search box) that starts at zero authorizations for a new user regardless of the selected role — the role only pre-fills the matrix if the admin explicitly clicks "Load role defaults".

## Password policy

Passwords have **no minimum length** — any non-empty string is accepted (`packages/shared/src/schemas/user.ts`/`auth.ts`), by design. A 200-character cap exists purely as a sanity/DoS guard on the bcrypt input, not a complexity rule. Users can change their own password via the header menu ("Change password" → `POST /api/admin/auth/change-password`), which also revokes every other active session for that account. An admin can also set a new password for someone else via the Users edit drawer (`PATCH /api/admin/users/:id`'s optional `password` field).

## Guest "role"

Guests are unauthenticated and have no role at all — their access boundary is entirely different (event-scoped access token + session-cookie-must-match-URL, see `apps/api/src/middleware/guestAuth.ts`), not a point on this matrix.
