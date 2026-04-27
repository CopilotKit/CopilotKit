import { useRef, useState, useCallback, useEffect } from 'react';

const DRAG_INTENT_THRESHOLD = 10;
const DRAG_DISMISS_THRESHOLD = 100;

interface UseSwipeToDismissOptions {
  enabled: boolean;
  sheetRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  topBoundaryRef: React.RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
}

export function useSwipeToDismiss({
  enabled,
  sheetRef,
  scrollRef,
  topBoundaryRef,
  onDismiss,
}: UseSwipeToDismissOptions) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const dragYRef = useRef(0);
  const isAtTop = useRef(false);
  const wasAtTopOnTouchStart = useRef(false);
  const pointerStartY = useRef(0);
  const isDismissGesture = useRef(false);

  const resetTouchState = useCallback(() => {
    setIsDragging(false);
    setDragY(0);
    dragYRef.current = 0;
    isDismissGesture.current = false;
    pointerStartY.current = 0;
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;

    setIsDragging(false);
    setDragY(0);
    dragYRef.current = 0;
    isDismissGesture.current = false;
    wasAtTopOnTouchStart.current = isAtTop.current;
    pointerStartY.current = touch.clientY;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;

    const deltaY = touch.clientY - pointerStartY.current;

    if (isDismissGesture.current) {
      e.preventDefault();
      const clamped = Math.max(0, deltaY);
      dragYRef.current = clamped;
      setDragY(clamped);
      return;
    }

    if (deltaY <= DRAG_INTENT_THRESHOLD || !wasAtTopOnTouchStart.current) {
      return;
    }

    isDismissGesture.current = true;
    setIsDragging(true);
    e.preventDefault();
    dragYRef.current = deltaY;
    setDragY(deltaY);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (isDismissGesture.current && dragYRef.current > DRAG_DISMISS_THRESHOLD) {
      onDismiss();
    }
    resetTouchState();
  }, [onDismiss, resetTouchState]);

  const handleTouchCancel = useCallback(() => {
    resetTouchState();
  }, [resetTouchState]);

  useEffect(() => {
    if (!enabled) return;

    const scrollContainer = scrollRef.current;
    const sentinel = topBoundaryRef.current;
    if (!scrollContainer || !sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isAtTop.current = entry?.isIntersecting ?? false;
      },
      {
        root: scrollContainer,
        threshold: 0.1,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, scrollRef, topBoundaryRef]);

  useEffect(() => {
    if (!enabled || !sheetRef.current) return;

    const element = sheetRef.current;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);
    element.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [
    enabled,
    sheetRef,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
  ]);

  return { dragY, isDragging };
}
