// Level 2 learning, Task 14 B — the live A/B as a CLI, for DEVELOPMENT ONLY.
// L-D2 (Jake, 2026-09-30): the live check is run ONLY by Jake, from the app's
// "Check and release" button. This script must not be run by the builder or
// any session. It refuses to start without every guard below, makes real
// (paid) model calls when it does, writes nothing to the database (it prints
// the result; the button is what stores and activates a release).
//
//   LEARNING_EVAL_LIVE=1 npx ts-node scripts/learningEvalLive.ts --release <id> --i-am-jake --confirm-cost
import Anthropic from '@anthropic-ai/sdk';
import { runLearningCheck, EST_COST_USD } from '../src/services/learningCheck';
import { loadAIConfig } from '../src/routes/preconstruction';
import { getSetting } from '../src/db/getSetting';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const release = Number(args[args.indexOf('--release') + 1]);
  if (process.env.LEARNING_EVAL_LIVE !== '1' || !args.includes('--i-am-jake') || !args.includes('--confirm-cost') || !Number.isInteger(release)) {
    console.error(`Refusing: this makes live model calls (about ${EST_COST_USD}). Jake runs the check from Settings → Counting lessons & examples → "Check and release".`);
    process.exit(2);
  }
  const apiKey = ((await getSetting('ai_anthropic_key')) || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('No Anthropic API key.');
  const config = await loadAIConfig();
  const r = await runLearningCheck(release, { client: new Anthropic({ apiKey }), model: config.modelCounter, maxTokens: config.maxTokensCounter, evidence: { model: config.modelEvidence, maxTokens: config.maxTokensEvidence } });
  console.log(JSON.stringify(r, null, 2));
}

void main();
