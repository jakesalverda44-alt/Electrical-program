// Fewer-questions round Task 4 — resolve / reopen, moved out of
// TakeoffReviewPanel unchanged (same requests, same toasts, the same
// signalEstimateStale), so the Scope step's question card posts exactly
// what the Takeoff list posts.
import { useState } from 'react';
import api from '../../../../api/client';
import type { Toast } from '../../../../types';
import { signalEstimateStale } from '../../../estimating/estimateSignals';
import type { TakeoffReview } from '../TakeoffReviewPanel';

function errorOf(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? fallback;
}

export interface UseReviewResolveArgs {
  bidId: string;
  onReviewChange: (review: TakeoffReview) => void;
  showToast: (t: Toast) => void;
  /** After a successful resolve (the panel moves focus, clears its selection). */
  onResolved?: (data: TakeoffReview, itemIds: string[], body: Record<string, unknown>) => void;
}

export function useReviewResolve({ bidId, onReviewChange, showToast, onResolved }: UseReviewResolveArgs) {
  const [busy, setBusy] = useState<string | null>(null);

  const reopen = async (itemId: string, memberKey?: string) => {
    setBusy(`reopen:${itemId}`);
    try {
      const { data } = await api.post<TakeoffReview>(`/preconstruction/${bidId}/review/reopen`, memberKey ? { itemId, memberKey } : { itemId });
      onReviewChange(data);
      signalEstimateStale(bidId); // the estimate's proposed lines follow the answers
    } catch (err) {
      showToast({ variant: 'error', title: 'Could not reopen', sub: errorOf(err, 'The review item was not reopened') });
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (itemIds: string[], body: Record<string, unknown>, key: string): Promise<boolean> => {
    setBusy(key);
    try {
      const { data } = await api.post<TakeoffReview>(`/preconstruction/${bidId}/review/resolve`, { itemIds, ...body });
      onReviewChange(data);
      signalEstimateStale(bidId); // the estimate's proposed lines follow the answers
      onResolved?.(data, itemIds, body);
      // One-click choice answers can be undone from the toast (the existing reopen).
      if (key.startsWith('ans:') && itemIds.length === 1 && body.action === 'answer') {
        const id = itemIds[0];
        showToast({ title: 'Answer saved', sub: String(body.answer ?? ''), action: { label: 'Undo', onClick: () => void reopen(id) } });
      }
      return true;
    } catch (err) {
      showToast({ variant: 'error', title: 'Could not save', sub: errorOf(err, 'The review item was not updated') });
      return false;
    } finally {
      setBusy(null);
    }
  };

  return { busy, setBusy, resolve, reopen };
}
