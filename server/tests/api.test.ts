import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';

process.env.TEST_DB_PATH = ':memory:';

import { createApiApp } from '../app.ts';
import { closeDb, getDb } from '../core/database.ts';
import { setAIProviderForTests, type AIProvider } from '../services/aiService.ts';

let server: http.Server;
let baseUrl = '';

const mockTestAIProvider: AIProvider = {
  async analyzeXRay() {
    return {
      imageSuitability: 'suitable',
      identifiableViewOrRegion: 'Frontal Chest Radiograph',
      summaryPlainLanguage: 'Lung fields appear symmetrically expanded in this test radiograph.',
      visibleObservations: [
        {
          region: 'Lung Fields',
          observation: 'Clear bilateral lung parenchyma without obvious focal consolidation.',
          plainExplanation: 'The air spaces in both lungs look clear in this view.',
          attentionLevel: 'routine',
        },
      ],
      areasRequiringProfessionalReview: ['Confirm findings with a board-certified radiologist.'],
      cannotBeAssessedReliably: ['Microscopic tissue changes', 'Clinical symptoms'],
      technicalLimitations: ['Single 2D projection view only.'],
      uncertaintyNote: 'Educational interpretation only.',
      urgentFlag: false,
      urgentReason: '',
      safetyDisclaimer: 'Educational only; not a medical diagnosis.',
    };
  },
  async analyzeMRI() {
    return {
      imageSuitability: 'suitable',
      anatomicalRegion: 'Brain Sagittal Slice',
      sequenceAppearance: 'T1-weighted appearance',
      summaryPlainLanguage: 'Midline brain structures are visible on this single sagittal slice.',
      visibleStructures: [
        {
          structure: 'Corpus Callosum',
          observation: 'Well-defined midline contour.',
          plainExplanation: 'The fiber tract connecting both brain hemispheres is clearly outlined.',
        },
      ],
      possibleObservationsForReview: ['Full sequence review required by radiologist.'],
      singleSliceLimitationNote:
        'A single MRI slice does not represent a complete multi-sequence study.',
      cannotBeAssessedReliably: ['Adjacent slices not uploaded'],
      technicalLimitations: ['Single slice image only.'],
      urgentFlag: false,
      urgentReason: '',
      safetyDisclaimer: 'Educational only; not a medical diagnosis.',
    };
  },
  async analyzeBloodReport() {
    return {
      documentSuitability: 'suitable',
      overallSummary: 'Test CBC summary with one elevated marker.',
      tests: [
        {
          testName: 'Hemoglobin',
          measuredValue: '14.2',
          numericValue: 14.2,
          unit: 'g/dL',
          referenceRange: '13.5 - 17.5',
          refMin: 13.5,
          refMax: 17.5,
          status: 'Normal',
          simpleExplanation: 'Hemoglobin carries oxygen in red blood cells.',
          extractionConfidence: 'High',
        },
        {
          testName: 'Fasting Glucose',
          measuredValue: '112',
          numericValue: 112,
          unit: 'mg/dL',
          referenceRange: '70 - 99',
          refMin: 70,
          refMax: 99,
          status: 'High',
          simpleExplanation: 'Fasting blood sugar is slightly above the printed reference range.',
          extractionConfidence: 'High',
        },
      ],
      limitations: ['Values reflect a single point-in-time test.'],
      urgentFlag: false,
      urgentReason: '',
      safetyDisclaimer: 'Educational only; discuss results with a physician.',
    };
  },
  async generateChatReply({ reportContextText, userMessage }) {
    return `Educational response regarding (${reportContextText ? 'attached report' : 'general question'}): ${userMessage}`;
  },
};

before(async () => {
  getDb();
  setAIProviderForTests(mockTestAIProvider);
  const app = createApiApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr && typeof addr !== 'string') {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

after(() => {
  server?.close();
  closeDb();
});

test('Health and Readiness endpoints respond properly', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200);
  const readyBody = (await ready.json()) as { database: string };
  assert.equal(readyBody.database, 'connected');
});

test('Registration, login, forgot password, and new create password flow', async () => {
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'patient1@example.com',
      displayName: 'Alex Morgan',
      password: 'Password123',
      confirmPassword: 'Password123',
    }),
  });
  assert.equal(regRes.status, 201);
  const regData = (await regRes.json()) as { token: string; user: { id: string } };
  assert.ok(regData.token);

  // Login works
  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'patient1@example.com',
      password: 'Password123',
    }),
  });
  assert.equal(loginRes.status, 200);

  // Forgot password -> Reset (New Create Password)
  const forgotRes = await fetch(`${baseUrl}/api/v1/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient1@example.com' }),
  });
  assert.equal(forgotRes.status, 200);
  const forgotData = (await forgotRes.json()) as { verificationCode: string };
  assert.equal(forgotData.verificationCode.length, 6);

  const resetRes = await fetch(`${baseUrl}/api/v1/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'patient1@example.com',
      code: forgotData.verificationCode,
      newPassword: 'NewPassword456',
      confirmPassword: 'NewPassword456',
    }),
  });
  assert.equal(resetRes.status, 200);

  // Old password rejected, new password accepted
  const oldLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient1@example.com', password: 'Password123' }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'patient1@example.com', password: 'NewPassword456' }),
  });
  assert.equal(newLogin.status, 200);
});

