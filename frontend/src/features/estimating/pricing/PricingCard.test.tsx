// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PricingCard } from './PricingCard';

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('PricingCard', () => {
  it('points aria-controls at the body id and flips aria-expanded', () => {
    render(<PricingCard storageKey="pc1" defaultOpen title="Rates" testId="card" summary="the summary"><p>inside</p></PricingCard>);
    const toggle = screen.getByTestId('card-toggle');
    const body = screen.getByTestId('card-body');
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    expect(body.id).not.toBe('');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hasAttribute('hidden')).toBe(true);
    expect(screen.getByText('inside')).toBeTruthy(); // hidden, not unmounted
  });

  it('keeps pinned content visible when the body is closed', () => {
    render(<PricingCard storageKey="pc2" defaultOpen={false} title="Feeders" testId="card" pinned={<span data-testid="pin">pinned</span>}><p>inside</p></PricingCard>);
    expect(screen.getByTestId('card-body').hasAttribute('hidden')).toBe(true);
    expect(screen.getByTestId('pin').closest('[hidden]')).toBeNull();
  });

  it('collapsible={false} renders no button and an always-shown body', () => {
    render(<PricingCard storageKey="pc3" defaultOpen={false} collapsible={false} title="Feeders" testId="card" summary="s"><p>inside</p></PricingCard>);
    expect(screen.queryByTestId('card-toggle')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('card-body').hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('card-summary').textContent).toBe('s');
  });

  it('renders the summary inside the toggle', () => {
    render(<PricingCard storageKey="pc4" defaultOpen title="Rates" testId="card" summary="a summary"><p>x</p></PricingCard>);
    expect(screen.getByTestId('card-toggle').contains(screen.getByTestId('card-summary'))).toBe(true);
  });

  it('renders no body element without children', () => {
    render(<PricingCard storageKey="pc5" defaultOpen title="Empty" testId="card" />);
    expect(screen.queryByTestId('card-body')).toBeNull();
  });
});
