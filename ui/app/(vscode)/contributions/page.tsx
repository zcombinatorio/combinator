'use client';

import { useState, useEffect } from 'react';

interface Contribution {
  id: number;
  discord_id: string;
  pr: string;
  reward_zc: string;
  reward_usd: string;
  time: number;
  created_at: string;
}

export default function ContributionsPage() {
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchContributions = async () => {
      try {
        const response = await fetch('/api/contributions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await response.json();

        if (response.ok) {
          setContributions(data.contributions || []);
        } else {
          setError(data.error || 'Failed to fetch contributions');
        }
      } catch (error) {
        console.error('Error fetching contributions:', error);
        setError('Failed to load contributions');
      } finally {
        setLoading(false);
      }
    };

    fetchContributions();
  }, []);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatNumber = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return '--';

    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(2)}B`;
    } else if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(2)}K`;
    }
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const formatUSD = (value: string) => {
    const num = parseFloat(value);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-7xl font-bold">Contributions</h1>
        <p className="mt-7 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Loading contributions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h1 className="text-7xl font-bold">Contributions</h1>
        <p className="mt-7 text-[14px] text-red-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{error}</p>
      </div>
    );
  }

  const totalRewards = contributions.reduce((sum, contribution) => {
    return sum + parseFloat(contribution.reward_zc);
  }, 0);

  const totalRewardsUSD = contributions.reduce((sum, contribution) => {
    return sum + parseFloat(contribution.reward_usd);
  }, 0);

  return (
    <div>
      <h1 className="text-7xl font-bold">Contributions</h1>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
        {'//'}Contributions made, accepted and rewarded by ZC community members
      </p>

      <div className="mt-7">
        <div className="flex flex-col gap-1 mb-6.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Total Rewards:</span>
            <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{formatNumber(totalRewards.toString())} $ZC</span>
            <span className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
              (${formatUSD(totalRewardsUSD.toString())})
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Total Contributions:</span>
            <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{contributions.length}</span>
          </div>
        </div>
      </div>

      {contributions.length === 0 ? (
        <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
          No contributions yet
        </p>
      ) : (
        <div className="space-y-0 mt-0 max-w-5xl">
          {contributions.map((contribution, index) => (
            <div key={contribution.id} className="pb-0.5">
              {/* Desktop Layout */}
              <div className="hidden md:block">
                <div className="flex items-baseline gap-4">
                  <span className="text-[14px] text-gray-300 w-8" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    #{contributions.length - index}
                  </span>
                  <span className="text-[14px] text-white w-32 truncate" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    {contribution.discord_id}
                  </span>
                  <div className="flex items-baseline gap-2 w-16">
                    <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                      PR:
                    </span>
                    <a
                      href={contribution.pr}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[14px] text-[#b2e9fe] hover:text-white underline"
                      style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                    >
                      {contribution.pr.split('/').slice(-1)[0]}
                    </a>
                  </div>
                  <div className="flex items-baseline gap-2 w-52">
                    <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                      {formatNumber(contribution.reward_zc)} $ZC
                    </span>
                    <span className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                      (${formatUSD(contribution.reward_usd)})
                    </span>
                  </div>
                  <span className="text-[14px] text-gray-400" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    {formatDate(contribution.time)}
                  </span>
                </div>
              </div>

              {/* Mobile Layout */}
              <div className="md:hidden">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    #{contributions.length - index}
                  </span>
                  <span className="text-[14px] text-white truncate" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    {contribution.discord_id}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mt-0.5 ml-4">
                  <a
                    href={contribution.pr}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[14px] text-[#b2e9fe] hover:text-white underline"
                    style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
                  >
                    PR #{contribution.pr.split('/').slice(-1)[0]}
                  </a>
                </div>
                <div className="flex items-baseline gap-2 mt-0.5 ml-4">
                  <span className="text-[14px] text-white" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    {formatNumber(contribution.reward_zc)} $ZC
                  </span>
                  <span className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                    (${formatUSD(contribution.reward_usd)})
                  </span>
                </div>
                <div className="text-[14px] text-gray-400 mt-0.5 ml-4" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
                  {formatDate(contribution.time)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
