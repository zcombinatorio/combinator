'use client';

import { useEffect, useRef, ReactNode } from 'react';

interface ScrollRevealProps {
  children: ReactNode;
  variant?: 'fade-in' | 'fade-in-up';
  delay?: number;
  className?: string;
}

export function ScrollReveal({
  children,
  variant = 'fade-in-up',
  delay = 0,
  className = '',
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Check if IntersectionObserver is available (client-side only)
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      element.classList.add('scroll-animate-active');
      return;
    }

    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      element.classList.add('scroll-animate-active');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Add a small delay if specified
            setTimeout(() => {
              entry.target.classList.add('scroll-animate-active');
            }, delay);
            // Once animated, stop observing
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1, // Trigger when 10% of element is visible
        rootMargin: '0px 0px -50px 0px', // Trigger slightly before element enters viewport
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [delay]);

  return (
    <div ref={ref} className={`scroll-animate ${variant} ${className}`}>
      {children}
    </div>
  );
}
