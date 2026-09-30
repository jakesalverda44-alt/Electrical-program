// Window-level signals that tell an already-open useEstimatingBid something
// changed on the server behind its back. Same plain-window-event pattern as
// api/session.ts's SESSION_CLEARED_EVENT: the takeoff review panel and the
// Accubid pricing panel are separate components/hooks from the one that owns
// the Estimating page's state, and neither needs to know about it.

/** The bid's takeoff review answers / count types changed, so the server's
 *  proposed (or saved) estimate lines may now differ from what was loaded. */
export const ESTIMATE_STALE_EVENT = 'crm:estimate-stale';
/** A quote / cost line / alternate / Accubid setting was written, so the
 *  sidebar's Accubid recap is out of date. */
export const ACCUBID_CHANGED_EVENT = 'crm:accubid-changed';

export interface EstimateSignalDetail { bidId: string }

function fire(name: string, bidId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<EstimateSignalDetail>(name, { detail: { bidId } }));
}
export const signalEstimateStale = (bidId: string) => fire(ESTIMATE_STALE_EVENT, bidId);
export const signalAccubidChanged = (bidId: string) => fire(ACCUBID_CHANGED_EVENT, bidId);
