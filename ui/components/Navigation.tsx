'use client';

import { useState } from 'react';
import Link from "next/link";
import { useWallet } from '@/components/WalletProvider';
import { usePathname } from 'next/navigation';

export function Navigation() {
  const { isPrivyAuthenticated } = useWallet();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const linkClasses = (path: string) => `
    text-lg font-medium transition-all cursor-pointer block py-3 px-4
    ${pathname === path
      ? 'text-[#F7FCFE] border-b-2 border-[#F7FCFE]'
      : 'text-gray-300 hover:text-[#F7FCFE]'}
  `;

  const externalLinkClasses = `
    text-sm font-medium text-gray-300-temp hover:text-gray-300 transition-colors cursor-pointer block py-2 px-4
  `;

  return (
    <>
      {/* Menu Button (always visible) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-20 right-12 z-50 bg-black p-3 rounded-xl border border-gray-800 hover:border-gray-600 transition-colors shadow-lg"
        aria-label="Toggle menu"
      >
        <svg
          className="w-6 h-6 text-[#F7FCFE]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {isOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Click-to-close area */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Navigation Sidebar */}
      <nav
        className={`
          fixed top-0 right-0 h-screen bg-[#000000] z-40
          transition-transform duration-300 ease-in-out
          w-72 lg:w-80
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          px-0 sm:px-4 pt-16
        `}
      >
        <div className="bg-[#141414] h-full rounded-none sm:rounded-l-4xl border-l border-gray-800">
          <div className="flex flex-col h-full py-6 px-8 overflow-y-auto">
            {/* Logo/Title */}
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-[#F7FCFE]">𝓩 Menu</h2>
            </div>

            {/* Main Navigation */}
            <div className="flex-1 space-y-2">
            <Link href="/" className={linkClasses('/')} onClick={() => setIsOpen(false)}>
              Home
            </Link>
            <Link href="/faq" className={linkClasses('/faq')} onClick={() => setIsOpen(false)}>
              FAQ
            </Link>
            <Link href="/dev-faq" className={linkClasses('/dev-faq')} onClick={() => setIsOpen(false)}>
              Developer FAQ
            </Link>
            <Link href="/tokens" className={linkClasses('/tokens')} onClick={() => setIsOpen(false)}>
              Projects
            </Link>
            <Link href="/launch" className={linkClasses('/launch')} onClick={() => setIsOpen(false)}>
              Launch
            </Link>
            <Link href="/swap" className={linkClasses('/swap')} onClick={() => setIsOpen(false)}>
              Swap
            </Link>
            <Link href="/stake" className={linkClasses('/stake')} onClick={() => setIsOpen(false)}>
              Stake
            </Link>
            {!isPrivyAuthenticated && (
              <Link href="/claim" className={linkClasses('/claim')} onClick={() => setIsOpen(false)}>
                Claim
              </Link>
            )}
            {isPrivyAuthenticated && (
              <Link href="/manage" className={linkClasses('/manage')} onClick={() => setIsOpen(false)}>
                Portfolio
              </Link>
            )}
            {isPrivyAuthenticated && (
              <Link href="/verify" className={linkClasses('/verify')} onClick={() => setIsOpen(false)}>
                Account
              </Link>
            )}
          </div>

          {/* External Links Section */}
          <div className="mt-auto pt-8 border-t border-gray-800 space-y-1">
            <p className="text-xs font-semibold text-gray-300-temp uppercase tracking-wider mb-3 px-4">Links</p>
            <a
              href="https://docs.zcombinator.io"
              target="_blank"
              rel="noopener noreferrer"
              className={externalLinkClasses}
            >
              API Docs
            </a>
            <a
              href="https://x.com/zcombinatorio"
              target="_blank"
              rel="noopener noreferrer"
              className={externalLinkClasses}
            >
              Twitter/X
            </a>
            <a
              href="https://discord.gg/MQfcX9QM2r"
              target="_blank"
              rel="noopener noreferrer"
              className={externalLinkClasses}
            >
              Discord
            </a>
          </div>
          </div>
        </div>
      </nav>
    </>
  );
}