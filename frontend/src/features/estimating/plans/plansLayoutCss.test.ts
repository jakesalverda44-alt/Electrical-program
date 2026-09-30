// Regression lock for the "whole app scrolls / viewer only ~230px tall" bug.
// jsdom can't lay anything out, so this pins the CSS contract instead.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
const styles = read('..', '..', '..', 'styles.css');
const plans = read('plans.css');
const body = (css: string, sel: string) => {
  const re = new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  return re.exec(css)?.[1] ?? '';
};

describe('app shell never scrolls as a whole', () => {
  it('.app is one viewport tall with overflow hidden', () => {
    const app = body(styles, '.app');
    expect(app).toMatch(/height:\s*100dvh/);
    expect(app).toMatch(/overflow:\s*hidden/);
  });
  it('.main can shrink (min-height:0) so its .scroll child scrolls instead of the document', () => {
    expect(body(styles, '.main')).toMatch(/min-height:\s*0/);
    expect(body(styles, '.scroll')).toMatch(/overflow-y:\s*auto/);
  });
  it('mobile re-enables natural document scroll', () => {
    expect(styles).toMatch(/\.app \{[^}]*height:\s*auto;[^}]*overflow:\s*visible/);
  });
});

describe('Plans workspace gets a definite viewport-based height', () => {
  it('.plan-view is sized from the viewport on wide layouts', () => {
    const m = /@media \(min-width: 900px\) \{\s*\.plan-view \{([^}]*)\}/.exec(plans);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/flex:\s*none/);
    expect(m![1]).toMatch(/height:\s*calc\(100dvh - \d+px\)/);
    expect(m![1]).toMatch(/min-height:\s*\d+px/);
  });
  it('the canvas wrap takes the remaining height and scrolls inside itself', () => {
    expect(body(plans, '.plan-canvas-wrap')).toMatch(/flex:\s*1/);
    expect(body(plans, '.plan-canvas-wrap')).toMatch(/min-height:\s*0/);
    expect(body(plans, '.plan-canvas-scroll')).toMatch(/overflow:\s*auto/);
  });
});
