// @vitest-environment happy-dom
// Review S5 — with no plan files selected, Run AI no longer says "Upload plan
// files" (there is no upload in Estimating any more); it links to Overview.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import BidTab from './BidTab';
import { blankWorkspace } from '../constants';
import { NO_PLANS_SELECTED_MSG } from './shared';

afterEach(cleanup);

describe('BidTab — no plans selected', () => {
  it('shows the Overview message and a link to it', () => {
    const onGoOverview = vi.fn();
    const ws = { ...blankWorkspace('b1', 'Job', 0), aiLog: [NO_PLANS_SELECTED_MSG] };
    render(<BidTab ws={ws} set={() => {}} aiResults={null} runAI={() => {}} resumeAI={() => {}} rerunAI={() => {}} onGoOverview={onGoOverview}/>);
    expect(screen.getByText(NO_PLANS_SELECTED_MSG)).toBeTruthy();
    expect(screen.queryByText(/upload plan files/i)).toBeNull();
    fireEvent.click(screen.getByTestId('go-overview-plans'));
    expect(onGoOverview).toHaveBeenCalledTimes(1);
  });
});
