import { NextResponse } from 'next/server'

// Temporary diagnostic route - reports whether the client-facing VAPID
// key is actually present in *this running server's* build, since the
// "Push notifications are not configured yet" message is gated entirely
// on NEXT_PUBLIC_VAPID_PUBLIC_KEY (app/components/PushToggle.tsx) and
// neither of us can otherwise see Vercel's env var configuration - no
// available tool exposes it, and the client error alone doesn't
// distinguish "never set" from "set in the wrong environment/scope".
// This key is not a secret - it's already shipped to every browser in
// the client bundle - so reporting it here reveals nothing new. Remove
// this route once the misconfiguration is confirmed and fixed.
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV || null,
    hasPublicKey: !!publicKey,
    publicKeyLength: publicKey?.length ?? 0,
    publicKeyPreview: publicKey ? `${publicKey.slice(0, 10)}...${publicKey.slice(-6)}` : null,
  })
}
