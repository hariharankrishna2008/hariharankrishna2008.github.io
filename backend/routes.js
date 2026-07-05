const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const pdfParse = require('pdf-parse');

const {
  classifyProblem,
  analyzeAttempt,
  generateTier5Solution,
  getHintForAttempt
} = require('./aiController');

const router = express.Router();

/* -----------------------------
   FILE UPLOAD SETUP
------------------------------ */

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'text/plain'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Upload PDF, image, or text.'));
    }
  }
});

/* -----------------------------
   SESSION STORAGE
------------------------------ */

const sessions = new Map();

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }
  return session;
}

/* -----------------------------
   FILE PROCESSING HELPERS
------------------------------ */

async function extractTextFromFile(file) {
  if (!file) return '';

  if (file.mimetype === 'text/plain') {
    return fs.readFileSync(file.path, 'utf8');
  }

  if (file.mimetype === 'application/pdf') {
    const buffer = fs.readFileSync(file.path);
    const data = await pdfParse(buffer);
    return data.text;
  }

  return '';
}

function getImageData(file) {
  if (!file || !file.mimetype.startsWith('image/')) {
    return { base64: null, mimeType: null };
  }

  const buffer = fs.readFileSync(file.path);
  return {
    base64: buffer.toString('base64'),
    mimeType: file.mimetype
  };
}

/* -----------------------------
   ROUTE: START PROBLEM
------------------------------ */

router.post('/problem', upload.single('file'), async (req, res) => {
  try {
    const textInput = (req.body.text || '').trim();
    let problemText = textInput;
    let imageBase64 = null;
    let mimeType = null;

    if (req.file) {
      const extracted = await extractTextFromFile(req.file);
      if (extracted.trim()) {
        problemText = extracted.trim();
      } else if (textInput) {
        problemText = textInput;
      }

      const imageData = getImageData(req.file);
      imageBase64 = imageData.base64;
      mimeType = imageData.mimeType;

      if (!problemText && !imageBase64) {
        return res.status(400).json({
          error: 'Could not extract text from file. Try adding a text description.'
        });
      }
    }

    if (!problemText && !imageBase64) {
      return res.status(400).json({ error: 'Provide problem text or upload a file.' });
    }

    const classification = await classifyProblem(problemText, imageBase64, mimeType);
    const sessionId = uuidv4();

    const session = {
      id: sessionId,
      problemText: problemText || '[Image-based problem]',
      classification,
      attempts: [],
      currentTier: 0,
      tier5Revealed: false,
      createdAt: new Date().toISOString()
    };

    sessions.set(sessionId, session);

    res.json({
      sessionId,
      problemText: session.problemText,
      classification,
      message: 'Problem loaded. Submit your first attempt to receive Tier 1 hints.'
    });
  } catch (err) {
    console.error('POST /api/problem error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to process problem' });
  }
});

/* -----------------------------
   ROUTE: SUBMIT ATTEMPT
------------------------------ */

router.post('/attempt', async (req, res) => {
  try {
    const { sessionId, answer, reasoning } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    if (!answer?.trim() && !reasoning?.trim()) {
      return res.status(400).json({ error: 'Provide an answer or your reasoning.' });
    }

    const session = getSession(sessionId);
    const attemptNumber = session.attempts.length + 1;

    if (attemptNumber > 5) {
      return res.status(400).json({
        error: 'Maximum 5 attempts reached. Reveal the answer or start a new problem.'
      });
    }

    const analysis = await analyzeAttempt(
      session.problemText,
      session.classification,
      answer || '',
      reasoning || '',
      attemptNumber
    );

    session.attempts.push({
      attemptNumber,
      answer: answer || '',
      reasoning: reasoning || '',
      analysis,
      timestamp: new Date().toISOString()
    });

    session.currentTier = attemptNumber;

    const hintInfo = await getHintForAttempt(session, attemptNumber);

    let hint = null;
    let tier5Solution = null;

    if (hintInfo.requiresLLM) {
      tier5Solution = await generateTier5Solution(
        session.problemText,
        session.classification,
        answer || '',
        reasoning || ''
      );

      session.tier5Revealed = true;
      session.tier5Solution = tier5Solution;

      hint = {
        tier: 5,
        title: 'Tier 5 — Full Solution + Reasoning Comparison',
        content: tier5Solution.fullSolution,
        source: tier5Solution.fromCache ? 'cache' : 'expensive-model',
        reasoningComparison: tier5Solution.reasoningComparison,
        correctAnswer: tier5Solution.correctAnswer,
        keyEquations: tier5Solution.keyEquations,
        conceptualSummary: tier5Solution.conceptualSummary
      };
    } else {
      hint = hintInfo;
    }

    res.json({
      sessionId,
      attemptNumber,
      currentTier: session.currentTier,
      maxAttempts: 5,
      analysis,
      hint,
      canRevealAnswer: session.currentTier >= 5 || session.tier5Revealed,
      tier5Revealed: session.tier5Revealed
    });
  } catch (err) {
    console.error('POST /api/attempt error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to process attempt' });
  }
});

/* -----------------------------
   ROUTE: REVEAL FULL SOLUTION
------------------------------ */

router.post('/reveal', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const session = getSession(sessionId);

    if (session.currentTier < 5 && !session.tier5Revealed) {
      return res.status(403).json({
        error: 'Full solution is available only after Tier 5 (5 attempts) or when Tier 5 is unlocked.'
      });
    }

    if (session.tier5Solution) {
      return res.json({
        sessionId,
        tier5Solution: session.tier5Solution,
        fromCache: session.tier5Solution.fromCache || false
      });
    }

    const lastAttempt = session.attempts[session.attempts.length - 1] || {};
    const tier5Solution = await generateTier5Solution(
      session.problemText,
      session.classification,
      lastAttempt.answer || '',
      lastAttempt.reasoning || ''
    );

    session.tier5Revealed = true;
    session.tier5Solution = tier5Solution;

    res.json({
      sessionId,
      tier5Solution,
      fromCache: tier5Solution.fromCache || false
    });
  } catch (err) {
    console.error('POST /api/reveal error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to reveal answer' });
  }
});

/* -----------------------------
   ROUTE: GET SESSION INFO
------------------------------ */

router.get('/session/:sessionId', (req, res) => {
  try {
    const session = getSession(req.params.sessionId);

    res.json({
      sessionId: session.id,
      problemText: session.problemText,
      classification: session.classification,
      attempts: session.attempts,
      currentTier: session.currentTier,
      tier5Revealed: session.tier5Revealed,
      canRevealAnswer: session.currentTier >= 5 || session.tier5Revealed
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/* -----------------------------
   HEALTH CHECK
------------------------------ */

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
