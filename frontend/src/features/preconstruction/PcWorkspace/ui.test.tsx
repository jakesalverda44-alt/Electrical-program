// @vitest-environment happy-dom
// Regression test for review-round-1 B2: after Task 3 swapped `pill()`'s
// hardcoded hex colors for theme tokens (`var(--green)` etc.), `color + '22'`
// produced the invalid CSS string `"var(--green)22"`, silently dropping every
// tinted background (AI risk/confidence/ready pills).
import { describe, it, expect } from 'vitest';
import type { CSSProperties } from 'react';
import { pill } from './ui';

// Inspects the React element's own `style` prop directly rather than mounting
// it — happy-dom's CSSStyleDeclaration doesn't understand `color-mix(...)`
// and silently drops the whole `background` declaration when set via the
// DOM, which would make this test pass or fail for the wrong reason.
function backgroundOf(el: ReturnType<typeof pill>): string {
  return (el.props.style as CSSProperties).background as string;
}

describe('pill() tinted background (review round 1 B2)', () => {
  it('uses color-mix for a CSS-variable color', () => {
    const bg = backgroundOf(pill('FIRM', 'var(--green)'));
    expect(bg).toContain('color-mix');
    expect(bg).toContain('var(--green)');
  });

  it('keeps the hex + alpha-suffix behavior for a literal hex color', () => {
    expect(backgroundOf(pill('FIRM', '#10B981'))).toBe('#10B98122');
  });
});
