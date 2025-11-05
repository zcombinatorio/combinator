'use client';

import { useState, useEffect } from 'react';
import { Container } from '@/components/ui/Container';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

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
      <Container>
        <h1 style={{ color: 'var(--foreground)' }}>Contributions</h1>
        <p style={{ color: 'var(--foreground-secondary)' }}>Loading contributions...</p>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <h1 style={{ color: 'var(--foreground)' }}>Contributions</h1>
        <p style={{ color: '#EF4444' }}>{error}</p>
      </Container>
    );
  }

  const totalRewards = contributions.reduce((sum, contribution) => {
    return sum + parseFloat(contribution.reward_zc);
  }, 0);

  const totalRewardsUSD = contributions.reduce((sum, contribution) => {
    return sum + parseFloat(contribution.reward_usd);
  }, 0);

  return (
    <Container>
      <div className="mb-8">
        <h1 style={{ color: 'var(--foreground)' }}>Contributions</h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Community members who have contributed to the protocol and been rewarded
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-12">
        <Card variant="bordered">
          <CardHeader>
            <CardTitle>Total Rewards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>
                {formatNumber(totalRewards.toString())}
              </span>
              <span className="text-lg" style={{ color: 'var(--foreground)' }}>$ZC</span>
            </div>
            <p className="text-sm mt-2" style={{ color: 'var(--foreground-secondary)' }}>
              ${formatUSD(totalRewardsUSD.toString())} USD
            </p>
          </CardContent>
        </Card>

        <Card variant="bordered">
          <CardHeader>
            <CardTitle>Total Contributions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>
                {contributions.length}
              </span>
              <span className="text-lg" style={{ color: 'var(--foreground)' }}>PRs</span>
            </div>
            <p className="text-sm mt-2" style={{ color: 'var(--foreground-secondary)' }}>
              Accepted pull requests
            </p>
          </CardContent>
        </Card>
      </div>

      {contributions.length === 0 ? (
        <p style={{ color: 'var(--foreground-secondary)' }}>
          No contributions yet
        </p>
      ) : (
        <div className="space-y-3">
          {contributions.map((contribution, index) => (
            <Card key={contribution.id} variant="bordered" padding="md">
              {/* Desktop Layout */}
              <div className="hidden md:flex md:items-center md:justify-between">
                <div className="flex items-center gap-6 flex-1">
                  <span className="text-sm font-medium" style={{ color: 'var(--foreground-secondary)' }}>
                    #{contributions.length - index}
                  </span>
                  <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                    {contribution.discord_id}
                  </span>
                  <a
                    href={contribution.pr}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    PR #{contribution.pr.split('/').slice(-1)[0]}
                  </a>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="font-semibold" style={{ color: 'var(--foreground)' }}>
                      {formatNumber(contribution.reward_zc)} $ZC
                    </div>
                    <div className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                      ${formatUSD(contribution.reward_usd)}
                    </div>
                  </div>
                  <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                    {formatDate(contribution.time)}
                  </span>
                </div>
              </div>

              {/* Mobile Layout */}
              <div className="md:hidden space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--foreground-secondary)' }}>
                      #{contributions.length - index}
                    </span>
                    <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                      {contribution.discord_id}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>
                      {formatNumber(contribution.reward_zc)} $ZC
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <a
                    href={contribution.pr}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    PR #{contribution.pr.split('/').slice(-1)[0]}
                  </a>
                  <span style={{ color: 'var(--foreground-secondary)' }}>
                    ${formatUSD(contribution.reward_usd)}
                  </span>
                </div>
                <div className="text-xs" style={{ color: 'var(--foreground-secondary)' }}>
                  {formatDate(contribution.time)}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Container>
  );
}
