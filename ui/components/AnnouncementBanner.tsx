'use client';

import { useState, useEffect } from 'react';

export function AnnouncementBanner() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    // Add delay before enabling transitions
    const timer = setTimeout(() => {
      setHasLoaded(true);
    }, 100);

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div className={`sticky top-0 z-50 bg-[#000000] ${hasLoaded ? 'transition-all duration-200 ease-in-out' : ''} ${isScrolled ? 'scale-y-0 opacity-0' : 'scale-y-100 opacity-100'} origin-top`}>
      <a
        href="https://x.com/zcombinatorio"
        target="_blank"
        rel="noopener noreferrer"
        className="w-full block group cursor-pointer"
      >
        <div className="px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-2.5 h-2.5 bg-[#EF6400] rounded-full animate-pulse shadow-[0_0_10px_#EF6400,0_0_20px_#EF640050]"></div>
              <div className="absolute inset-0 w-2.5 h-2.5 bg-[#EF6400] rounded-full animate-ping opacity-75"></div>
            </div>
            <span className="text-md bg-gradient-to-r from-gray-500 via-[#F7FCFE] to-gray-500 group-hover:from-gray-300 group-hover:via-[#F7FCFE] group-hover:to-gray-300 bg-clip-text text-transparent animate-shimmer bg-[length:200%_100%] transition-all">ACCEPTING ZC1 DEVS</span>
          </div>
          <div className="flex items-center gap-2 text-gray-300 group-hover:text-gray-200 transition-colors">
            <span className="text-md">DM TO APPLY</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
          </div>
        </div>
      </a>
    </div>
  );
}