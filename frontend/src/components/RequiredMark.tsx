import React from 'react';

/**
 * A persistent "required" cue next to a field's label (audit ux #15). Before
 * this, required fields relied solely on the native `required` attribute,
 * which produces no visible marker until the browser's native validation
 * balloon pops up on submit — a user had no way to tell a field was required
 * just by looking at the form.
 *
 * The asterisk itself is `aria-hidden` (it's a visual affordance, not
 * information a screen reader should read as a literal "asterisk"); a
 * visually-hidden "required" span carries the same information to assistive
 * tech instead, matching the field's own `required` attribute so the two
 * never disagree.
 */
export default function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>
      <span style={{
        position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
        overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
      }}>
        required
      </span>
    </>
  );
}
