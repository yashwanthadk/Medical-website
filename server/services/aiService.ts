import { GoogleGenAI, Type, type GenerateContentResponse } from '@google/genai';
import { config } from '../core/config.ts';

export interface XRayAnalysisOutput {
  imageSuitability: 'suitable' | 'unsuitable_or_unclear';
  identifiableViewOrRegion: string;
  summaryPlainLanguage: string;
  visibleObservations: Array<{
    region: string;
    observation: string;
    plainExplanation: string;
    attentionLevel: 'routine' | 'review_recommended' | 'urgent_review';
  }>;
  areasRequiringProfessionalReview: string[];
  cannotBeAssessedReliably: string[];
  technicalLimitations: string[];
  uncertaintyNote: string;
  urgentFlag: boolean;
  urgentReason: string;
  safetyDisclaimer: string;
}

export interface MRIAnalysisOutput {
  imageSuitability: 'suitable' | 'unsuitable_or_unclear';
  anatomicalRegion: string;
  sequenceAppearance: string;
  summaryPlainLanguage: string;
  visibleStructures: Array<{
    structure: string;
    observation: string;
    plainExplanation: string;
  }>;
  possibleObservationsForReview: string[];
  singleSliceLimitationNote: string;
  cannotBeAssessedReliably: string[];
  technicalLimitations: string[];
  urgentFlag: boolean;
  urgentReason: string;
  safetyDisclaimer: string;
}

export interface BloodMarkerItem {
  testName: string;
  measuredValue: string;
  numericValue: number | null;
  unit: string;
  referenceRange: string;
  refMin: number | null;
  refMax: number | null;
  status: 'Normal' | 'High' | 'Low' | 'Unknown';
  simpleExplanation: string;
  extractionConfidence: 'High' | 'Medium' | 'Low';
}

export interface BloodReportAnalysisOutput {
  documentSuitability: 'suitable' | 'unsuitable_or_unclear';
  overallSummary: string;
  tests: BloodMarkerItem[];
  limitations: string[];
  urgentFlag: boolean;
  urgentReason: string;
  safetyDisclaimer: string;
}

export interface ChatReplyInput {
  reportContextText: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
}

export interface AIProvider {
  analyzeXRay(params: {
    buffer: Buffer;
    mimeType: string;
    clinicalNotes?: string;
  }): Promise<XRayAnalysisOutput>;
  analyzeMRI(params: {
    buffer: Buffer;
    mimeType: string;
    clinicalNotes?: string;
  }): Promise<MRIAnalysisOutput>;
  analyzeBloodReport(params: {
    buffer: Buffer;
    mimeType: string;
    extractedText: string;
    clinicalNotes?: string;
  }): Promise<BloodReportAnalysisOutput>;
  generateChatReply(input: ChatReplyInput): Promise<string>;
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || config.geminiApiKey;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'AI analysis service is not configured. Missing GEMINI_API_KEY on the server.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseJsonResponse<T>(response: GenerateContentResponse, contextLabel: string): T {
  const raw = (response.text ?? '').trim();
  if (!raw) {
    throw new Error(`AI model returned an empty response during ${contextLabel}.`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`AI model returned invalid structured JSON during ${contextLabel}.`);
  }
}

