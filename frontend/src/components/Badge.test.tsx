// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Badge from './Badge';

afterEach(cleanup);

describe('Badge', () => {
  it('renders the tone class, defaulting to neutral -> lost', () => {
    render(<Badge>Lost</Badge>);
    expect(screen.getByText('Lost').className).toContain('badge');
    expect(screen.getByText('Lost').className).toContain('lost');
  });

  it.each([
    ['info', 'normal'],
    ['good', 'won'],
    ['warn', 'urgent'],
    ['bad', 'critical'],
  ] as const)('tone=%s renders the .badge.%s class', (tone, cls) => {
    render(<Badge tone={tone}>x</Badge>);
    expect(screen.getByText('x').className.split(' ')).toContain(cls);
  });

  it('size="sm" adds the compact modifier class', () => {
    render(<Badge size="sm">tiny</Badge>);
    expect(screen.getByText('tiny').className.split(' ')).toContain('sm');
  });

  it('a `color` override renders inline styles instead of a tone class', () => {
    render(<Badge color="#4D8DF7">Site Scheduled</Badge>);
    const el = screen.getByText('Site Scheduled');
    expect(el.className.split(' ')).not.toContain('normal');
    expect(el.className.split(' ')).not.toContain('lost');
    expect(el.style.color).toBe('#4D8DF7');
  });
});
