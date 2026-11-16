import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { after, before } from 'node:test';

process.env.TEST_DB_PATH = ':memory:';

import vercelHandler from '../../api/index.ts';
import { createApiApp } from '../app.ts';
import { config } from '../core/config.ts';
import { closeDb, ensureDbReady } from '../core/database.ts';
import { setAIProviderForTests, type AIProvider } from '../services/aiService.ts';

let server: http.Server;
let vercelServer: http.Server;
let baseUrl = '';
let vercelBaseUrl = '';

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
  await ensureDbReady();
  setAIProviderForTests(mockTestAIProvider);

  const app = createApiApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  if (addr && typeof addr !== 'string') {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }

  vercelServer = http.createServer((req, res) => {
    void vercelHandler(req, res);
  });
  vercelServer.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => vercelServer.once('listening', resolve));
  const vAddr = vercelServer.address();
  if (vAddr && typeof vAddr !== 'string') {
    vercelBaseUrl = `http://127.0.0.1:${vAddr.port}`;
  }
});

after(async () => {
  server?.close();
  vercelServer?.close();
  await closeDb();
  const privateDir = path.resolve(config.privateStorageDir);
  if (fs.existsSync(privateDir)) {
    fs.rmSync(privateDir, { recursive: true, force: true });
  }
});

test('Health and Readiness endpoints respond properly', async () => {
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200);
  const readyBody = (await ready.json()) as { database: string };
  assert.equal(readyBody.database, 'connected');
});

test('Removed authentication routes return 404 cleanly', async () => {
  const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'Password123' }),
  });
  assert.equal(regRes.status, 404);

  const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'Password123' }),
  });
  assert.equal(loginRes.status, 404);
});

