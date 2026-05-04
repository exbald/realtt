"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UseAutoScrollOptions {
  /** Threshold in pixels from bottom to consider "at bottom" */
  threshold?: number;
}

interface UseAutoScrollReturn {
  /** Ref to attach to the scrollable container */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether the user is currently at the bottom of the container */
  isAtBottom: boolean;
  /** Whether to show the "scroll to bottom" indicator */
  showScrollToBottom: boolean;
  /** Programmatically scroll to bottom */
  scrollToBottom: () => void;
  /** Number of new items that arrived while user was scrolled up */
  newItemsCount: number;
  /** Notify the hook that content has changed (e.g., new segments) */
  notifyContentChange: (itemCount?: number) => void;
}

/**
 * Hook for managing auto-scroll behavior in a scrollable container.
 *
 * - Auto-scrolls to bottom when new content arrives (if user is at bottom)
 * - Detects when user manually scrolls up and pauses auto-scroll
 * - Provides a "scroll to bottom" indicator with count of new items
 * - Resumes auto-scroll when user scrolls back to bottom or clicks the indicator
 *
 * Usage:
 * 1. Attach scrollContainerRef to your scrollable div
 * 2. Call notifyContentChange() whenever items are added
 * 3. Show showScrollToBottom indicator when true
 * 4. Call scrollToBottom() from your indicator button
 */
export function useAutoScroll({
  threshold = 80,
}: UseAutoScrollOptions = {}): UseAutoScrollReturn {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newItemsCount, setNewItemsCount] = useState(0);
  const isAutoScrollingRef = useRef(false);
  const wasAtBottomRef = useRef(true);

  const checkIsAtBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight <= threshold;
  }, [threshold]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isAutoScrollingRef.current = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
    setIsAtBottom(true);
    setNewItemsCount(0);
    wasAtBottomRef.current = true;
    // Reset auto-scrolling flag after animation completes
    setTimeout(() => {
      isAutoScrollingRef.current = false;
    }, 500);
  }, []);

  // Listen for scroll events to detect manual scrolling
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Ignore scroll events triggered by our own auto-scroll
      if (isAutoScrollingRef.current) return;

      const atBottom = checkIsAtBottom();
      setIsAtBottom(atBottom);

      if (atBottom) {
        // User scrolled back to bottom - resume auto-scroll
        wasAtBottomRef.current = true;
        setNewItemsCount(0);
      } else if (wasAtBottomRef.current) {
        // User scrolled up from bottom - pause auto-scroll
        wasAtBottomRef.current = false;
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [checkIsAtBottom]);

  const notifyContentChange = useCallback(
    (itemCount: number = 1) => {
      if (wasAtBottomRef.current) {
        // User is at bottom - auto-scroll to new content
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      } else {
        // User is scrolled up - increment new items counter
        setNewItemsCount((prev) => prev + itemCount);
      }
    },
    [scrollToBottom]
  );

  return {
    scrollContainerRef,
    isAtBottom,
    showScrollToBottom: !isAtBottom && newItemsCount > 0,
    scrollToBottom,
    newItemsCount,
    notifyContentChange,
  };
}
