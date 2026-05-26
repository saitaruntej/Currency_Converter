# Security Specification & Threat Model (TDD Spec)

## Data Invariants
1. **User Profiling Isolation**: Public profile fields (e.g., username, base currency) MUST reside in `/users/{userId}/public/profile` separate from sensitive PII details in `/users/{userId}/private/info` (PII Isolation).
2. **Favorite Pair Containment**: A user MUST NOT save a favorite pair for any other user's UID (Identity Spoofing Block).
3. **Trigger Alert Containment**: A rate alert MUST be created and configured with `userId == request.auth.uid`. A user cannot mutate another user's alert limits.
4. **Action-Locked Alerts**: Alert updates are constrained to specific pathways: (a) `isActive` status toggling, or (b) systemic triggering updates (`isTriggered`, `isActive`, `triggeredAt`, `triggeredRate` modifications).
5. **Strict ID Matching**: Document ID paths MUST pass pattern matching validation checks to prevent resource ID injection attacks (ID poisoning guard).

---

## The "Dirty Dozen" Threat Payloads

### 1. Identity Spoof Profile Modification
*   **Attempt**: User `u_abc` attempts to create public profile for `u_xyz`.
*   **Target Path**: `/users/u_xyz/public/profile`
*   **Result**: `PERMISSION_DENIED`

### 2. PII Exposure Leak
*   **Attempt**: Anonymous non-logged user attempts to read private info of user `u_abc`.
*   **Target Path**: `/users/u_abc/private/info`
*   **Result**: `PERMISSION_DENIED`

### 3. PII Arbitrary Reader Leak
*   **Attempt**: Logged-in user `u_xyz` tries to read `u_abc`'s billing settings (private info).
*   **Target Path**: `/users/u_abc/private/info`
*   **Result**: `PERMISSION_DENIED`

### 4. Favorite Spoofing Attack
*   **Attempt**: User `u_abc` tries to write favorite pair on behalf of user `u_xyz`.
*   **Target Path**: `/favorites/fav_999` with payload `{ "userId": "u_xyz", "fromCode": "USD", "toCode": "EUR" }`
*   **Result**: `PERMISSION_DENIED`

### 5. ID Poison Injection
*   **Attempt**: Attacker passes deep nested or huge string as favorite document ID containing SQL/HTML exploits.
*   **Target Path**: `/favorites/Exploiting_Path_With_Slashes_Or_Giant_Size_Characters_To_Poison_The_Datastore`
*   **Result**: `PERMISSION_DENIED`

### 6. Shadow State Escalation (User Role Inject)
*   **Attempt**: User attempts to update public profile by inserting unauthorized RBAC admin flags.
*   **Target Path**: `/users/u_abc/public/profile` with payload `{ "username": "Sam", "preferredBase": "USD", "isAdmin": true }`
*   **Result**: `PERMISSION_DENIED`

### 7. Favorite Blanket Unfiltered Query Scraping
*   **Attempt**: User tries to fetch all saved favorite items across the database without qualifying query clauses matching their specific `userId`.
*   **Target Path**: `/favorites` (Collection list query without Filter)
*   **Result**: `PERMISSION_DENIED`

### 8. System Status Lockout Bypass
*   **Attempt**: User tries to change `fromCode` or `targetRate` of a triggered active Alert instead of creating a clean one.
*   **Target Path**: `/alerts/alrt_123` with payload modifying base parameters on update.
*   **Result**: `PERMISSION_DENIED`

### 9. Alert Blind Escalation
*   **Attempt**: User updates both `isActive`, `fromCode`, and `targetRate` simultaneously, violating action boundaries.
*   **Target Path**: `/alerts/alrt_123` with multi-path dirty updates.
*   **Result**: `PERMISSION_DENIED`

### 10. Temporal Injection
*   **Attempt**: User passes client-controlled future or past dates inside state tracking properties to bypass alert loops.
*   **Target Path**: `/alerts/alrt_123` with invalid creation or trigger timestamps.
*   **Result**: `PERMISSION_DENIED`

### 11. Malicious Numeric Code Injection
*   **Attempt**: User inputs huge number, infinity, or string-based target rate coefficient in hopes of triggering SQL logic errors.
*   **Target Path**: `/alerts/alrt_123` with `{ "targetRate": -9999.5 }` or non-numeric types.
*   **Result**: `PERMISSION_DENIED`

### 12. Non-existent ID Spoofing
*   **Attempt**: Unauthenticated visitor deletes a currency favorite.
*   **Target Path**: `/favorites/any_fav`
*   **Result**: `PERMISSION_DENIED`

---

## Test Runner Architecture Template

```typescript
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";

// Standard Firestore Secure Test Suite matching each threat pattern
describe("Currency App Firestore Rules Assertions", () => {
  let testEnv;

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: "solar-reef-rsjh2",
      firestore: {
        rules: fs.readFileSync("firestore.rules", "utf8")
      }
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it("should prevent unauthorized read/write attempts to profile of other users", async () => {
    const maliciousAlice = testEnv.authenticatedContext("alice");
    const docRef = maliciousAlice.firestore().doc("users/bob/private/info");
    await assertFails(docRef.get());
  });
});
```