test('Upload validation rejects spoofed file signature & enforces strict user isolation', async () => {
  // Register User A & User B
  const userARes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'usera@example.com',
      displayName: 'User A',
      password: 'Password123',
      confirmPassword: 'Password123',
    }),
  });
  const userA = (await userARes.json()) as { token: string };

  const userBRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'userb@example.com',
      displayName: 'User B',
      password: 'Password123',
      confirmPassword: 'Password123',
    }),
  });
  const userB = (await userBRes.json()) as { token: string };

  // Spoofed PNG upload (invalid magic bytes)
  const badForm = new FormData();
  badForm.append('category', 'xray');
  badForm.append('file', new Blob(['NOT_A_PNG_FILE'], { type: 'image/png' }), 'fake.png');
  const badUpload = await fetch(`${baseUrl}/api/v1/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userA.token}` },
    body: badForm,
  });
  assert.equal(badUpload.status, 400);

  // Valid PNG magic-byte upload for Blood Report
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
  const goodForm = new FormData();
  goodForm.append('category', 'blood');
  goodForm.append('file', new Blob([pngHeader], { type: 'image/png' }), 'lab_panel.png');
  const goodUpload = await fetch(`${baseUrl}/api/v1/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userA.token}` },
    body: goodForm,
  });
  assert.equal(goodUpload.status, 201);
  const uploadData = (await goodUpload.json()) as { fileId: string };

  // User B cannot access User A's file
  const crossFile = await fetch(`${baseUrl}/api/v1/uploads/${uploadData.fileId}`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  assert.equal(crossFile.status, 403);

  // Trigger Blood Analysis for User A
  const triggerRes = await fetch(`${baseUrl}/api/v1/analysis/blood`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ fileId: uploadData.fileId, title: 'Annual Blood Panel' }),
  });
  assert.equal(triggerRes.status, 202);
  const { analysisId, reportId } = (await triggerRes.json()) as {
    analysisId: string;
    reportId: string;
  };

  // Poll until completed
  let status = 'queued';
  for (let i = 0; i < 25; i++) {
    const statusRes = await fetch(`${baseUrl}/api/v1/analysis/${analysisId}/status`, {
      headers: { Authorization: `Bearer ${userA.token}` },
    });
    const statusBody = (await statusRes.json()) as { status: string };
    status = statusBody.status;
    if (status === 'completed' || status === 'failed') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(status, 'completed');

  // Verify User A gets structured blood markers
  const analysisRes = await fetch(`${baseUrl}/api/v1/analysis/${analysisId}`, {
    headers: { Authorization: `Bearer ${userA.token}` },
  });
  assert.equal(analysisRes.status, 200);
  const analysisBody = (await analysisRes.json()) as {
    bloodResults: Array<{ test_name: string; status: string }>;
  };
  assert.equal(analysisBody.bloodResults.length, 2);
  assert.equal(analysisBody.bloodResults[1].status, 'High');

  // Verify User B cannot read User A's analysis or create chat session on User A's report
  const crossAnalysis = await fetch(`${baseUrl}/api/v1/analysis/${analysisId}`, {
    headers: { Authorization: `Bearer ${userB.token}` },
  });
  assert.equal(crossAnalysis.status, 403);

  const crossChat = await fetch(`${baseUrl}/api/v1/chat/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userB.token}`,
    },
    body: JSON.stringify({ reportId }),
  });
  assert.equal(crossChat.status, 403);

  // User A creates chat session and asks a question
  const chatRes = await fetch(`${baseUrl}/api/v1/chat/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ reportId }),
  });
  assert.equal(chatRes.status, 201);
  const chatSession = (await chatRes.json()) as { id: string };

  const msgRes = await fetch(`${baseUrl}/api/v1/chat/sessions/${chatSession.id}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userA.token}`,
    },
    body: JSON.stringify({ message: 'What does Fasting Glucose mean?' }),
  });
  assert.equal(msgRes.status, 201);
  const msgBody = (await msgRes.json()) as { assistantMessage: { content: string } };
  assert.match(msgBody.assistantMessage.content, /attached report/);
});
