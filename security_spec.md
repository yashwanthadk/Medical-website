# MediExplain AI Security Specification

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document under `/users/{userId}` and its subcollections (`reports`, `chatSessions`, `messages`) is readable and writable exclusively by the authenticated user whose `request.auth.uid == userId` and `request.auth.token.email_verified == true`.
2. **Identity Integrity**: Every document's `userId` / `uid` field must match `request.auth.uid` on creation and remain immutable on update.
3. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time` on creation, and `createdAt` must remain immutable on update while `updatedAt == request.time`.
4. **Schema & Volumetric Bounds**: All string fields enforce explicit `size()` limits; all document IDs match `^[a-zA-Z0-9_\-]+$` with length `<= 128`.
5. **No Shadow Fields**: Both `create` (`hasAll` + `hasOnly`) and `update` (`affectedKeys().hasOnly(...)`) prohibit unexpected fields.
6. **Parent Existence & Ownership**: Messages inside `/users/{userId}/chatSessions/{sessionId}/messages/{messageId}` require `exists` / `get` verification that the parent `chatSessions/{sessionId}` document exists and belongs to `userId`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Profile Read**: Anonymous client attempts `get /users/userA`. Expected: `PERMISSION_DENIED`.
2. **Cross-Tenant Report Read**: Authenticated `userB` attempts `get /users/userA/reports/rep1`. Expected: `PERMISSION_DENIED`.
3. **Cross-Tenant Report List**: Authenticated `userB` attempts `list /users/userA/reports`. Expected: `PERMISSION_DENIED`.
4. **UID Spoofing on Create**: `userB` creates `/users/userB/reports/rep1` with `{ userId: "userA", ... }`. Expected: `PERMISSION_DENIED`.
5. **Shadow Field Injection**: `userA` creates `/users/userA` with `{ ..., isAdmin: true }`. Expected: `PERMISSION_DENIED`.
6. **Immutable Field Mutation**: `userA` updates `/users/userA/reports/rep1` attempting to modify `createdAt` or `userId`. Expected: `PERMISSION_DENIED`.
7. **Timestamp Forgery**: `userA` creates `/users/userA/reports/rep1` with a backdated client timestamp instead of `request.time`. Expected: `PERMISSION_DENIED`.
8. **ID Poisoning**: `userA` creates `/users/userA/reports/invalid$id..` or 300-char ID. Expected: `PERMISSION_DENIED`.
9. **Resource Exhaustion (Oversized Summary)**: `userA` writes a `summary` string > 10,000 chars. Expected: `PERMISSION_DENIED`.
10. **Invalid Enum Status**: `userA` creates a report with `reportType: "prescription"`. Expected: `PERMISSION_DENIED`.
11. **Orphaned Chat Message**: `userA` writes a message under non-existent `/users/userA/chatSessions/missing/messages/m1`. Expected: `PERMISSION_DENIED`.
12. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create a report. Expected: `PERMISSION_DENIED`.
