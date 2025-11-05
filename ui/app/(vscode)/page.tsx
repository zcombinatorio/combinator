import Image from 'next/image';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Callout';
import { VerifiedProjectsCarousel } from '@/components/VerifiedProjectsCarousel';
import { ScrollReveal } from '@/components/ui/ScrollReveal';

export default function LandingPage() {
  return (
    <>
      {/* Hero Section */}
      <div className="relative overflow-hidden" style={{ minHeight: '80vh' }}>
        {/* Background decoration - fills entire hero */}
        <div className="absolute inset-0" style={{ zIndex: 0 }}>
          {/* Animated blur blobs */}
          <div className="hero-blur-container" />
          <div className="absolute inset-0 hero-gradient" />
          <div className="absolute inset-0 opacity-20 hero-dots" />
          {/* Animated particles */}
          <div className="hero-particles">
            <div className="hero-particle" />
            <div className="hero-particle" />
            <div className="hero-particle" />
            <div className="hero-particle" />
            <div className="hero-particle" />
            <div className="hero-particle" />
          </div>
        </div>

        <Container>
          <div className="py-16 md:py-24 relative" style={{ zIndex: 1 }}>
            {/* Elevated hero panel */}
            <div className="rounded-3xl ring-1 shadow-sm p-8 md:p-12 lg:p-16" style={{
              backgroundColor: 'rgba(var(--background-rgb, 255, 255, 255), 0.4)',
              ringColor: 'var(--border)',
              backdropFilter: 'blur(8px)'
            }}>
              <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
                {/* Left Column - Content */}
                <div className="text-center lg:text-left">
                  <h1 className="text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold mb-6"
                    style={{
                      color: 'var(--foreground)',
                      letterSpacing: '-0.03em',
                      lineHeight: '1.1'
                    }}>
                    A launchpad that helps founders hit product-market fit
                  </h1>
                  <p className="text-xl md:text-2xl mb-8 max-w-prose mx-auto lg:mx-0"
                    style={{
                      color: 'var(--foreground-secondary)',
                      lineHeight: '1.5'
                    }}>
                    Turn user feedback into action through user-driven development and token incentives
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                    <Link href="/launch" className="group">
                      <Button variant="primary" size="lg" className="w-full sm:w-auto px-8 py-4 text-base shadow-lg hover:shadow-xl transition-all duration-150 ease-out hover:-translate-y-1">
                        <span>Launch Your Token</span>
                        <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </Button>
                    </Link>
                    <Link href="/projects" className="group">
                      <Button variant="outline" size="lg" className="w-full sm:w-auto px-8 py-4 text-base transition-all duration-150 ease-out hover:-translate-y-1">
                        <span>Explore Projects</span>
                        <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </Button>
                    </Link>
                  </div>
                </div>

                {/* Right Column - Visual */}
                <div className="relative hidden lg:block">
                  <div className="relative">
                    {/* Decorative cards stack */}
                    <div className="space-y-4">
                      {/* Card 1 - Feedback */}
                      <div className="float-card-1 rounded-2xl p-5 backdrop-blur-sm border shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
                        style={{
                          backgroundColor: 'rgba(var(--background-rgb, 255, 255, 255), 0.9)',
                          borderColor: 'var(--border)'
                        }}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center accent-bg-text flex-shrink-0">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>User Feedback</div>
                            <div className="text-xs" style={{ color: 'var(--foreground-secondary)' }}>PR submitted</div>
                          </div>
                        </div>
                      </div>

                      {/* Card 2 - Market */}
                      <div className="float-card-2 rounded-2xl p-5 backdrop-blur-sm border shadow-sm hover:shadow-md transition-all duration-300 ml-8 hover:-translate-y-1"
                        style={{
                          backgroundColor: 'rgba(var(--background-rgb, 255, 255, 255), 0.9)',
                          borderColor: 'var(--border)'
                        }}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center accent-bg-text flex-shrink-0">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Quantum Market</div>
                            <div className="text-xs" style={{ color: 'var(--foreground-secondary)' }}>Community votes</div>
                          </div>
                        </div>
                      </div>

                      {/* Card 3 - Rewards */}
                      <div className="float-card-3 rounded-2xl p-5 backdrop-blur-sm border shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-1"
                        style={{
                          backgroundColor: 'rgba(var(--background-rgb, 255, 255, 255), 0.9)',
                          borderColor: 'var(--border)'
                        }}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center accent-bg-text flex-shrink-0">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Token Rewards</div>
                            <div className="text-xs" style={{ color: 'var(--foreground-secondary)' }}>Contributors paid</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </div>

      {/* Verified Projects Carousel */}
      <VerifiedProjectsCarousel />

      {/* Thesis Section */}
      <section className="py-10 md:py-14" style={{ backgroundColor: 'rgba(var(--background-rgb), 0.5)' }}>
        <Container>
          <ScrollReveal variant="fade-in-up">
            <div className="max-w-4xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-5" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--accent)' }}>
                <span className="text-sm font-semibold">Our Thesis</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold leading-tight" style={{ color: 'var(--foreground)' }}>
                The highest signal product feedback is a ready-to-merge pull request, made and selected by your users.
              </h2>
            </div>
          </ScrollReveal>
        </Container>
      </section>

      {/* Problems Section */}
      <section className="py-10 md:py-14">
        <Container>
          <div className="max-w-4xl mx-auto">
            <ScrollReveal variant="fade-in-up">
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-5" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--accent)' }}>
                  <span className="text-sm font-semibold">The Challenge</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold leading-tight" style={{ color: 'var(--foreground)' }}>
                  As a founder, building the right product is hard because:
                </h2>
              </div>
            </ScrollReveal>

            <div className="space-y-3 max-w-3xl mx-auto">
              <ScrollReveal variant="fade-in-up" delay={0}>
                <div className="flex items-start gap-4 p-5 rounded-xl border transition-all duration-200 hover:shadow-md hover:scale-[1.01] hover:-translate-y-0.5" style={{ backgroundColor: 'var(--background-secondary)', borderColor: 'var(--border)' }}>
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: 'rgba(var(--background-rgb), 0.5)', border: '1px solid var(--border)' }}>
                    <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1.5 leading-tight" style={{ color: 'var(--foreground)' }}>
                      You don&apos;t know what the right thing to build is
                    </h3>
                    <p className="text-base leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
                      Without clear direction, you&apos;re guessing at features that might resonate with users
                    </p>
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal variant="fade-in-up" delay={100}>
                <div className="flex items-start gap-4 p-5 rounded-xl border transition-all duration-200 hover:shadow-md hover:scale-[1.01] hover:-translate-y-0.5" style={{ backgroundColor: 'var(--background-secondary)', borderColor: 'var(--border)' }}>
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: 'rgba(var(--background-rgb), 0.5)', border: '1px solid var(--border)' }}>
                    <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1.5 leading-tight" style={{ color: 'var(--foreground)' }}>
                      You&apos;re getting no feedback (at worst) or bad feedback (at best)
                    </h3>
                    <p className="text-base leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
                      Most user feedback is vague, contradictory, or doesn&apos;t translate to actionable improvements
                    </p>
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal variant="fade-in-up" delay={200}>
                <div className="flex items-start gap-4 p-5 rounded-xl border transition-all duration-200 hover:shadow-md hover:scale-[1.01] hover:-translate-y-0.5" style={{ backgroundColor: 'var(--background-secondary)', borderColor: 'var(--border)' }}>
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: 'rgba(var(--background-rgb), 0.5)', border: '1px solid var(--border)' }}>
                    <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1.5 leading-tight" style={{ color: 'var(--foreground)' }}>
                      You&apos;re poorly incentivizing users to give good feedback
                    </h3>
                    <p className="text-base leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
                      Traditional feedback methods don&apos;t reward users for thoughtful, high-quality contributions
                    </p>
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal variant="fade-in-up" delay={300}>
                <div className="flex items-start gap-4 p-5 rounded-xl border transition-all duration-200 hover:shadow-md hover:scale-[1.01] hover:-translate-y-0.5" style={{ backgroundColor: 'var(--background-secondary)', borderColor: 'var(--border)' }}>
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center mt-0.5" style={{ backgroundColor: 'rgba(var(--background-rgb), 0.5)', border: '1px solid var(--border)' }}>
                    <svg className="w-5 h-5" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold mb-1.5 leading-tight" style={{ color: 'var(--foreground)' }}>
                      You don&apos;t know how valuable each piece of feedback is
                    </h3>
                    <p className="text-base leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
                      Without a way to measure feedback quality, you can&apos;t prioritize what to build next
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </Container>
      </section>

      {/* Solution Section */}
      <section className="py-10 md:py-14" style={{ backgroundColor: 'rgba(var(--background-rgb), 0.5)' }}>
        <Container>
          <ScrollReveal variant="fade-in-up">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-5" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--accent)' }}>
                <span className="text-sm font-semibold">The Solution</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold mb-3 leading-tight" style={{ color: 'var(--foreground)' }}>From Zero to PMF with ZC</h2>
              <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
                Follow these steps to leverage community-driven development:
              </p>
            </div>
          </ScrollReveal>

          <div className="max-w-4xl mx-auto relative">
            {/* Progress line with gradient */}
            <div className="absolute left-8 top-0 bottom-0 w-0.5 hidden md:block rounded-full overflow-hidden"
                 style={{ background: 'linear-gradient(180deg, var(--accent) 0%, var(--border) 50%, var(--accent) 100%)' }} />

            <div className="space-y-6">
              {[
                {
                  number: 1,
                  title: "Build Your MVP",
                  description: "Come up with an idea and build the minimum viable product",
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  )
                },
                {
                  number: 2,
                  title: "Launch Your Token",
                  description: (
                    <>
                      Open source your code and{' '}
                      <Link href="/launch" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                        launch a ZC token
                      </Link>{' '}
                      for your project
                    </>
                  ),
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )
                },
                {
                  number: 3,
                  title: "Quantum Markets",
                  description: (
                    <>
                      ZC spins up a{' '}
                      <a href="https://percent.markets" target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                        Percent
                      </a>{' '}
                      <a href="https://www.paradigm.xyz/2025/06/quantum-markets" target="_blank" rel="noopener noreferrer" className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                        Quantum Market
                      </a>{' '}
                      (QM) for selecting the best user-submitted PR to merge
                    </>
                  ),
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  )
                },
                {
                  number: 4,
                  title: "Community Engagement",
                  description: "Invite your users to submit PRs and trade the QM",
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  )
                },
                {
                  number: 5,
                  title: "Reward Contributors",
                  description: "When the QM ends, the best performing PR gets merged and tokens are minted to pay the contributor proportionally to how much the PR increased your token price",
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )
                },
                {
                  number: 6,
                  title: "Iterate to PMF",
                  description: "Repeat steps 3-5 (ZC automates this) while you build until you hit product-market fit",
                  icon: (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )
                }
              ].map((step) => (
                <div key={step.number} className="relative flex gap-6 group">
                  {/* Icon badge with number */}
                  <div className="flex-shrink-0 w-16 h-16 rounded-full flex flex-col items-center justify-center border-4 relative z-10 group-hover:scale-110 transition-transform duration-300 accent-bg-text"
                    style={{
                      borderColor: 'var(--background)'
                    }}>
                    <div className="text-xs font-bold mb-0.5">{step.number}</div>
                    {step.icon}
                  </div>

                  {/* Content */}
                  <Card variant="bordered" className="flex-1 group-hover:shadow-md group-hover:-translate-y-[2px] transition-all duration-150">
                    <CardHeader className="p-5">
                      <CardTitle className="text-xl mb-2 leading-tight">{step.title}</CardTitle>
                      <CardDescription className="text-base leading-relaxed">
                        {step.description}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* Get Involved Section */}
      <section className="py-10 md:py-14">
        <Container>
          <ScrollReveal variant="fade-in-up">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-5" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--accent)' }}>
                  <span className="text-sm font-semibold">Get Involved</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-bold leading-tight" style={{ color: 'var(--foreground)' }}>Want to Help Build ZC?</h2>
              </div>

              <div className="rounded-xl p-6 md:p-8 border-2 hover:shadow-lg transition-all duration-200"
                style={{
                  backgroundColor: 'var(--background-secondary)',
                  borderColor: 'var(--accent)'
                }}>
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-center">
                  <div className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center accent-bg-text">
                    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-2 leading-tight" style={{ color: 'var(--foreground)' }}>Contribute & Earn</h3>
                    <p className="text-base leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
                      Submit PRs to the{' '}
                      <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline" style={{ color: 'var(--accent)' }}>
                        ZC codebase
                      </a>{' '}
                      and trade the{' '}
                      <a href="https://zc.percent.markets/" target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline" style={{ color: 'var(--accent)' }}>
                        ZC Quantum Markets
                      </a>{' '}
                      to shape the future of the protocol and earn token rewards.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </Container>
      </section>

      {/* CTA Section */}
      <section className="py-10 md:py-14" style={{ backgroundColor: 'rgba(var(--background-rgb), 0.5)' }}>
        <Container>
          <ScrollReveal variant="fade-in-up">
            <div className="max-w-4xl mx-auto">
              <div className="text-center rounded-xl p-10 md:p-12 relative overflow-hidden border"
                style={{ backgroundColor: 'var(--background-secondary)', borderColor: 'var(--border)' }}>
                {/* Background decoration */}
                <div className="absolute inset-0 opacity-5 cta-dots" />

                <div className="relative z-10">
                  <h2 className="text-3xl md:text-4xl font-bold mb-3 leading-tight" style={{ color: 'var(--foreground)' }}>
                    Have Questions?
                  </h2>
                  <p className="text-lg mb-6 max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--foreground-secondary)' }}>
                    Join our community and get help from founders and contributors
                  </p>
                  <a href="https://discord.gg/MQfcX9QM2r" target="_blank" rel="noopener noreferrer" className="inline-block group" aria-label="Join Discord community">
                    <Button variant="primary" size="lg" className="shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">
                    <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M13.545 2.907a13.227 13.227 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.19 12.19 0 0 0-3.658 0 8.258 8.258 0 0 0-.412-.833.051.051 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.041.041 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.276 13.276 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.051.051 0 0 0-.018-.011 8.875 8.875 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.051.051 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.052.052 0 0 1 .053.007c.08.066.164.132.248.195a.051.051 0 0 1-.004.085 8.254 8.254 0 0 1-1.249.594.05.05 0 0 0-.03.03.052.052 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.235 13.235 0 0 0 4.001-2.02.049.049 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.034.034 0 0 0-.02-.019Zm-8.198 7.307c-.789 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612Zm5.316 0c-.788 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612Z"/>
                    </svg>
                    <span>Join Discord</span>
                    <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Button>
                </a>
              </div>
            </div>
            </div>
          </ScrollReveal>
        </Container>
      </section>
    </>
  );
}
