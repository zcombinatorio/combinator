import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const faqs = [
  {
    question: 'Why are all ZC launched tokens (including $ZC) mintable?',
    answer: 'Only the ZC protocol (NOT the token dev) can mint tokens. It will do so automatically at the end of each Quantum Market to pay users whose PRs get merged. This aligns incentives with token price growth, rewarding all users who create value.',
  },
  {
    question: 'What is the utility of $ZC?',
    answer: '$ZC represents a stake in the Z Combinator treasury, which receives a portion of all token mints from platform launches. Other launched tokens on ZC have utilities as determined by their founders. More $ZC utilities coming soon.',
  },
  {
    question: 'How does staking work? What are the rewards for staking?',
    answer: 'All ZC launched tokens will have native staking. Users who lock their tokens in the vault will earn rewards from protocol-minted tokens. Currently only available for $ZC and $oogway.',
  },
  {
    question: 'Are there trading fees?',
    answer: 'There are no trading fees for any ZC launched token currently.',
  },
  {
    question: "As a dev, isn't it weird that I have to dump my tokens to fund myself?",
    answer: 'Projects relying on trading fees are unsustainable. Controlled token emissions let founders fuel growth through incentives, creating long-term value. Both users and founders get rich by contributing to and sharing ownership of a valuable project.',
  },
];

export default function FaqPage() {
  return (
    <Container>
      <div className="mb-12">
        <h1 style={{ color: 'var(--foreground)' }}>Frequently Asked Questions</h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Everything you need to know about Z Combinator
        </p>
      </div>

      <div className="space-y-6 mb-20">
        {faqs.map((faq, index) => (
          <Card key={index} variant="bordered">
            <CardHeader>
              <CardTitle>{faq.question}</CardTitle>
            </CardHeader>
            <CardContent>
              <p style={{ color: 'var(--foreground-secondary)' }}>
                {faq.answer}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mb-20">
        <h2 style={{ color: 'var(--foreground)' }}>How can you get involved?</h2>

        <div className="grid md:grid-cols-2 gap-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>For Founders</CardTitle>
            </CardHeader>
            <CardContent>
              <p style={{ color: 'var(--foreground-secondary)' }}>
                Launch a ZC token and follow the steps on the{' '}
                <Link href="/" className="text-accent hover:underline">
                  landing page
                </Link>
                .
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>For Contributors</CardTitle>
            </CardHeader>
            <CardContent>
              <p style={{ color: 'var(--foreground-secondary)' }}>
                Submit PRs to and trade Quantum Markets for any ZC launched project (
                <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  including ZC itself
                </a>
                !) to earn substantial token rewards.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="text-center py-12 rounded-2xl" style={{ backgroundColor: 'var(--background-secondary)' }}>
        <h2 className="mb-4" style={{ color: 'var(--foreground)' }}>
          Have Other Questions?
        </h2>
        <p className="mb-6" style={{ color: 'var(--foreground-secondary)' }}>
          Join our Discord community and ask away
        </p>
        <a href="https://discord.gg/MQfcX9QM2r" target="_blank" rel="noopener noreferrer" className="inline-block px-6 py-3 rounded-lg font-medium text-white transition-all hover:opacity-90" style={{ backgroundColor: 'var(--accent)' }}>
          Join Discord
        </a>
      </div>
    </Container>
  );
}