'use client';

import { useState } from 'react';
import Image from 'next/image';

export function Footer() {
  const [copied, setCopied] = useState(false);

  const handleCopyCA = async () => {
    await navigator.clipboard.writeText('GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC');
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <footer
      className="fixed bottom-0 left-0 right-0 z-20 flex items-center justify-between"
      style={{
        height: '28px',
        backgroundColor: '#0E0E0E'
      }}
    >
      {/* Logo on left side */}
      <div
        className="flex items-center justify-center"
        style={{
          backgroundColor: '#FFFFFF',
          height: '28px',
          width: '40px'
        }}
      >
        <Image
          src="/logos/z-logo-black.png"
          alt="Z"
          width={14}
          height={14}
          style={{ width: '14px', height: '14px' }}
        />
      </div>

      {/* Links on right side */}
      <div className="flex items-center gap-4 pr-4">
        <button
          onClick={handleCopyCA}
          className="opacity-40 hover:opacity-100 transition-opacity cursor-pointer font-semibold"
          style={{
            fontSize: '12px',
            color: '#C5C5C5'
          }}
          title="Copy contract address"
        >
          {copied ? 'Copied CA' : '$ZC (GVvPZp)'}
        </button>
        <a
          href="https://docs.zcombinator.io"
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-40 hover:opacity-100 transition-opacity"
          style={{ transform: 'translateY(-1px)' }}
          title="Documentation"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4.5V13.5C4 14.0523 4.44772 14.5 5 14.5H12C12.5523 14.5 13 14.0523 13 13.5V6.5L10 3.5H5C4.44772 3.5 4 3.94772 4 4.5Z" stroke="#C5C5C5" fill="none" strokeWidth="1"/>
            <path d="M10 3.5V6.5H13" stroke="#C5C5C5" fill="none" strokeWidth="1"/>
            <line x1="6" y1="8" x2="11" y2="8" stroke="#C5C5C5" strokeWidth="1"/>
            <line x1="6" y1="10" x2="11" y2="10" stroke="#C5C5C5" strokeWidth="1"/>
            <line x1="6" y1="12" x2="9" y2="12" stroke="#C5C5C5" strokeWidth="1"/>
          </svg>
        </a>

        <a
          href="https://github.com/zcombinatorio/zcombinator"
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-40 hover:opacity-100 transition-opacity"
          title="GitHub"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="#C5C5C5" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>

        <a
          href="https://x.com/zcombinatorio"
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-40 hover:opacity-100 transition-opacity"
          title="Twitter/X"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#C5C5C5" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>

        <a
          href="https://discord.gg/MQfcX9QM2r"
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-40 hover:opacity-100 transition-opacity"
          title="Discord"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="#C5C5C5" xmlns="http://www.w3.org/2000/svg">
            <path d="M13.545 2.907a13.227 13.227 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.19 12.19 0 0 0-3.658 0 8.258 8.258 0 0 0-.412-.833.051.051 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.041.041 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.276 13.276 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.051.051 0 0 0-.018-.011 8.875 8.875 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.051.051 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.052.052 0 0 1 .053.007c.08.066.164.132.248.195a.051.051 0 0 1-.004.085 8.254 8.254 0 0 1-1.249.594.05.05 0 0 0-.03.03.052.052 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.235 13.235 0 0 0 4.001-2.02.049.049 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.034.034 0 0 0-.02-.019Zm-8.198 7.307c-.789 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612Zm5.316 0c-.788 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612Z"/>
          </svg>
        </a>
      </div>
    </footer>
  );
}