export const geminiAIProvider: AIProvider = {
  async analyzeXRay({ buffer, mimeType, clinicalNotes }) {
    const ai = getGenAIClient();

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: buffer.toString('base64'),
            },
          },
          {
            text: `Analyze this uploaded image as an educational X-ray explanation assistant.
User-provided context/notes: ${clinicalNotes?.trim() || 'None provided'}.

Strict safety & accuracy rules:
1. First verify whether the image is actually a readable medical X-ray radiograph. If it is not an X-ray (e.g., a photo, document, blank image, or severely blurred/clipped), set imageSuitability to "unsuitable_or_unclear" and clearly explain why without fabricating clinical findings.
2. Never claim a confirmed or definitive medical diagnosis. Use clear educational language ("visible opacity", "apparent asymmetry", "worth discussing with a radiologist or clinician").
3. Explicitly list areas that cannot be assessed reliably from a single 2D image and technical limitations (projection angle, exposure, lack of patient history or prior scans).
4. Only set urgentFlag=true if there are glaring, high-concern visual patterns (e.g., severe pneumothorax pattern, large displaced fracture, marked airway shift) that warrant prompt urgent clinical evaluation; otherwise false.
5. Always include a clear educational disclaimer.`,
          },
        ],
      },
      config: {
        systemInstruction:
          'You are MediExplain AI, a cautious medical education assistant specializing in explaining X-ray imagery in plain, accessible patient language. You never diagnose, never prescribe treatment, and never invent findings when image quality is insufficient.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            imageSuitability: {
              type: Type.STRING,
              description: '"suitable" or "unsuitable_or_unclear"',
            },
            identifiableViewOrRegion: {
              type: Type.STRING,
              description: 'e.g., "Frontal Chest X-Ray (PA/AP)" or "Uncertain / Not a radiograph"',
            },
            summaryPlainLanguage: {
              type: Type.STRING,
              description: 'Clear 2-4 sentence plain-language summary of what is visible.',
            },
            visibleObservations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  region: { type: Type.STRING },
                  observation: { type: Type.STRING },
                  plainExplanation: { type: Type.STRING },
                  attentionLevel: {
                    type: Type.STRING,
                    description: '"routine", "review_recommended", or "urgent_review"',
                  },
                },
                required: ['region', 'observation', 'plainExplanation', 'attentionLevel'],
              },
            },
            areasRequiringProfessionalReview: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            cannotBeAssessedReliably: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            technicalLimitations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            uncertaintyNote: { type: Type.STRING },
            urgentFlag: { type: Type.BOOLEAN },
            urgentReason: { type: Type.STRING },
            safetyDisclaimer: { type: Type.STRING },
          },
          required: [
            'imageSuitability',
            'identifiableViewOrRegion',
            'summaryPlainLanguage',
            'visibleObservations',
            'areasRequiringProfessionalReview',
            'cannotBeAssessedReliably',
            'technicalLimitations',
            'uncertaintyNote',
            'urgentFlag',
            'urgentReason',
            'safetyDisclaimer',
          ],
        },
      },
    });

    const parsed = parseJsonResponse<XRayAnalysisOutput>(response, 'X-Ray analysis');
    return {
      ...parsed,
      imageSuitability:
        parsed.imageSuitability === 'unsuitable_or_unclear'
          ? 'unsuitable_or_unclear'
          : 'suitable',
    };
  },

  async analyzeMRI({ buffer, mimeType, clinicalNotes }) {
    const ai = getGenAIClient();

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: buffer.toString('base64'),
            },
          },
          {
            text: `Analyze this uploaded single MRI scan image as an educational explanation assistant.
User-provided region/notes: ${clinicalNotes?.trim() || 'None provided'}.

Strict safety & accuracy rules:
1. Verify if the image is a readable MRI cross-sectional scan. If it is not an MRI or is too blurry/cropped to interpret, set imageSuitability to "unsuitable_or_unclear".
2. Identify the anatomical region ONLY when visually supported; otherwise state "Uncertain from single image".
3. NEVER pretend this single image represents a complete multi-sequence MRI study. Explicitly explain in singleSliceLimitationNote that clinical MRI interpretation requires reviewing all slices, pulse sequences (T1, T2, FLAIR, DWI, etc.), and clinical context.
4. Never claim a confirmed diagnosis or recommend medications/surgery.
5. Describe visible structures and any notable signal/structural patterns in plain, calm language.`,
          },
        ],
      },
      config: {
        systemInstruction:
          'You are MediExplain AI, a medical education assistant helping patients understand visible structures in individual MRI images. You never provide confirmed diagnoses and always highlight single-slice limitations.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            imageSuitability: {
              type: Type.STRING,
              description: '"suitable" or "unsuitable_or_unclear"',
            },
            anatomicalRegion: { type: Type.STRING },
            sequenceAppearance: { type: Type.STRING },
            summaryPlainLanguage: { type: Type.STRING },
            visibleStructures: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  structure: { type: Type.STRING },
                  observation: { type: Type.STRING },
                  plainExplanation: { type: Type.STRING },
                },
                required: ['structure', 'observation', 'plainExplanation'],
              },
            },
            possibleObservationsForReview: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            singleSliceLimitationNote: { type: Type.STRING },
            cannotBeAssessedReliably: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            technicalLimitations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            urgentFlag: { type: Type.BOOLEAN },
            urgentReason: { type: Type.STRING },
            safetyDisclaimer: { type: Type.STRING },
          },
          required: [
            'imageSuitability',
            'anatomicalRegion',
            'sequenceAppearance',
            'summaryPlainLanguage',
            'visibleStructures',
            'possibleObservationsForReview',
            'singleSliceLimitationNote',
            'cannotBeAssessedReliably',
            'technicalLimitations',
            'urgentFlag',
            'urgentReason',
            'safetyDisclaimer',
          ],
        },
      },
    });

    const parsed = parseJsonResponse<MRIAnalysisOutput>(response, 'MRI analysis');
    return {
      ...parsed,
      imageSuitability:
        parsed.imageSuitability === 'unsuitable_or_unclear'
          ? 'unsuitable_or_unclear'
          : 'suitable',
    };
  },

  async analyzeBloodReport({ buffer, mimeType, extractedText, clinicalNotes }) {
    const ai = getGenAIClient();

    const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];

    // Attach image or PDF directly for multimodal OCR + layout understanding
    parts.push({
      inlineData: {
        mimeType,
        data: buffer.toString('base64'),
      },
    });

    parts.push({
      text: `Extract and explain all blood test biomarkers from this uploaded laboratory report.
User notes: ${clinicalNotes?.trim() || 'None provided'}.
${
  extractedText
    ? `\nDigital PDF text extracted from document:\n"""\n${extractedText.slice(0, 24000)}\n"""\n`
    : '\nNo selectable text was found in the document; perform full visual OCR on the attached file.\n'
}

CRITICAL RULES FOR BLOOD REPORT EXTRACTION:
1. Extract every recognizable laboratory test: testName, measuredValue (exact string as printed), numericValue (number if parseable, else null), unit, referenceRange (exact printed range string, or "Unknown" if not printed on the report).
2. NEVER assume or invent a universal reference range if it is not printed on the uploaded report. If no reference range is shown for a test, set referenceRange to "Unknown", refMin to null, refMax to null, and status to "Unknown".
3. When a printed reference range exists (e.g. "4.0 - 11.0" or "< 200"), extract refMin and refMax numerically where applicable, and classify status strictly as "Normal", "High", "Low", or "Unknown".
4. Provide a clear, calm, plain-language simpleExplanation for each test explaining what the biomarker measures and what the result indicates in general educational terms.
5. Never prescribe medications or supplements. Flag critical/markedly abnormal values in urgentFlag + urgentReason so the user knows to contact a physician promptly.
6. If the uploaded document is not a blood/lab report or is unreadable, set documentSuitability to "unsuitable_or_unclear" with tests: [] and explain clearly.`,
    });

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: { parts },
      config: {
        systemInstruction:
          'You are MediExplain AI, a precise laboratory report extraction and patient education assistant. You accurately transcribe lab values and printed reference ranges without inventing missing ranges.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            documentSuitability: {
              type: Type.STRING,
              description: '"suitable" or "unsuitable_or_unclear"',
            },
            overallSummary: { type: Type.STRING },
            tests: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  testName: { type: Type.STRING },
                  measuredValue: { type: Type.STRING },
                  numericValue: { type: Type.NUMBER, nullable: true },
                  unit: { type: Type.STRING },
                  referenceRange: { type: Type.STRING },
                  refMin: { type: Type.NUMBER, nullable: true },
                  refMax: { type: Type.NUMBER, nullable: true },
                  status: {
                    type: Type.STRING,
                    description: '"Normal", "High", "Low", or "Unknown"',
                  },
                  simpleExplanation: { type: Type.STRING },
                  extractionConfidence: {
                    type: Type.STRING,
                    description: '"High", "Medium", or "Low"',
                  },
                },
                required: [
                  'testName',
                  'measuredValue',
                  'unit',
                  'referenceRange',
                  'status',
                  'simpleExplanation',
                  'extractionConfidence',
                ],
              },
            },
            limitations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            urgentFlag: { type: Type.BOOLEAN },
            urgentReason: { type: Type.STRING },
            safetyDisclaimer: { type: Type.STRING },
          },
          required: [
            'documentSuitability',
            'overallSummary',
            'tests',
            'limitations',
            'urgentFlag',
            'urgentReason',
            'safetyDisclaimer',
          ],
        },
      },
    });

    const parsed = parseJsonResponse<BloodReportAnalysisOutput>(response, 'Blood report analysis');
    return {
      ...parsed,
      documentSuitability:
        parsed.documentSuitability === 'unsuitable_or_unclear'
          ? 'unsuitable_or_unclear'
          : 'suitable',
      tests: (parsed.tests || []).map((t) => ({
        ...t,
        numericValue: typeof t.numericValue === 'number' && Number.isFinite(t.numericValue) ? t.numericValue : null,
        refMin: typeof t.refMin === 'number' && Number.isFinite(t.refMin) ? t.refMin : null,
        refMax: typeof t.refMax === 'number' && Number.isFinite(t.refMax) ? t.refMax : null,
        status:
          t.status === 'High' || t.status === 'Low' || t.status === 'Normal'
            ? t.status
            : 'Unknown',
        extractionConfidence:
          t.extractionConfidence === 'High' || t.extractionConfidence === 'Low'
            ? t.extractionConfidence
            : 'Medium',
      })),
    };
  },

  async generateChatReply({ reportContextText, history, userMessage }) {
    const ai = getGenAIClient();

    const conversationTranscript = history
      .slice(-12)
      .map((m) => `${m.role === 'user' ? 'Patient' : 'MediExplain AI'}: ${m.content}`)
      .join('\n\n');

    const prompt = `Selected Medical Report Context:
${reportContextText || 'No specific report attached to this session. Answer general medical terminology and report-understanding questions safely.'}

Recent Conversation:
${conversationTranscript || 'None yet.'}

Latest User Question:
${userMessage}`;

    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        systemInstruction: `You are MediExplain AI, an educational medical report explanation assistant.
Safety Rules (NON-NEGOTIABLE):
- Explain medical terms, scan observations, and blood test biomarkers in clear, empathetic, plain language.
- Base answers strictly on the provided report context when discussing the user's results. Never invent missing lab numbers or measurements.
- Never prescribe medications, recommend specific drug dosages, or offer a definitive diagnosis.
- Treat AI-generated imaging observations as preliminary educational notes, not confirmed clinical findings.
- Suggest thoughtful questions the user can ask their qualified healthcare provider.
- If the user describes severe or emergency symptoms (e.g., chest pain, shortness of breath, sudden neurological deficits), advise seeking immediate emergency medical care.`,
      },
    });

    const text = (response.text ?? '').trim();
    if (!text) {
      throw new Error('AI assistant returned an empty response.');
    }
    return text;
  },
};

let activeProvider: AIProvider = geminiAIProvider;

export function getAIProvider(): AIProvider {
  return activeProvider;
}

export function setAIProviderForTests(provider: AIProvider): void {
  activeProvider = provider;
}
