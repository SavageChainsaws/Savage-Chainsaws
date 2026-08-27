import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import InventoryClient from './InventoryClient'

export default async function InventoryPage() {
  const { user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  return <InventoryClient />
}
