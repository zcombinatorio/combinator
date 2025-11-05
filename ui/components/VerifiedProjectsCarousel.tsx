'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface TokenLaunch {
  id: number;
  token_address: string;
  token_symbol: string | null;
  token_metadata_url: string;
  verified?: boolean;
}

interface TokenMetadata {
  name: string;
  symbol: string;
  image: string;
}

export function VerifiedProjectsCarousel() {
  const [projects, setProjects] = useState<TokenLaunch[]>([]);
  const [metadata, setMetadata] = useState<Record<string, TokenMetadata>>({});
  const [isPaused, setIsPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchVerifiedProjects();
  }, []);

  const fetchVerifiedProjects = async () => {
    try {
      const response = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: false })
      });

      if (response.ok) {
        const data = await response.json();
        // Filter verified projects and shuffle, then take 20
        const verified = data.tokens
          .filter((token: TokenLaunch) => token.verified)
          .sort(() => Math.random() - 0.5)
          .slice(0, 20);

        setProjects(verified);

        // Fetch metadata for each project
        verified.forEach((token: TokenLaunch) => {
          fetchTokenMetadata(token.token_address, token.token_metadata_url);
        });
      }
    } catch (error) {
      console.error('Error fetching verified projects:', error);
    }
  };

  const fetchTokenMetadata = async (tokenAddress: string, metadataUrl: string) => {
    try {
      const response = await fetch(metadataUrl);
      if (response.ok) {
        const meta: TokenMetadata = await response.json();
        setMetadata(prev => ({
          ...prev,
          [tokenAddress]: meta
        }));
      }
    } catch (error) {
      console.error(`Error fetching metadata for ${tokenAddress}:`, error);
    }
  };

  const handleScroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 250;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  if (projects.length === 0) return null;

  // Duplicate the projects array to create seamless loop
  const duplicatedProjects = [...projects, ...projects, ...projects];

  return (
    <div className="w-full overflow-hidden py-6 border-y" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background-secondary)' }}>
      <div className="mb-4 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full" style={{ backgroundColor: 'var(--background-tertiary)' }}>
          {/* Shield check icon */}
          <svg className="w-4 h-4" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
            Verified Projects
          </span>
        </div>
      </div>

      <div className="relative group">
        {/* Navigation arrows */}
        <button
          onClick={() => handleScroll('left')}
          onFocus={() => setIsPaused(true)}
          onBlur={() => setIsPaused(false)}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 focus:opacity-100"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
          aria-label="Scroll left"
        >
          <svg className="w-5 h-5 mx-auto" style={{ color: 'var(--foreground)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={() => handleScroll('right')}
          onFocus={() => setIsPaused(true)}
          onBlur={() => setIsPaused(false)}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 focus:opacity-100"
          style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
          aria-label="Scroll right"
        >
          <svg className="w-5 h-5 mx-auto" style={{ color: 'var(--foreground)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div
          ref={scrollRef}
          className="flex overflow-x-auto scrollbar-hide gap-4 px-4"
          style={{ scrollBehavior: 'smooth' }}
        >
          <div
            className={`flex gap-4 ${!isPaused ? 'animate-scroll' : ''}`}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
          >
            {duplicatedProjects.map((project, index) => {
              const meta = metadata[project.token_address];
              if (!meta) return null;

              return (
                <Link
                  key={`${project.token_address}-${index}`}
                  href={`/history/${project.token_address}`}
                  className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all duration-150 hover:shadow-md hover:-translate-y-[2px] focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    backgroundColor: 'var(--background)',
                    borderColor: 'var(--border)',
                    minWidth: '180px',
                    maxWidth: '220px'
                  }}
                  onFocus={() => setIsPaused(true)}
                  onBlur={() => setIsPaused(false)}
                >
                  <div className="relative w-9 h-9 rounded-full overflow-hidden flex-shrink-0 ring-1" style={{ backgroundColor: 'var(--background-tertiary)', ringColor: 'var(--border)' }}>
                    {meta.image && (
                      <Image
                        src={meta.image}
                        alt={meta.symbol}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--foreground)' }}>
                      {meta.symbol}
                    </span>
                    <span className="text-xs truncate" style={{ color: 'var(--foreground-secondary)' }}>
                      {meta.name}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
