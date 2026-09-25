import { revalidatePath } from 'next/cache'
import { getSessionInfo } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSquarePaymentLink, getSquareOrderPaidStatus } from '@/lib/square'
import { DEFAULT_DAILY_RATE, DEFAULT_WEEKLY_RATE, DEFAULT_SECURITY_DEPOSIT, DEFAULT_DAMAGE_CAP } from '@/lib/rentals'
import CreateRentalForm from '../components/CreateRentalForm'
import RentalReturnButton from '../components/RentalReturnButton'
import InvoicePaymentActions from '../components/InvoicePaymentActions'
import MarkPaidToggle from '../components/MarkPaidToggle'
import UppercaseInput from '../components/UppercaseInput'

type GenerateLinkState = { success: boolean; message: string; url?: string } | null
type CheckStatusState = { success: boolean; message: string; paid?: boolean } | null
type MarkPaidState = { success: boolean; message: string } | null

async function addRentalUnit(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const model = ((formData.get('model') as string) || '').trim().toUpperCase()
  const equipmentType = ((formData.get('equipment_type') as string) || '').trim() || 'Chainsaw'
  const serialNumber = ((formData.get('serial_number') as string) || '').trim().toUpperCase() || null
  const dailyRate = Number(formData.get('daily_rate')) || DEFAULT_DAILY_RATE
  const weeklyRate = Number(formData.get('weekly_rate')) || DEFAULT_WEEKLY_RATE
  const securityDeposit = Number(formData.get('security_deposit')) || DEFAULT_SECURITY_DEPOSIT
  const damageCap = Number(formData.get('damage_cap')) || DEFAULT_DAMAGE_CAP
  if (!model) return

  await supabase.from('rental_units').insert({
    model,
    equipment_type: equipmentType,
    serial_number: serialNumber,
    daily_rate: dailyRate,
    weekly_rate: weeklyRate,
    security_deposit: securityDeposit,
    damage_cap: damageCap,
  })
  revalidatePath('/rentals')
}

// Manual override for a rental_unit's status - the normal lifecycle
// (Available -> Rented -> Available/Maintenance) is driven automatically
// by creating/returning a rental, but Jesse needs a way to pull a unit out
// of rotation (or bring a repaired one back) without going through a full
// rental cycle.
async function setRentalUnitStatus(formData: FormData) {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const id = (formData.get('id') as string) || ''
  const status = (formData.get('status') as string) || ''
  if (!id || !['Available', 'Maintenance', 'Retired'].includes(status)) return

  await supabase.from('rental_units').update({ status }).eq('id', id)
  revalidatePath('/rentals')
}

// Payment link generation/status-check/manual-paid toggle for rentals -
// deliberately mirrors app/invoices/page.tsx's generatePaymentLink/
// checkPaymentStatus/toggleManualPaid exactly (same shared components,
// InvoicePaymentActions and MarkPaidToggle, read/write an "invoice_id"
// hidden field regardless of what it actually identifies) so a rental's
// current amount_due - whether that's the pickup charge or a post-return
// balance - gets the identical on-demand Square Payment Link flow invoices
// already have, rather than a second parallel implementation.
async function generateRentalPaymentLink(_prevState: GenerateLinkState, formData: FormData): Promise<GenerateLinkState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const rentalId = (formData.get('invoice_id') as string) || ''
  if (!rentalId) return { success: false, message: 'Missing rental id.' }

  const { data: rental } = await supabase
    .from('rentals')
    .select('id, amount_due, customer_id, renter_name, square_payment_link_url')
    .eq('id', rentalId)
    .maybeSingle()
  if (!rental) return { success: false, message: 'Rental not found.' }
  if (rental.square_payment_link_url) {
    return { success: true, message: 'Payment link already exists.', url: rental.square_payment_link_url }
  }

  const amountCents = Math.round((Number(rental.amount_due) || 0) * 100)
  if (amountCents <= 0) {
    return { success: false, message: 'Nothing currently due for this rental.' }
  }

  let buyerEmail: string | null = null
  if (rental.customer_id) {
    const { data: customer } = await supabase.from('customers').select('email').eq('id', rental.customer_id).maybeSingle()
    buyerEmail = customer?.email ?? null
  }

  const result = await createSquarePaymentLink({
    invoiceNumber: `Rental-${rentalId.slice(0, 8)}`,
    amountCents,
    buyerEmail,
    redirectUrl: 'https://app.savagechainsaws.com/rentals',
  })
  if (!result.ok) return { success: false, message: result.error }

  await supabase
    .from('rentals')
    .update({ square_payment_link_id: result.paymentLinkId, square_order_id: result.orderId, square_payment_link_url: result.url })
    .eq('id', rentalId)
  revalidatePath('/rentals')

  return { success: true, message: 'Payment link generated.', url: result.url }
}

