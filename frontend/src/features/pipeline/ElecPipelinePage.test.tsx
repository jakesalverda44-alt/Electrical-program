// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ElecPipelinePage from './ElecPipelinePage';
import { Bid } from '../../types';

afterEach(cleanup);

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('../../contexts/AppContext', () => ({
  useShowToast: () => vi.fn(),
}));

const bid: Bid = {
  id: 'b1', name: 'Sonnys Car Wash — Ocala', gc: 'ABC Builders', loc: 'Ocala, FL',
  amount: 250000, due: null, stage: 'due', sheets: 3,
} as unknown as Bid;

const noop = () => {};
const baseProps = {
  bids: [bid], setBids: noop as never, setWonJobs: noop as never,
  flashId: null,
};

describe('ElecPipelinePage deep link (openId)', () => {
  // Regression test for the global-search deep-link bug: onOpenBid pushes a
  // navigate to /bid/<id>, and onClearParam used to replace-navigate to
  // /elec-proposals in the same tick, clobbering the push before the user
  // ever saw the Hub. onClearParam must NOT be called from this effect.
  it('opens the matching bid via onOpenBid and does not call onClearParam', () => {
    const onOpenBid = vi.fn();
    const onClearParam = vi.fn();
    render(
      <ElecPipelinePage
        {...baseProps}
        onOpenBid={onOpenBid}
        openId="b1"
        onClearParam={onClearParam}
      />
    );
    expect(onOpenBid).toHaveBeenCalledTimes(1);
    expect(onOpenBid).toHaveBeenCalledWith('b1');
    expect(onClearParam).not.toHaveBeenCalled();
  });

  it('does not call onOpenBid when openId has no matching bid', () => {
    const onOpenBid = vi.fn();
    const onClearParam = vi.fn();
    render(
      <ElecPipelinePage
        {...baseProps}
        onOpenBid={onOpenBid}
        openId="does-not-exist"
        onClearParam={onClearParam}
      />
    );
    expect(onOpenBid).not.toHaveBeenCalled();
    expect(onClearParam).not.toHaveBeenCalled();
  });

  it('only fires onOpenBid once for the same openId across re-renders', () => {
    const onOpenBid = vi.fn();
    const { rerender } = render(
      <ElecPipelinePage {...baseProps} onOpenBid={onOpenBid} openId="b1"/>
    );
    rerender(<ElecPipelinePage {...baseProps} onOpenBid={onOpenBid} openId="b1"/>);
    expect(onOpenBid).toHaveBeenCalledTimes(1);
  });
});
