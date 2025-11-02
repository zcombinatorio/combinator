'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useWallet } from '@/components/WalletProvider';

export function ClaimContent() {
  const { login, ready } = usePrivy();
  const { isPrivyAuthenticated } = useWallet();

  const handleSocialLogin = (provider: 'twitter' | 'github') => {
    login({
      loginMethods: [provider]
    });
  };

  if (!ready) {
    return (
      <>
        <h1 className="text-7xl font-bold">Claim</h1>
        <p className="mt-7 text-xl text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Loading...</p>
      </>
    );
  }

  if (isPrivyAuthenticated) {
    return (
      <>
        <h1 className="text-7xl font-bold">Claim</h1>
        <div className="mt-7 max-w-2xl space-y-8">
          <p className="text-xl text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
            You&apos;re already connected! Navigate to the Portfolio page to manage your tokens.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="text-7xl font-bold">Claim</h1>

      <div className="mt-7 max-w-2xl">
        <p className="text-[14px] text-gray-500" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>{'//'}Trying to claim rewards for a ZC token someone else launched for you?</p>
        <p className="mt-7 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Claim your token rewards by connecting your X or GitHub account.</p>
        <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>This will create an embedded wallet for you to receive tokens.</p>
        <p className="mt-6.5 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>NOTE: If you launched a token, manage your token on the Portfolio page.</p>
        <p className="mt-1 text-[14px] text-gray-300" style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>Only use this page if you were designated a token from someone else.</p>

        <div className="flex flex-row gap-4 mt-6.5 items-start">
          <button
            onClick={() => handleSocialLogin('twitter')}
            className="text-[14px] text-[#b2e9fe] hover:text-[#d0f2ff] transition-colors cursor-pointer text-left"
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            [CLICK TO CONNECT X]
          </button>

          <button
            onClick={() => handleSocialLogin('github')}
            className="text-[14px] text-[#b2e9fe] hover:text-[#d0f2ff] transition-colors cursor-pointer text-left"
            style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}
          >
            [CLICK TO CONNECT GITHUB]
          </button>
        </div>
      </div>
    </>
  );
}