async function checkRentalPaymentStatus(_prevState: CheckStatusState, formData: FormData): Promise<CheckStatusState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const rentalId = (formData.get('invoice_id') as string) || ''
  if (!rentalId) return { success: false, message: 'Missing rental id.' }

  const { data: rental } = await supabase.from('rentals').select('id, square_order_id, paid_at').eq('id', rentalId).maybeSingle()
  if (!rental) return { success: false, message: 'Rental not found.' }
  if (!rental.square_order_id) return { success: false, message: 'No payment link generated yet.' }
  if (rental.paid_at) return { success: true, message: 'Already marked paid.', paid: true }

  const result = await getSquareOrderPaidStatus(rental.square_order_id)
  if (!result.ok) return { success: false, message: result.error }

  if (result.paid) {
    await supabase.from('rentals').update({ paid_at: new Date().toISOString(), paid_via: 'square' }).eq('id', rentalId)
    revalidatePath('/rentals')
    return { success: true, message: 'Payment confirmed - marked Paid.', paid: true }
  }
  return { success: true, message: 'Not paid yet.', paid: false }
}

async function toggleRentalManualPaid(_prevState: MarkPaidState, formData: FormData): Promise<MarkPaidState> {
  'use server'
  const { supabase, isAdmin } = await getSessionInfo()
  if (!isAdmin) throw new Error('Not authorized')

  const rentalId = (formData.get('invoice_id') as string) || ''
  const nextPaid = formData.get('next_paid') === 'true'
  if (!rentalId) return { success: false, message: 'Missing rental id.' }

  const { error } = await supabase
    .from('rentals')
    .update(nextPaid ? { paid_at: new Date().toISOString(), paid_via: 'manual' } : { paid_at: null, paid_via: null })
    .eq('id', rentalId)
  if (error) return { success: false, message: `Could not update: ${error.message}` }

  revalidatePath('/rentals')
  return { success: true, message: nextPaid ? 'Marked paid.' : 'Marked unpaid.' }
}

