'use client';

import { useState, useEffect } from 'react';

export function DemoModeBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if we're in demo mode by checking if DB_URL is missing or mock
    const checkDemoMode = async () => {
      try {
        const response = await fetch('/api/demo-mode-check');
        const data = await response.json();
        if (data.isDemoMode && !isDismissed) {
          setIsVisible(true);
        }
      } catch (error) {
        // Silently fail - banner won't show if API fails
      }
    };

    // Check on mount
    checkDemoMode();
  }, [isDismissed]);

  if (!isVisible) {
    return null;
  }

  const handleDismiss = () => {
    setIsDismissed(true);
    setIsVisible(false);
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500/90 backdrop-blur-sm text-black px-4 py-2 flex items-center justify-between shadow-lg border-b border-yellow-600">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-lg">🔧</span>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
          <span className="font-semibold">Demo Mode</span>
          <span className="text-sm">
            Using mock data - No API keys or database required for development
          </span>
        </div>
      </div>
      <button
        onClick={handleDismiss}
        className="p-1 hover:bg-yellow-600/30 rounded transition-colors flex-shrink-0"
        aria-label="Dismiss banner"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  );
}
