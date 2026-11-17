/**
 * "You have unsent changes" indicator (Layer 4 — interactions).
 *
 * Changes only reach the server through ✓ Confirm, and a green box
 * that is scrolled off screen says nothing. While edit mode has
 * anything Confirm would send, `body.dmna-has-pending` outlines the
 * floating button and the arc menu's Confirm item, and the button
 * carries a count badge (v5.1 Task 4.8).
 *
 * The count is exactly what Confirm would send (`classifyChanges`):
 * a never-committed new box doesn't count, a soft-deleted server note
 * does.
 */

import {classifyChanges} from '../confirm/classify';
import {getMode} from '../state/notes-store';
import {setFloatingButtonPendingCount} from '../ui/floating-button';

let scheduled = false;

/** Recomputes the indicator now. */
export function refreshPendingIndicator(): void {
  let count = 0;
  if (getMode() === 'active') {
    const c = classifyChanges();
    count = c.posts.length + c.puts.length + c.deletes.length;
  }
  document.body.classList.toggle('dmna-has-pending', count > 0);
  setFloatingButtonPendingCount(count);
}

/**
 * Coalesces a burst of updates (a batch render touches every box) into
 * one recompute at the end of the current task.
 */
export function schedulePendingRefresh(): void {
  if (scheduled) {
    return;
  }
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    refreshPendingIndicator();
  });
}
