import { NextRequest, NextResponse } from 'next/server';
import { getTokenLaunches, getTokenLaunchesBySocials, getTokenLaunchByAddress, TokenLaunch } from '@/lib/db';
import { isInMockMode, MOCK_TOKENS } from '@/lib/mock';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const creatorWallet = body.creator;
    const tokenAddress = body.token;
    const twitterUsername = body.twitterUrl; // Actually username, not full URL
    const githubUrl = body.githubUrl;
    const includeSocials = body.includeSocials === 'true' || body.includeSocials === true;
    const limit = parseInt(body.limit || '100', 10);

    let allLaunches: TokenLaunch[] = [];

    // Get launches by creator wallet
    if (creatorWallet) {
      const walletLaunches = await getTokenLaunches(creatorWallet, limit);
      allLaunches = [...walletLaunches];
    }

    // Get launches by token address
    if (tokenAddress && !creatorWallet) {
      const tokenLaunch = await getTokenLaunchByAddress(tokenAddress);
      if (tokenLaunch) {
        allLaunches = [tokenLaunch];
      } else if (isInMockMode()) {
        // Token not found in database, check if it's a mock token
        const mockToken = MOCK_TOKENS.find(t => t.token_address === tokenAddress);
        if (mockToken) {
          console.log('📦 Mock Mode: Returning mock token for address:', tokenAddress);
          allLaunches = [{
            ...mockToken,
            launch_time: new Date(mockToken.launch_time),
            created_at: new Date(mockToken.created_at),
            isDemoData: true,
          } as any];
        }
      }
    }

    // Also get launches by social profiles if requested
    if (includeSocials && (twitterUsername || githubUrl)) {
      const socialLaunches = await getTokenLaunchesBySocials(twitterUsername || undefined, githubUrl || undefined, limit);

      // Create a set of tokens where user is designated
      const designatedTokens = new Set(socialLaunches.map(l => l.token_address));

      // Mark existing launches as designated if they match
      allLaunches = allLaunches.map(launch => ({
        ...launch,
        is_creator_designated: designatedTokens.has(launch.token_address)
      }));

      // Add any social launches that aren't already in the list
      const existingAddresses = new Set(allLaunches.map(l => l.token_address));
      socialLaunches.forEach(launch => {
        if (!existingAddresses.has(launch.token_address)) {
          allLaunches.push({
            ...launch,
            is_creator_designated: true // Mark as creator-designated token
          });
        }
      });
    }

    // Sort by launch_time DESC
    allLaunches.sort((a, b) => new Date(b.launch_time).getTime() - new Date(a.launch_time).getTime());

    // In mock mode, if no tokens found for this wallet, return all mock tokens for demo purposes
    if (isInMockMode() && allLaunches.length === 0 && creatorWallet) {
      console.log('📦 Mock Mode: Showing all sample tokens for demo purposes');
      allLaunches = MOCK_TOKENS.map(token => ({
        ...token,
        launch_time: new Date(token.launch_time),
        created_at: new Date(token.created_at),
        isDemoData: true, // Flag to indicate this is demo data
      } as any));
    }

    return NextResponse.json({
      launches: allLaunches,
      count: allLaunches.length,
      isDemoMode: isInMockMode() && allLaunches.some((l: any) => l.isDemoData)
    });

  } catch (error) {
    console.error('Error fetching launches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch token launches' },
      { status: 500 }
    );
  }
}