test('Login-free upload validation, DB binary fallback, workspace isolation, analysis & chat', async () => {
  const workspaceA = 'workspace-alpha-1234';
  const workspaceB = 'workspace-beta-5678';

  // Spoofed PNG upload (invalid magic bytes)
  const badForm = new FormData();
  badForm.append('category', 'xray');
  badForm.append('file', new Blob(['NOT_A_PNG_FILE'], { type: 'image/png' }), 'fake.png');
  const badUpload = await fetch(`${baseUrl}/api/v1/uploads`, {
    method: 'POST',
    headers: { 'X-Workspace-Id': workspaceA },
    body: badForm,
  });
  assert.equal(badUpload.status, 400);

  // Valid PNG upload for Blood Report without login
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
  const goodForm = new FormData();
  goodForm.append('category', 'blood');
  goodForm.append('file', new Blob([pngHeader], { type: 'image/png' }), 'lab_panel.png');
  const goodUpload = await fetch(`${baseUrl}/api/v1/uploads`, {
    method: 'POST',
    headers: { 'X-Workspace-Id': workspaceA },
    body: goodForm,
  });
  assert.equal(goodUpload.status, 201);
  const uploadData = (await goodUpload.json()) as { fileId: string; signedPreviewUrl: string };

  // Simulate ephemeral serverless filesystem wipe: remove disk copy, verify DB file_data serves preview
  const workspaceDiskDir = path.join(config.privateStorageDir, workspaceA);
  if (fs.existsSync(workspaceDiskDir)) {
    fs.rmSync(workspaceDiskDir, { recursive: true, force: true });
  }
  const previewRes = await fetch(`${baseUrl}${uploadData.signedPreviewUrl}`);
  assert.equal(previewRes.status, 200);
  const previewBuf = Buffer.from(await previewRes.arrayBuffer());
  assert.deepEqual(previewBuf, pngHeader);

  // Workspace B cannot access Workspace A's file without signed token
  const crossFile = await fetch(`${baseUrl}/api/v1/uploads/${uploadData.fileId}`, {
    headers: { 'X-Workspace-Id': workspaceB },
  });
  assert.equal(crossFile.status, 403);

  // Trigger Blood Analysis for Workspace A (uses DB file_data fallback since disk copy was wiped)
  const triggerRes = await fetch(`${baseUrl}/api/v1/analysis/blood`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-Id': workspaceA,
    },
    body: JSON.stringify({ fileId: uploadData.fileId, title: 'Annual Blood Panel' }),
  });
  assert.equal(triggerRes.status, 202);
  const { analysisId, reportId } = (await triggerRes.json()) as {
    analysisId: string;
    reportId: string;
  };

  let status = 'queued';
  for (let i = 0; i < 25; i++) {
    const statusRes = await fetch(`${baseUrl}/api/v1/analysis/${analysisId}/status`, {
      headers: { 'X-Workspace-Id': workspaceA },
    });
    const statusBody = (await statusRes.json()) as { status: string };
    status = statusBody.status;
    if (status === 'completed' || status === 'failed') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(status, 'completed');

  const analysisRes = await fetch(`${baseUrl}/api/v1/analysis/${analysisId}`, {
    headers: { 'X-Workspace-Id': workspaceA },
  });
  assert.equal(analysisRes.status, 200);
  const analysisBody = (await analysisRes.json()) as {
    bloodResults: Array<{ test_name: string; status: string }>;
  };
  assert.equal(analysisBody.bloodResults.length, 2);
  assert.equal(analysisBody.bloodResults[1].status, 'High');

  // Dashboard summary & History endpoints without auth
  const dashRes = await fetch(`${baseUrl}/api/v1/dashboard/summary`, {
    headers: { 'X-Workspace-Id': workspaceA },
  });
  assert.equal(dashRes.status, 200);
  const dashBody = (await dashRes.json()) as { metrics: { totalReports: number; bloodCount: number } };
  assert.equal(dashBody.metrics.totalReports, 1);
  assert.equal(dashBody.metrics.bloodCount, 1);

  const histRes = await fetch(`${baseUrl}/api/v1/history?type=blood`, {
    headers: { 'X-Workspace-Id': workspaceA },
  });
  assert.equal(histRes.status, 200);
  const histBody = (await histRes.json()) as { items: Array<{ reportId: string }> };
  assert.equal(histBody.items.length, 1);
  assert.equal(histBody.items[0].reportId, reportId);

  // Verify Workspace B isolation
  const crossAnalysis = await fetch(`${baseUrl}/api/v1/analysis/${analysisId}`, {
    headers: { 'X-Workspace-Id': workspaceB },
  });
  assert.equal(crossAnalysis.status, 403);

  const crossChat = await fetch(`${baseUrl}/api/v1/chat/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-Id': workspaceB,
    },
    body: JSON.stringify({ reportId }),
  });
  assert.equal(crossChat.status, 403);

  // Chat works directly without auth
  const chatRes = await fetch(`${baseUrl}/api/v1/chat/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-Id': workspaceA,
    },
    body: JSON.stringify({ reportId }),
  });
  assert.equal(chatRes.status, 201);
  const chatSession = (await chatRes.json()) as { id: string };

  const msgRes = await fetch(`${baseUrl}/api/v1/chat/sessions/${chatSession.id}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Workspace-Id': workspaceA,
    },
    body: JSON.stringify({ message: 'What does Fasting Glucose mean?' }),
  });
  assert.equal(msgRes.status, 201);
  const msgBody = (await msgRes.json()) as { assistantMessage: { content: string } };
  assert.match(msgBody.assistantMessage.content, /attached report/);
});

test('Vercel serverless entrypoint handles rewritten API paths without authentication', async () => {
  const healthRes = await fetch(`${vercelBaseUrl}/api/index?__vercel_path=/health`);
  assert.equal(healthRes.status, 200);
  const healthJson = (await healthRes.json()) as { status: string };
  assert.equal(healthJson.status, 'ok');

  const readyRes = await fetch(`${vercelBaseUrl}/api/index?__vercel_path=/ready`);
  assert.equal(readyRes.status, 200);
  const readyJson = (await readyRes.json()) as { database: string };
  assert.equal(readyJson.database, 'connected');

  const dashRes = await fetch(`${vercelBaseUrl}/api/index?__vercel_path=/api/v1/dashboard/summary`);
  assert.equal(dashRes.status, 200);
  const dashBody = (await dashRes.json()) as { metrics: { totalReports: number } };
  assert.equal(typeof dashBody.metrics.totalReports, 'number');

  const historyRes = await fetch(`${vercelBaseUrl}/api/index?__vercel_path=/api/v1/history&type=blood`);
  assert.equal(historyRes.status, 200);
  const historyBody = (await historyRes.json()) as { items: unknown[] };
  assert.ok(Array.isArray(historyBody.items));

  const authGone = await fetch(`${vercelBaseUrl}/api/index?__vercel_path=/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'pw' }),
  });
  assert.equal(authGone.status, 404);
});
