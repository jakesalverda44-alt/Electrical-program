// Phase 3 Task 4 — the verification gate, ported from the APT_Bid_System v4
// skill's scripts/verify.sh (~/.claude/skills/apt-electrical-bid/scripts/verify.sh).
//
// Environment fact (2026-09-02, see the plan): Render's Aptfile installs
// poppler only — there is NO LibreOffice in production. verify.sh's checks
// 3-6 (placeholders / banned language / square footage / ECFECI) all run on
// extracted docx text and need no external tool, so that's the core this
// module runs unconditionally (verifyBidText, pure — no I/O). verify.sh's
// checks 1-2/7 (OOXML validation via python, PDF conversion + page renders
// via soffice/poppler) either don't apply to a buffer we just built with the
// `docx` package (it's valid OOXML by construction) or are the optional PDF
// enhancement below: when `soffice` is found on PATH or at the macOS app
// path, convert to PDF and return it; when it isn't, that is NOT a failure.
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { extractDocxText } from '../utils/bidDocParse';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

export type VerifyKind = 'gc' | 'internal';

export interface VerifyFailure {
  check: string;
  detail: string;
  matches: string[];
}

export interface VerifyTextResult {
  pass: boolean;
  failures: VerifyFailure[];
}

export interface VerifyResult extends VerifyTextResult {
  /** Present only when `soffice` was found and conversion succeeded. */
  pdf?: Buffer;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// ── Check 1: unfilled placeholders (both kinds) ─────────────────────────────
// verify.sh: [PLAN DATE(S)], [SHEET LIST], [GC] etc. — bracketed ALL-CAPS
// tokens only, so a legitimately bracketed citation never false-positives.
const PLACEHOLDER_RE = /\[[A-Z][A-Z0-9 ()/&._-]{1,60}\]/g;

// ── Check 2: banned estimator/internal language (GC only) ───────────────────
// verify.sh v4's list: 'RFI|please confirm|clarification requested|field
// verify|counted|±|↳|SCWI|DQC|For Presentation Only|Not For
// Construction|TBD'. Deviation from verify.sh (documented in the plan and
// the Phase 3 report): word boundaries added on RFI/counted/TBD so
// "Discounted"/"accounted" can't false-positive — this fixes a known nit in
// verify.sh itself.
const BANNED_PATTERNS: RegExp[] = [
  /\bRFI\b/gi,
  /please confirm/gi,
  /clarification requested/gi,
  /field verify/gi,
  /\bcounted\b/gi,
  /±/g,
  /↳/g,
  /SCWI/gi,
  /DQC/gi,
  /For Presentation Only/gi,
  /Not For Construction/gi,
  /\bTBD\b/gi,
];

function scanBanned(text: string): string[] {
  const hits: string[] = [];
  for (const re of BANNED_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push(...m);
  }
  return dedupe(hits);
}

// ── Check 3: square footage (GC only) ────────────────────────────────────────
const SQFT_RE = /[0-9,]+ *(?:SF|S\.F\.|sq\.? ?ft)/gi;

// ── Check 4: ECFECI presence + mandated placements (GC only) ────────────────
// verify.sh: occurrence count >= 3. Plan adds: assert the three mandated
// placements exist by checking ECFECI appears at least once between
// "A. Service & Distribution" / "B. Branch Power", and once between
// "C. Lighting & Controls" / "D. Site" (PROJECT_INSTRUCTIONS §7).
function checkEcfeci(text: string): VerifyFailure | null {
  const occurrences = text.match(/ECFECI/g) ?? [];
  const problems: string[] = [];

  if (occurrences.length < 3) {
    problems.push(
      `only ${occurrences.length} ECFECI occurrence(s) — expected at least 3 (Section A x2, Section C x1, plus takeoff gear lines)`
    );
  }

  const between = (startMarker: string, endMarker: string): boolean => {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker);
    if (start === -1 || end === -1 || start >= end) return false;
    return /ECFECI/.test(text.slice(start, end));
  };

