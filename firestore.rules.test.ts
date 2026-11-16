import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';

/**
 * Security Rules Structural Verification Test Suite
 * Verifies that firestore.rules enforces all 8 pillars and blocks Dirty Dozen attack vectors.
 */
const rules = fs.readFileSync('firestore.rules', 'utf8');

test('Dirty Dozen & Eight Pillars structural verification', () => {
  // 1. Default deny catch-all
  assert.match(rules, /match \/{document=\*\*}\s*\{\s*allow read, write: if false;/);

  // 2. Email verification enforcement
  assert.match(rules, /request\.auth\.token\.email_verified == true/);

  // 3. ID poisoning regex guard
  assert.match(rules, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);

  // 4. Server timestamp temporal integrity
  assert.match(rules, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rules, /incoming\(\)\.updatedAt == request\.time/);

  // 5. No blanket list queries without resource.data owner check
  assert.doesNotMatch(rules, /allow list:\s*if\s*isSignedIn\(\)\s*;/);
  assert.match(rules, /resource\.data\.userId == request\.auth\.uid/);

  // 6. Strict key allowlisting & affectedKeys updates
  assert.match(rules, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(/);

  // 7. Parent existence check on subcollection messages
  assert.match(rules, /exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(userId\)\/chatSessions\/\$\(sessionId\)\)/);

  // 8. Terminal state locking on completed reports
  assert.match(rules, /existing\(\)\.status != 'completed'/);
});
