import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SpecsBrowser from '../components/SpecsBrowser'

export default async function SpecsPage() {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const { data: sheets } = await supabase
    .from('equipment_spec_sheets')
    .select('id, category, models, image_url, source')
    .order('category')
    .order('page_number')

  return <SpecsBrowser sheets={sheets || []} />
}