  if (!between('A. Service & Distribution', 'B. Branch Power')) {
    problems.push('ECFECI not found between "A. Service & Distribution" and "B. Branch Power"');
  }
  if (!between('C. Lighting & Controls', 'D. Site')) {
    problems.push('ECFECI not found between "C. Lighting & Controls" and "D. Site"');
  }

  return problems.length ? { check: 'ecfeci', detail: problems.join('; '), matches: [] } : null;
}

/**
 * The pure text-based core of the gate — no I/O, no external tools. Runs
 * unconditionally in every environment (including production, which has no
 * LibreOffice). `kind: 'internal'` (pre-bid package) skips banned-language,
 * square-footage, and ECFECI — pre-bid scope legitimately carries estimator
 * language and square footage per PROJECT_INSTRUCTIONS §14 — but keeps the
 * placeholder scan.
 */
export function verifyBidText(text: string, kind: VerifyKind): VerifyTextResult {
  const failures: VerifyFailure[] = [];

  const placeholders = dedupe([...text.matchAll(PLACEHOLDER_RE)].map(m => m[0]));
  if (placeholders.length) {
    failures.push({
      check: 'placeholders',
      detail: 'Unfilled bracketed placeholders found — fill them before sending.',
      matches: placeholders,
    });
  }

  if (kind === 'gc') {
    const banned = scanBanned(text);
    if (banned.length) {
      failures.push({
        check: 'banned_language',
        detail: 'Estimator/internal language found — strip before sending to the GC.',
        matches: banned,
      });
    }

    const sqft = dedupe([...text.matchAll(SQFT_RE)].map(m => m[0]));
    if (sqft.length) {
      failures.push({
        check: 'square_footage',
        detail: 'Square footage belongs on the takeoff only — never on the bid document.',
        matches: sqft,
      });
    }

    const ecfeci = checkEcfeci(text);
    if (ecfeci) failures.push(ecfeci);
  }

  return { pass: failures.length === 0, failures };
}

// ── Optional PDF conversion (soffice) ────────────────────────────────────────
const MAC_SOFFICE_PATH = '/Applications/LibreOffice.app/Contents/MacOS/soffice';

/** Checks PATH, then the macOS app bundle path. Never throws. */
export function findSoffice(): string | null {
  try {
    const out = execSync('command -v soffice', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (out) return out;
  } catch {
    // not on PATH — fall through to the macOS app path
  }
  if (fs.existsSync(MAC_SOFFICE_PATH)) return MAC_SOFFICE_PATH;
  return null;
}

async function convertToPdf(sofficePath: string, docxBuffer: Buffer): Promise<Buffer | null> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bidverify-'));
  try {
    const docxPath = path.join(tmpDir, 'input.docx');
    await fsp.writeFile(docxPath, docxBuffer);
    await execFileAsync(sofficePath, ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, docxPath], { timeout: 30_000 });
    const pdfPath = path.join(tmpDir, 'input.pdf');
    if (fs.existsSync(pdfPath)) return await fsp.readFile(pdfPath);
    return null;
  } catch (err) {
    logger.warn({ err }, '[verifyBid] soffice PDF conversion failed — continuing without a PDF');
    return null;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Verify a rendered bid .docx buffer. Runs the pure-text core unconditionally,
 * then — only when `soffice` is present — also converts to PDF and returns
 * it. A missing soffice is never a failure (see the plan's environment note).
 */
export async function verifyBidDocx(buffer: Buffer, opts: { kind: VerifyKind }): Promise<VerifyResult> {
  const text = extractDocxText(buffer);
  const core = verifyBidText(text, opts.kind);

  const soffice = findSoffice();
  if (!soffice) return core;

  const pdf = await convertToPdf(soffice, buffer);
  return pdf ? { ...core, pdf } : core;
}
