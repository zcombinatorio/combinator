import { useState } from 'react';
import Link from 'next/link';

interface TokenCardVSCodeProps {
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenAddress: string;
  creatorWallet: string;
  creatorTwitter?: string | null;
  creatorGithub?: string | null;
  metadata?: {
    name: string;
    symbol: string;
    image: string;
    website?: string;
    twitter?: string;
    description?: string;
  } | null;
  launchTime?: string;
  marketCap?: number;
  onClick?: () => void;
  isCreator?: boolean;
}

export function TokenCardVSCode({
  tokenName,
  tokenSymbol,
  tokenAddress,
  creatorTwitter,
  creatorGithub,
  metadata,
  launchTime,
  marketCap,
  onClick,
  isCreator = false,
}: TokenCardVSCodeProps) {
  const [copiedAddress, setCopiedAddress] = useState(false);

  const formatAddress = (address: string) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };

  const formatTime = (timestamp: string, includeSuffix = true) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    const suffix = includeSuffix ? ' ago' : '';

    if (diffDays > 0) {
      return `${diffDays}d${suffix}`;
    } else if (diffHours > 0) {
      return `${diffHours}h${suffix}`;
    } else {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes > 0 ? `${diffMinutes}m${suffix}` : 'just now';
    }
  };

  const formatMarketCap = (marketCap: number | undefined) => {
    if (!marketCap) return '-';
    if (marketCap >= 1_000_000) {
      return `$${(marketCap / 1_000_000).toFixed(2)}M`;
    } else if (marketCap >= 1_000) {
      return `$${(marketCap / 1_000).toFixed(2)}K`;
    }
    return `$${marketCap.toFixed(2)}`;
  };

  const handleCopyAddress = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(tokenAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const formatSocials = (twitter: string | null | undefined, github: string | null | undefined) => {
    const socials: string[] = [];

    if (twitter) {
      const twitterMatch = twitter.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/);
      const username = twitterMatch ? twitterMatch[1] : twitter;
      socials.push(`@${username}`);
    }

    if (github) {
      const githubMatch = github.match(/github\.com\/([A-Za-z0-9-]+)/);
      const username = githubMatch ? githubMatch[1] : github;
      socials.push(`gh:${username}`);
    }

    return socials.length > 0 ? socials.join(', ') : '-';
  };

  return (
    <div
      onClick={onClick}
      className={`pb-4 ${onClick ? 'cursor-pointer hover:opacity-80' : ''} transition-opacity`}
    >
      <div className="flex items-center gap-4">
        {/* Token Image */}
        {metadata?.image && (
          <div className="flex-shrink-0">
            <img
              src={metadata.image}
              alt={tokenName || 'Token'}
              className="w-12 h-12 md:w-16 md:h-16 rounded object-cover"
            />
          </div>
        )}

        {/* Token Info */}
        <div className="flex-1 min-w-0">
          {/* Name, Symbol, Market Cap, Time */}
          <div className="flex items-baseline gap-3 mb-1">
            {/* Mobile: Show only symbol */}
            <h3 className="md:hidden text-[14px] font-bold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--foreground)' }}>
              {tokenSymbol || '-'}
            </h3>
            {/* Mobile: CA inline with symbol */}
            <button
              onClick={(e) => handleCopyAddress(e)}
              className="md:hidden transition-colors flex items-center gap-1 text-[14px]"
              style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--foreground-secondary)' }}
            >
              {tokenAddress.slice(0, 6)}
              {copiedAddress ? (
                <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>
            {/* Desktop: Show name and symbol */}
            <h3 className="hidden md:block text-[14px] font-bold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--foreground)' }}>
              {tokenName || '-'}
            </h3>
            <span className="hidden md:inline text-[14px]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--foreground-secondary)' }}>
              ({tokenSymbol || '-'})
            </span>
            {marketCap !== undefined && (
              <span className="text-[14px] font-semibold" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--accent)' }}>
                {formatMarketCap(marketCap)}
              </span>
            )}
            {launchTime && (
              <span className="text-[14px]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--foreground-secondary)', opacity: 0.7 }}>
                <span className="md:hidden">{formatTime(launchTime, false)}</span>
                <span className="hidden md:inline">{formatTime(launchTime, true)}</span>
              </span>
            )}
            {isCreator && (
              <Link
                href="/portfolio"
                onClick={(e) => e.stopPropagation()}
                className="hidden md:inline text-[14px] transition-colors"
                style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--foreground-secondary)' }}
              >
                [Manage]
              </Link>
            )}
          </div>

          {/* Description */}
          {metadata?.description && (
            <p className="text-[14px] mb-1 line-clamp-2 md:line-clamp-none" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace', color: 'var(--foreground-secondary)' }}>
              {metadata.description}
            </p>
          )}

          {/* CA, Creator, Links */}
          <div className="flex items-center gap-4 text-[14px]" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            {/* CA - Desktop only (mobile shows inline with symbol) */}
            <button
              onClick={(e) => handleCopyAddress(e)}
              className="hidden md:flex transition-colors items-center gap-1"
              style={{ color: 'var(--foreground-secondary)' }}
            >
              CA: {formatAddress(tokenAddress)}
              {copiedAddress ? (
                <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </button>

            {/* Creator Socials */}
            <span style={{ color: 'var(--foreground-secondary)' }}>
              <span className="md:hidden">{formatSocials(creatorTwitter, creatorGithub)}</span>
              <span className="hidden md:inline">Creator: {formatSocials(creatorTwitter, creatorGithub)}</span>
            </span>

            {/* Links */}
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {metadata?.website && (
                <a
                  href={metadata.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors"
                  style={{ color: 'var(--foreground-secondary)' }}
                  title="Website"
                >
                  [web]
                </a>
              )}
              {metadata?.twitter && (
                <a
                  href={metadata.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors"
                  style={{ color: 'var(--foreground-secondary)' }}
                  title="Twitter"
                >
                  [x]
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
