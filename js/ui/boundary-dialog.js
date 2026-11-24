// The small dialog that asks before an adjacent entry is moved together with an edited boundary.
// Not a native confirm(), because its buttons must be translated.

const $ = (id) => document.getElementById(id);

/**
 * Shows the question. Resolves to 'both' (move both entries), 'only' (only the edited entry) or
 * 'cancel' (Esc, the Cancel button, or closing the dialog). Enter chooses "Move both".
 * With `error` set, "Move both" is not offered: only "Only this entry" and "Cancel".
 */
export function askBoundary({ text, error = null }) {
  return new Promise((resolve) => {
    const dialog = $('dlgBoundary');
    $('txtBoundary').textContent = text;
    const errorBox = $('txtBoundaryError');
    errorBox.textContent = error || '';
    errorBox.hidden = !error;
    $('btnBoundaryBoth').hidden = Boolean(error);

    dialog.returnValue = 'cancel';
    dialog.addEventListener('close', () => {
      resolve(['both', 'only'].includes(dialog.returnValue) ? dialog.returnValue : 'cancel');
    }, { once: true });
    dialog.showModal();
    (error ? $('btnBoundaryCancel') : $('btnBoundaryBoth')).focus();
  });
}
