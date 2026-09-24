// Evidence round — the real Opus baseline run of Kissimmee (see the JSON's
// _note): loaded with fs (the backend tsconfig has no resolveJsonModule).
import fs from 'fs';
import path from 'path';
import type { InventoryPage } from '../../../ai/countSheets';
import type { CountTarget } from '../../../ai/countTargets';

export interface BaselineMark { sheetKey: string; typeKey: string; x: number; y: number }
export interface BaselineSheet { key: string; file: string; page: number; label: string; role: string; focus: string; level: string; geometry: { widthPt: number; heightPt: number; originX: number; originY: number; rotation: number } }
export interface KissimmeeBaseline {
  agent1: Record<string, unknown>;
  inventory: InventoryPage[];
  sheets: BaselineSheet[];
  marks: BaselineMark[];
  targets: CountTarget[];
}

export const KISSIMMEE_FILE = '1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf';

export function loadKissimmeeBaseline(): KissimmeeBaseline {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'kissimmee-eval-baseline.json'), 'utf8')) as KissimmeeBaseline;
}
