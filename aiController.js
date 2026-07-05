const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { getCachedSolution, setCachedSolution } = require('./cache');

const CHEAP_MODEL = process.env.CHEAP_MODEL || 'claude-3-5-haiku-20241022';
const EXPENSIVE_MODEL = process.env.EXPENSIVE_MODEL || 'claude-sonnet-4-20250514';

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Add it to your .env file.');
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const hintPacks = {};
const HINTPACKS_DIR = path.join(__dirname, 'hintpacks');

function loadHintPacks() {
  for (let i = 1; i <= 8; i++) {
    const filePath = path.join(HINTPACKS_DIR, `unit${i}.json`);
    if (fs.existsSync(filePath)) {
      hintPacks[i] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  }
}

loadHintPacks();

function getHintFromPack(unitId, problemType, tier) {
  const pack = hintPacks[unitId] || hintPacks[1];
  const hints = pack.hints[problemType] || pack.hints.default;
  const tierKey = `tier${tier}`;
  return {
    tier,
    title: hints[tierKey].title,
    content: hints[tierKey].content,
    unitName: pack.unitName,
    source: 'static-hint-pack'
  };
}

async function callCheapModel(messages, systemPrompt) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: CHEAP_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return text;
}

async function callExpensiveModel(messages, systemPrompt) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: EXPENSIVE_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return text;
}

function parseJsonFromResponse(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse JSON from model response');
  }
  return JSON.parse(jsonMatch[0]);
}

async function classifyProblem(problemText, imageBase64, mimeType) {
  const systemPrompt = `You are an AP Physics 1 problem classifier. Analyze the given physics problem and respond ONLY with valid JSON (no markdown):
{
  "unitId": <number 1-8>,
  "unitName": "<AP Physics unit name>",
  "problemType": "<key from: default, projectile_motion, forces, energy, momentum, circular_motion, rotation, oscillations, electrostatics, graphs, free_body>",
  "problemSummary": "<one sentence summary>",
  "variables": ["<list of known variables and values>"],
  "unknowns": ["<what needs to be found>"],
  "concepts": ["<relevant physics concepts>"]
}

Unit mapping:
1 = Kinematics
2 = Dynamics (Newton's Laws)
3 = Circular Motion & Gravitation
4 = Energy
5 = Momentum
6 = Simple Harmonic Motion
7 = Torque & Rotational Motion
8 = Electric Charge & Electric Force`;

  const userContent = [];

  if (imageBase64 && mimeType) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: imageBase64
      }
    });
  }

  userContent.push({
    type: 'text',
    text: problemText || 'Analyze the physics problem shown in the image.'
  });

  const raw = await callCheapModel([{ role: 'user', content: userContent }], systemPrompt);
  const parsed = parseJsonFromResponse(raw);

  parsed.unitId = Math.min(8, Math.max(1, Number(parsed.unitId) || 1));
  return parsed;
}

async function analyzeAttempt(problemText, classification, studentAnswer, studentReasoning, attemptNumber) {
  const systemPrompt = `You are an AP Physics tutor analyzing a student attempt. Respond ONLY with valid JSON:
{
  "isCorrect": <boolean>,
  "feedback": "<brief constructive feedback, do NOT give the full answer>",
  "suggestedTier": <number 1-5 based on how close they are>,
  "reasoningQuality": "<poor|developing|good|excellent>",
  "misconceptions": ["<list any misconceptions>"]
}

Rules:
- Never reveal the full solution
- Be encouraging but precise
- suggestedTier should match attempt number unless student is very close (then can suggest next tier)`;

  const userMessage = `Problem: ${problemText}

Classification: Unit ${classification.unitId} (${classification.unitName}), type: ${classification.problemType}
Variables: ${classification.variables?.join(', ') || 'unknown'}
Unknowns: ${classification.unknowns?.join(', ') || 'unknown'}

Attempt #${attemptNumber}
Student answer: ${studentAnswer}
Student reasoning: ${studentReasoning}`;

  const raw = await callCheapModel([{ role: 'user', content: userMessage }], systemPrompt);
  return parseJsonFromResponse(raw);
}

async function generateTier5Solution(problemText, classification, studentAnswer, studentReasoning) {
  const cached = getCachedSolution(problemText);
  if (cached) {
    return {
      ...cached,
      fromCache: true,
      modelUsed: 'cache'
    };
  }

  const systemPrompt = `You are an expert AP Physics 1 tutor. Provide a complete, rigorous solution with clear reasoning. Respond ONLY with valid JSON:
{
  "fullSolution": "<step-by-step solution with equations and units>",
  "correctAnswer": "<final numerical/symbolic answer>",
  "keyEquations": ["<equations used>"],
  "reasoningComparison": {
    "studentStrengths": ["<what the student did well>"],
    "studentGaps": ["<where reasoning diverged from correct approach>"],
    "improvementTips": ["<specific advice for this problem type>"]
  },
  "conceptualSummary": "<brief recap of the physics concepts>"
}`;

  const userMessage = `Problem:
${problemText}

Unit: ${classification.unitName} (Unit ${classification.unitId})
Problem type: ${classification.problemType}
Variables: ${JSON.stringify(classification.variables || [])}
Unknowns: ${JSON.stringify(classification.unknowns || [])}

Student's final attempt:
Answer: ${studentAnswer || '(none provided)'}
Reasoning: ${studentReasoning || '(none provided)'}

Provide the full solution and compare the student's reasoning to the correct approach.`;

  const raw = await callExpensiveModel([{ role: 'user', content: userMessage }], systemPrompt);
  const parsed = parseJsonFromResponse(raw);

  setCachedSolution(problemText, {
    classification,
    ...parsed,
    modelUsed: EXPENSIVE_MODEL
  });

  return {
    ...parsed,
    fromCache: false,
    modelUsed: EXPENSIVE_MODEL
  };
}

async function getHintForAttempt(session, attemptNumber) {
  const tier = Math.min(5, Math.max(1, attemptNumber));
  const { unitId, problemType } = session.classification;

  // Tier 1–4: personalized static hints
  if (tier <= 4) {
    const rawHint = getHintFromPack(unitId, problemType, tier);

    // Safe access: avoid crashes on attempt #1
    const latestAttempt = session.attempts[attemptNumber - 1] || {};

    const personalizedContent = await personalizeHint(
      rawHint.content,
      session.problemText,
      latestAttempt.answer || ""
    );

    return {
      tier,
      title: rawHint.title,
      content: personalizedContent,
      unitName: rawHint.unitName,
      source: "personalized-static-hint"
    };
  }

  // Tier 5: full solution (expensive model)
  return { tier: 5, requiresLLM: true };
}



module.exports = {
  classifyProblem,
  analyzeAttempt,
  generateTier5Solution,
  getHintForAttempt,
  getHintFromPack,
  loadHintPacks
};

async function personalizeHint(templateHint, problemText, studentAttempt) {
  const systemPrompt = `
You are an AP Physics tutor. Rewrite the provided hint so it applies specifically
to the student's attempt and the problem context. Keep the same meaning, but make
it feel personalized and relevant to THIS problem.

Rules:
- Do NOT reveal the full solution.
- Do NOT jump ahead to Tier 5 reasoning.
- Keep the hint short, encouraging, and focused.
- Maintain the physics accuracy.

Return ONLY the rewritten hint text.
`;

  const userMessage = `
Problem:
${problemText}

Student Attempt:
${studentAttempt}

Template Hint:
${templateHint}
`;

  const rewritten = await callCheapModel(
    [{ role: "user", content: userMessage }],
    systemPrompt
  );

  return rewritten.trim();
}

