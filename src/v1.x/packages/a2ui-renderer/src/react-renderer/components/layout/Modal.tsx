import { useState, useCallback, useRef, useEffect, memo } from 'react';
import type { Types } from '@a2ui/lit/0.8';
import type { A2UIComponentProps } from '../../types';
import { useA2UIComponent } from '../../hooks/useA2UIComponent';
import { classMapToString, stylesToObject } from '../../lib/utils';
import { ComponentNode } from '../../core/ComponentNode';

/**
 * Modal component - displays content in a dialog overlay.
 *
 * Matches Lit's rendering approach:
 * - When closed: renders section with entry point child
 * - When open: renders dialog with content child (entry point is replaced)
 *
 * The dialog is rendered in place (no portal) so it stays inside .a2ui-surface
 * and CSS selectors work correctly. showModal() handles the top-layer overlay.
 */
export const Modal = memo(function Modal({ node, surfaceId }: A2UIComponentProps<Types.ModalNode>) {
  const { theme } = useA2UIComponent(node, surfaceId);
  const props = node.properties;

  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const openModal = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Show dialog when isOpen becomes true, and sync state when dialog closes (e.g., via Escape)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    }

    // Listen for native close event (triggered by Escape key)
    const handleClose = () => {
      setIsOpen(false);
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [isOpen]);

  // Handle backdrop clicks (only close if clicking directly on dialog, not its content)
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget) {
        closeModal();
      }
    },
    [closeModal]
  );

  // Handle Escape key (for jsdom test compatibility - real browsers use native dialog behavior)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDialogElement>) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    },
    [closeModal]
  );

  // Apply --weight CSS variable on root div (:host equivalent) for flex layouts
  const hostStyle: React.CSSProperties = node.weight !== undefined
    ? { '--weight': node.weight } as React.CSSProperties
    : {};

  // Match Lit's render approach: closed shows section with entry, open shows dialog
  if (!isOpen) {
    return (
      <div className="a2ui-modal" style={hostStyle}>
        <section onClick={openModal} style={{ cursor: 'pointer' }}>
          <ComponentNode node={props.entryPointChild} surfaceId={surfaceId} />
        </section>
      </div>
    );
  }

  return (
    <div className="a2ui-modal" style={hostStyle}>
      <dialog
        ref={dialogRef}
        className={classMapToString(theme.components.Modal.backdrop)}
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
      >
        <section
          className={classMapToString(theme.components.Modal.element)}
          style={stylesToObject(theme.additionalStyles?.Modal)}
        >
          <div id="controls">
            <button onClick={closeModal} aria-label="Close modal">
              <span className="g-icon">close</span>
            </button>
          </div>
          <ComponentNode node={props.contentChild} surfaceId={surfaceId} />
        </section>
      </dialog>
    </div>
  );
});

export default Modal;