export default async function RentalsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>
}) {
  const { supabase, user, isAdmin } = await getSessionInfo()
  if (!user || !isAdmin) redirect('/login')

  const params = await searchParams
  const customerFilter = params.customer || null

  const { data: customers } = await supabase.from('customers').select('id, name, email, phone').order('name')
  const { data: rentalUnits } = await supabase.from('rental_units').select('*').order('model')

  let rentalsQuery = supabase
    .from('rentals')
    .select('*, rental_units(model, equipment_type, serial_number), customers(name)')
    .order('created_at', { ascending: false })
  if (customerFilter) rentalsQuery = rentalsQuery.eq('customer_id', customerFilter)
  const { data: rentalsRaw } = await rentalsQuery

  const rentals = (rentalsRaw || []).map(r => {
    const unit = r.rental_units as unknown as { model: string; equipment_type: string; serial_number: string | null } | null
    const customer = r.customers as unknown as { name: string } | null
    return {
      id: r.id as string,
      unitLabel: unit ? `${unit.model} - ${unit.equipment_type}` : 'Unknown Unit',
      renterName: r.renter_name as string,
      customerName: customer?.name || null,
      rentalType: r.rental_type as 'daily' | 'weekly',
      startDate: r.start_date as string,
      endDate: r.end_date as string,
      status: r.status as 'Active' | 'Returned' | 'Cancelled',
      amountDue: Number(r.amount_due) || 0,
      paymentLinkUrl: r.square_payment_link_url as string | null,
      paidAt: r.paid_at as string | null,
      paidVia: r.paid_via as string | null,
      agreementPdfUrl: r.agreement_pdf_url as string | null,
      damageCapAmount: Number(r.damage_cap_amount) || DEFAULT_DAMAGE_CAP,
      isOverdue: r.status === 'Active' && new Date(r.end_date) < new Date(),
    }
  })

  const activeRentals = rentals.filter(r => r.status === 'Active')
  const historyRentals = rentals.filter(r => r.status !== 'Active')
  const availableUnits = (rentalUnits || []).filter(u => u.status === 'Available')
  const filteredCustomerName = customerFilter ? customers?.find(c => c.id === customerFilter)?.name : null

  const rentalUnitOptions = (rentalUnits || []).map(u => ({
    id: u.id as string,
    model: u.model as string,
    equipmentType: u.equipment_type as string,
    serialNumber: u.serial_number as string | null,
    dailyRate: Number(u.daily_rate),
    weeklyRate: Number(u.weekly_rate),
    securityDeposit: Number(u.security_deposit),
    damageCap: Number(u.damage_cap),
  }))

  return (
    <main className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="" className="h-10 w-10 object-contain" />
            <div>
              <h1 className="text-2xl font-bold">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </h1>
              <p className="text-sm text-gray-400">Equipment Rentals</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/invoices" className="border border-zinc-700 hover:border-orange-500 text-sm px-4 py-2 rounded-lg transition whitespace-nowrap">
              Invoices
            </Link>
            <Link href="/" className="border border-zinc-700 hover:border-orange-500 text-sm px-4 py-2 rounded-lg transition whitespace-nowrap">
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {filteredCustomerName && (
          <div className="bg-zinc-900 border border-orange-500/40 rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm">Showing rentals for <span className="font-bold text-orange-400">{filteredCustomerName}</span></p>
            <Link href="/rentals" className="text-xs text-orange-400 hover:text-orange-300 underline">View All Rentals</Link>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Active Rentals</p>
            <p className="text-3xl font-bold text-orange-400">{activeRentals.length}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Available Units</p>
            <p className="text-3xl font-bold text-green-400">{availableUnits.length}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase">Total Fleet</p>
            <p className="text-3xl font-bold text-white">{(rentalUnits || []).length}</p>
          </div>
        </div>

        {/* Rental Fleet inventory */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <details>
            <summary className="px-4 sm:px-6 py-4 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
              <h2 className="text-lg font-semibold text-orange-400">Rental Fleet ({(rentalUnits || []).length})</h2>
              <span className="text-gray-500 text-sm">v</span>
            </summary>
            <div className="border-t border-zinc-800 p-4 sm:p-6 space-y-4">
              <div className="grid gap-2">
                {(rentalUnits || []).map(u => (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2">
                    <div>
                      <p className="font-medium text-sm">{u.model} - {u.equipment_type}</p>
                      <p className="text-xs text-gray-500">
                        {u.serial_number ? `Serial: ${u.serial_number} - ` : ''}
                        ${Number(u.daily_rate).toFixed(2)}/day · ${Number(u.weekly_rate).toFixed(2)}/week · ${Number(u.security_deposit).toFixed(2)} deposit · ${Number(u.damage_cap).toFixed(2)} cap
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        u.status === 'Available' ? 'bg-green-500/20 text-green-400'
                          : u.status === 'Rented' ? 'bg-orange-500/20 text-orange-400'
                          : u.status === 'Maintenance' ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-zinc-700 text-gray-300'
                      }`}>{u.status}</span>
                      {u.status !== 'Rented' && (
                        <form action={setRentalUnitStatus} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={u.id} />
                          <select
                            name="status"
                            defaultValue={u.status}
                            className="text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1"
                          >
                            <option value="Available">Available</option>
                            <option value="Maintenance">Maintenance</option>
                            <option value="Retired">Retired</option>
                          </select>
                          <button type="submit" className="text-xs border border-zinc-700 hover:bg-zinc-800 text-gray-300 px-2 py-1 rounded-lg">Set</button>
                        </form>
                      )}
                    </div>
                  </div>
                ))}
                {(rentalUnits || []).length === 0 && (
                  <p className="text-gray-500 text-sm">No rental equipment yet - add one below.</p>
                )}
              </div>

              <details className="border-t border-zinc-800 pt-3">
                <summary className="text-sm text-orange-400 cursor-pointer list-none">+ Add Rental Unit</summary>
                <form action={addRentalUnit} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Model *</label>
                    <UppercaseInput name="model" required placeholder="e.g. MS 251" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Equipment Type</label>
                    <input name="equipment_type" defaultValue="Chainsaw" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Serial Number</label>
                    <UppercaseInput name="serial_number" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Daily Rate $</label>
                    <input name="daily_rate" type="number" step="0.01" min="0" defaultValue={DEFAULT_DAILY_RATE} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Weekly Rate $</label>
                    <input name="weekly_rate" type="number" step="0.01" min="0" defaultValue={DEFAULT_WEEKLY_RATE} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Security Deposit $</label>
                    <input name="security_deposit" type="number" step="0.01" min="0" defaultValue={DEFAULT_SECURITY_DEPOSIT} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Damage Cap $</label>
                    <input name="damage_cap" type="number" step="0.01" min="0" defaultValue={DEFAULT_DAMAGE_CAP} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-5 py-2 rounded-lg">Add to Fleet</button>
                  </div>
                </form>
              </details>
            </div>
          </details>
        </div>

        {/* Create Rental */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold text-orange-400">Create Rental</h2>
            <p className="text-xs text-gray-500 mt-1">Generates the signed-ready rental agreement PDF and marks the unit Rented.</p>
          </div>
          <div className="p-4 sm:p-6">
            <CreateRentalForm
              rentalUnits={rentalUnitOptions.filter(u => availableUnits.some(a => a.id === u.id))}
              customers={(customers || []).map(c => ({ id: c.id, name: c.name, email: c.email, phone: c.phone }))}
              defaultCustomerId={customerFilter || undefined}
            />
          </div>
        </div>

        {/* Active rentals */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-zinc-800">
            <h2 className="text-lg font-semibold text-orange-400">Active Rentals ({activeRentals.length})</h2>
          </div>
          <div className="divide-y divide-zinc-800">
            {activeRentals.map(r => (
              <div key={r.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {r.unitLabel}
                    {r.isOverdue && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-600 text-white font-bold">OVERDUE</span>}
                  </p>
                  <p className="text-sm text-gray-400">{r.renterName}{r.customerName ? ` (${r.customerName})` : ''}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(r.startDate).toLocaleDateString()} → {new Date(r.endDate).toLocaleDateString()} · {r.rentalType} · Due: ${r.amountDue.toFixed(2)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.agreementPdfUrl && (
                    <a href={r.agreementPdfUrl} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:text-orange-300 px-1">
                      Agreement
                    </a>
                  )}
                  <InvoicePaymentActions
                    invoiceId={r.id}
                    paymentLinkUrl={r.paymentLinkUrl}
                    isPaid={!!r.paidAt}
                    generateAction={generateRentalPaymentLink}
                    checkStatusAction={checkRentalPaymentStatus}
                  />
                  <MarkPaidToggle invoiceId={r.id} isPaid={!!r.paidAt} action={toggleRentalManualPaid} />
                  <RentalReturnButton rentalId={r.id} unitLabel={r.unitLabel} damageCapAmount={r.damageCapAmount} />
                </div>
              </div>
            ))}
            {activeRentals.length === 0 && (
              <p className="p-6 text-gray-500 text-sm text-center">No active rentals.</p>
            )}
          </div>
        </div>

        {/* Rental history */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <details>
            <summary className="px-4 sm:px-6 py-4 cursor-pointer list-none flex items-center justify-between hover:bg-zinc-800/40 transition">
              <h2 className="text-lg font-semibold text-gray-400">Rental History ({historyRentals.length})</h2>
              <span className="text-gray-500 text-sm">v</span>
            </summary>
            <div className="border-t border-zinc-800 divide-y divide-zinc-800">
              {historyRentals.map(r => (
                <div key={r.id} className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{r.unitLabel}</p>
                    <p className="text-sm text-gray-400">{r.renterName}{r.customerName ? ` (${r.customerName})` : ''}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(r.startDate).toLocaleDateString()} → {new Date(r.endDate).toLocaleDateString()} · {r.status}
                      {r.amountDue > 0 ? ` · Balance due: $${r.amountDue.toFixed(2)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.agreementPdfUrl && (
                      <a href={r.agreementPdfUrl} target="_blank" rel="noreferrer" className="text-xs text-orange-400 hover:text-orange-300 px-1">
                        Agreement
                      </a>
                    )}
                    {r.amountDue > 0 && (
                      <>
                        <InvoicePaymentActions
                          invoiceId={r.id}
                          paymentLinkUrl={r.paymentLinkUrl}
                          isPaid={!!r.paidAt}
                          generateAction={generateRentalPaymentLink}
                          checkStatusAction={checkRentalPaymentStatus}
                        />
                        <MarkPaidToggle invoiceId={r.id} isPaid={!!r.paidAt} action={toggleRentalManualPaid} />
                      </>
                    )}
                  </div>
                </div>
              ))}
              {historyRentals.length === 0 && (
                <p className="p-6 text-gray-500 text-sm text-center">No past rentals yet.</p>
              )}
            </div>
          </details>
        </div>
      </div>
    </main>
  )
}
