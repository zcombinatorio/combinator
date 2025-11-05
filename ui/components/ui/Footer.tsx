'use client';

import Link from 'next/link';
import { useState } from 'react';

const FOOTER_LINKS = {
  Product: [
    { name: 'Home', href: '/' },
    { name: 'Projects', href: '/projects' },
    { name: 'Launch', href: '/launch' },
    { name: 'Swap', href: '/swap' },
    { name: 'Stake', href: '/stake' },
    { name: 'Claim', href: '/claim' },
  ],
  Resources: [
    { name: 'FAQ', href: '/faq' },
    { name: 'Decisions', href: '/decisions' },
    { name: 'Contributions', href: '/contributions' },
    { name: 'Docs', href: 'https://docs.zcombinator.io', external: true },
  ],
  Community: [
    { name: 'Discord', href: 'https://discord.gg/MQfcX9QM2r', external: true },
    { name: 'Twitter/X', href: 'https://x.com/zcombinatorio', external: true },
    { name: 'GitHub', href: 'https://github.com/zcombinatorio/zcombinator', external: true },
  ],
};

export function SiteFooter() {
  const [copiedCA, setCopiedCA] = useState(false);

  const copyCA = async () => {
    await navigator.clipboard.writeText('GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC');
    setCopiedCA(true);
    setTimeout(() => setCopiedCA(false), 2000);
  };

  return (
    <footer className="border-t mt-24" style={{
      backgroundColor: 'var(--background)',
      borderColor: 'var(--border)'
    }}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        {/* Top section */}
        <div className="grid grid-cols-2 gap-8 md:gap-12 md:grid-cols-5">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>Z Combinator</span>
            </div>
            <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
              A launchpad that helps founders hit PMF.
            </p>
            <button
              onClick={copyCA}
              className="text-sm font-mono px-3 py-1.5 rounded-md border transition-all duration-200 hover:scale-105 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2"
              style={{
                color: 'var(--foreground-secondary)',
                borderColor: 'var(--border)',
                backgroundColor: copiedCA ? 'var(--background-tertiary)' : 'transparent'
              }}
              aria-label="Copy ZC contract address"
            >
              {copiedCA ? '✓ Copied' : '$ZC CA'}
            </button>
          </div>

          {/* Link columns */}
          {Object.entries(FOOTER_LINKS).map(([category, links]) => (
            <div key={category} className={category === 'Product' ? 'col-span-2 md:col-span-2' : ''}>
              <h3 className="font-semibold mb-4" style={{ color: 'var(--foreground)' }}>
                {category}
              </h3>
              <ul className={category === 'Product' ? 'grid grid-cols-2 gap-x-4 gap-y-3.5' : 'space-y-3.5'}>
                {links.map((link) => (
                  <li key={link.name}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm transition-all duration-200 hover:text-accent hover:translate-x-0.5 inline-flex items-center gap-1 focus:outline-none focus:text-accent"
                        style={{ color: 'var(--foreground-secondary)' }}
                        aria-label={`${link.name} (opens in new tab)`}
                      >
                        {link.name}
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm transition-all duration-200 hover:text-accent hover:translate-x-0.5 inline-block focus:outline-none focus:text-accent"
                        style={{ color: 'var(--foreground-secondary)' }}
                      >
                        {link.name}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom section */}
        <div className="mt-14 pt-8 border-t flex flex-col sm:flex-row justify-between items-center gap-4" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
            © {new Date().getFullYear()} Z Combinator. Open source on{' '}
            <a
              href="https://github.com/zcombinatorio/zcombinator"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-accent transition-colors duration-200 focus:outline-none focus:text-accent"
              aria-label="Z Combinator GitHub repository (opens in new tab)"
            >
              GitHub
            </a>
            .
          </p>
          <div className="flex items-center gap-5">
            <a
              href="https://discord.gg/MQfcX9QM2r"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-all duration-200 hover:text-accent hover:scale-110 focus:outline-none focus:text-accent focus:scale-110"
              style={{ color: 'var(--foreground-secondary)' }}
              aria-label="Join Discord community (opens in new tab)"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13.545 2.907a13.227 13.227 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.19 12.19 0 0 0-3.658 0 8.258 8.258 0 0 0-.412-.833.051.051 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.041.041 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.276 13.276 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.051.051 0 0 0-.018-.011 8.875 8.875 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.051.051 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.052.052 0 0 1 .053.007c.08.066.164.132.248.195a.051.051 0 0 1-.004.085 8.254 8.254 0 0 1-1.249.594.05.05 0 0 0-.03.03.052.052 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.235 13.235 0 0 0 4.001-2.02.049.049 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.034.034 0 0 0-.02-.019Zm-8.198 7.307c-.789 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612Zm5.316 0c-.788 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612Z"/>
              </svg>
            </a>
            <a
              href="https://x.com/zcombinatorio"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-all duration-200 hover:text-accent hover:scale-110 focus:outline-none focus:text-accent focus:scale-110"
              style={{ color: 'var(--foreground-secondary)' }}
              aria-label="Follow on Twitter/X (opens in new tab)"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            <a
              href="https://github.com/zcombinatorio/zcombinator"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-all duration-200 hover:text-accent hover:scale-110 focus:outline-none focus:text-accent focus:scale-110"
              style={{ color: 'var(--foreground-secondary)' }}
              aria-label="View on GitHub (opens in new tab)"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
