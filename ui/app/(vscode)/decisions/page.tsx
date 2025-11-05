import { Container } from '@/components/ui/Container';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Callout';
import { Button } from '@/components/ui/Button';

export default function DecisionsPage() {
  return (
    <Container>
      <div className="mb-12">
        <h1 style={{ color: 'var(--foreground)' }}>Decision Markets</h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Participate in markets that shape the future of $ZC
        </p>
      </div>

      <div className="mb-12">
        <Card variant="bordered">
          <CardHeader>
            <CardTitle>What are Decision Markets?</CardTitle>
          </CardHeader>
          <CardContent>
            <p style={{ color: 'var(--foreground-secondary)' }} className="mb-4">
              Decision markets allow the community to weigh in on important protocol decisions through prediction markets.
              By trading in these markets, you signal your confidence in different outcomes and help guide the project&apos;s direction.
            </p>
            <p style={{ color: 'var(--foreground-secondary)' }}>
              These markets directly impact $ZC price movements, so trade thoughtfully to protect and grow your investment.
            </p>
          </CardContent>
        </Card>
      </div>

      <Callout variant="warning" title="Important">
        <p className="mb-2">
          Trading in decision markets will affect $ZC price. Make informed decisions to protect your holdings.
        </p>
      </Callout>

      <div className="text-center py-12 rounded-2xl mt-12" style={{ backgroundColor: 'var(--background-secondary)' }}>
        <h2 className="mb-4" style={{ color: 'var(--foreground)' }}>
          Ready to Participate?
        </h2>
        <p className="mb-6" style={{ color: 'var(--foreground-secondary)' }}>
          Visit the decision markets platform to start trading
        </p>
        <a href="https://zc.percent.markets/" target="_blank" rel="noopener noreferrer">
          <Button variant="primary" size="lg">
            Go to Decision Markets
          </Button>
        </a>
      </div>
    </Container>
  );
}
