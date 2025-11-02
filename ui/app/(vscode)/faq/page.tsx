import Link from 'next/link';

export default function FaqPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="text-7xl font-bold">FAQ</h1>
      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Why are all ZC launched tokens (including $ZC) mintable?</p>
      <p className="mt-1 text-[14px] text-gray-300 leading-relaxed" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Only the ZC protocol (NOT the token dev) can mint tokens. It will do so automatically at the end of each Quantum Market to pay users whose PRs get merged. This aligns incentives with token price growth, rewarding all users who create value.</p>

      <p className="mt-6.5 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}What is the utility of $ZC?</p>
      <p className="mt-1 text-[14px] text-gray-300 leading-relaxed" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>$ZC represents a stake in the Z Combinator treasury, which receives a portion of all token mints from platform launches. Other launched tokens on ZC have utilities as determined by their founders. More $ZC utilities coming soon.</p>

      <p className="mt-6.5 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}How does staking work? What are the rewards for staking?</p>
      <p className="mt-0.5 text-[14px] text-gray-300 leading-relaxed" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>All ZC launched tokens will have native staking. Users who lock their tokens in the vault will earn rewards from protocol-minted tokens. Currently only available for $ZC and $oogway.</p>

      <p className="mt-6.5 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Are there trading fees?</p>
      <p className="mt-0.5 text-[14px] text-gray-300 leading-relaxed" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>There are no trading fees for any ZC launched token currently.</p>

      <p className="mt-6.5 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}As a dev, isn&apos;t it weird that I have to dump my tokens to fund myself?</p>
      <p className="mt-1 text-[14px] text-gray-300 leading-relaxed" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Projects relying on trading fees are unsustainable. Controlled token emissions let founders fuel growth through incentives, creating long-term value. Both users and founders get rich by contributing to and sharing ownership of a valuable project.</p>

      <p className="mt-6.5 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}How can you get involved?</p>
      <p className="mt-0.5 text-[14px] text-gray-300 leading-relaxed" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>&gt; If you want to found a startup, launch a ZC token and follow the steps on the <Link href="/" className="underline hover:text-white">landing page</Link>.</p>
      <p className="mt-0.5 text-[14px] text-gray-300 leading-relaxed" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>&gt; If you want help grow existing projects, submit PRs to and trade Quantum Markets for any ZC launched project (<a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">including ZC itself</a>!) to earn substantial token rewards.</p>

      <p className="mt-7 text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Have other questions?</p>
      <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Join <a href="https://discord.gg/MQfcX9QM2r" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">our discord</a> and ask them!</p>
    </div>
  );
}