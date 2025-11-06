import Image from 'next/image';

export default function LandingPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-7xl font-bold flex items-center gap-4">
        <Image
          src="/logos/z-logo-white.png"
          alt="Z"
          width={56}
          height={56}
          className="mr-2"
        />
        <span className="hidden md:inline">Combinator</span>
      </h1>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}What is ZC?</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>A launchpad that helps founders hit PMF</p>
      <p className="mt-[26px] text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Thesis</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>The highest signal product feedback is a ready-to-merge PR made and selected by your users.</p>
      <p className="mt-[26px] text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}What problems are ZC solving for you as a founder?</p>
      <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>&gt; I don&apos;t know what the right thing to build is b/c</p>
      <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>&gt; I&apos;m getting no feedback (at worst) and bad feedback (at best) b/c</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>&gt; I&apos;m poorly incentivizing my users to give me good feedback b/c</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>&gt; I don&apos;t know how valueable each piece of feedback is</p>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}How does ZC solve these problems?</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>From Zero to PMF with ZC:</p>
      <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>1. Come up with an idea and build the MVP.</p>
      <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>2. Open source your code and <a href="https://www.zcombinator.io/launch" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">launch a ZC token</a> for it.</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>3. ZC spins up a <a href="https://percent.markets" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Percent</a> <a href="https://www.paradigm.xyz/2025/06/quantum-markets" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Quantum Market</a> (QM) for selecting the best user-submitted PR to merge.</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>4. Invite your users to submit PRs and trade the QM.</p>
      <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>5. When the QM ends, the best performing PR gets merged and tokens get minted to pay the user who made the PR an amount proportional to how much the PR increased your token price.</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>6. Rerun steps 3-5 (ZC does this) while you build until you hit PMF.</p>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Want to help build ZC?</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Submit PRs to the <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">ZC codebase</a> and trade the <a href="https://zc.percent.markets/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">ZC QMs</a> to shape the future of the protocol.</p>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Have questions?</p>
      <p className="mt-0.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Join <a href="https://discord.gg/MQfcX9QM2r" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">our discord</a> and ask them!</p>
    </div>
  );
}