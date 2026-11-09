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

  const { data: guides } = await supabase
    .from('reference_guides')
    .select('id, title, description, category, source, reference_guide_pages(page_number, section_label, image_url)')
    .order('category')
    .order('title')
    .order('page_number', { foreignTable: 'reference_guide_pages' })

  return <SpecsBrowser sheets={sheets || []} guides={guides || []} />
}
