import { createClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function requestRepair(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  const notes = (formData.get('notes') as string) || 'Customer requested repair'
  const { data: existing } = await supabase.from('units').select('history, notes').eq('id', id).single()
  const line = `${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — Customer requested repair`
  await supabase
    .from('units')
    .update({
      status: 'Repair Requested',
      notes: notes,
      history: existing?.history ? `${line}\n${existing.history}` : line,
    })
    .eq('id', id)
  revalidatePath('/customer')
}

async function approveRepair(formData: FormData) {
  'use server'
  const id = formData.get('id') as string
  const name = (formData.get('approver_name') as string) || 'Customer'
  const decision = formData.get('decision') as string
  const { data: existing } = await supabase.from('units').select('history, notes').eq('id', id).single()
  const stamp = `${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
  let note = ''
  let status = 'In Repair'
  if (decision === 'approve') {
    note = `Approved by ${name}`
  } else if (decision === 'upgrade') {
    note = `Upgrade requested by ${name}`
  } else if (decision === 'equivalent') {
    note = `Equivalent replacement requested by ${name}`
  } else {
    note = `Denied by ${name} — diagnosis fee $49.99 may apply`
    status = 'Completed'
  }
  const line = `${stamp} — ${note}`
  await supabase
    .from('units')
    .update({
      status,
      notes: note,
      decision_seen: false,
      history: existing?.history ? `${line}\n${existing.history}` : line,
    })
    .eq('id', id)
  revalidatePath('/customer')
}

async function sendMessage(formData: FormData) {
  'use server'
  const message = formData.get('message') as string
  const customerName = formData.get('customer_name') as string
  const customerId = formData.get('customer_id') as string
  if (!message?.trim()) return
  await supabase.from('messages').insert({
    message: message.trim(),
    customer_name: customerName,
    customer_id: customerId || null,
    is_read: false,
  })
  revalidatePath('/customer')
}

async function addRegisteredUnit(formData: FormData) {
  'use server'
  const serial = formData.get('serial') as string
  const model = formData.get('model') as string
  const customerId = formData.get('customer_id') as string
  const notes = formData.get('notes') as string
  if (!serial?.trim() || !customerId) return
  await supabase.from('units').insert({
    serial_number: serial.trim(),
    model: model || null,
    customer_id: customerId,
    status: 'Registered',
    notes: notes || 'Registered unit',
    decision_seen: true,
  })
  revalidatePath('/customer')
}

export default async function CustomerPortal() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/customer/login')
  }

  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('email', user.email)
    .maybeSingle()

  if (!customer) {
    return (
      <main className="min-h-screen bg-black text-white p-6 flex items-center justify-center">
        <div className="max-w-md text-center space-y-4">
          <img src="/images/logo.png" alt="Savage Chainsaws" className="h-16 w-16 mx-auto object-contain" />
          <h1 className="text-2xl font-bold">
            SAVAGE <span className="text-orange-500">CHAINSAWS</span>
          </h1>
          <p className="text-gray-400">
            Your account ({user.email}) is not linked to a customer profile yet.
            Contact us and we’ll set you up.
          </p>
          <a
            href="https://savagechainsaws.com"
            target="_blank"
            rel="noreferrer"
            className="inline-block text-orange-400 hover:text-orange-300 text-sm"
          >
            savagechainsaws.com →
          </a>
        </div>
      </main>
    )
  }

  const { data: units } = await supabase
    .from('units')
    .select('*')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })

  const needsDecision = units?.filter(u => u.status === 'Needs Approval') || []
  const inShop = units?.filter(u =>
    ['Diagnosing', 'In Repair', 'Repair Requested', 'Ready for Pickup'].includes(u.status)
  ) || []

  function formatDate(dateString: string | null) {
    if (!dateString) return '—'
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <header className="border-b border-zinc-800 bg-zinc-950/80">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/images/logo.png" alt="Savage Chainsaws" className="h-10 w-10 object-contain" />
            <div>
              <p className="font-bold tracking-tight text-sm sm:text-base">
                SAVAGE <span className="text-orange-500">CHAINSAWS</span>
              </p>
              <p className="text-xs text-gray-500">Customer portal</p>
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-gray-400 hover:text-white">
              Log out
            </button>
          </form>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        <section className="space-y-3">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Signed in as</p>
            <h1 className="text-2xl font-semibold text-orange-400">{customer.name}</h1>
            <p className="text-sm text-gray-400">{user.email}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <a
              href="https://savagechainsaws.com"
              target="_blank"
              rel="noreferrer"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-orange-500/50 transition"
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Website</p>
              <p className="text-sm text-orange-400 font-medium">savagechainsaws.com →</p>
            </a>
            <a
              href="mailto:savagechainsaws@gmail.com"
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-orange-500/50 transition"
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Email</p>
              <p className="text-sm text-white font-medium">savagechainsaws@gmail.com</p>
            </a>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Service area</p>
              <p className="text-sm text-white font-medium">Oviedo, FL & surrounding</p>
            </div>
          </div>
        </section>

        {needsDecision.length > 0 && (
          <section className="bg-zinc-900 border border-yellow-500/40 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800">
              <h2 className="font-semibold text-yellow-400">
                Action needed ({needsDecision.length})
              </h2>
              <p className="text-xs text-gray-500 mt-1">Approve, upgrade, or decline the repair</p>
            </div>
            <div className="divide-y divide-zinc-800">
              {needsDecision.map(unit => (
                <div key={unit.id} className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold">{unit.serial_number}</p>
                      <p className="text-sm text-gray-400">
                        {unit.model || '—'} · {unit.problem_type || unit.notes || 'Awaiting approval'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Checked in {formatDate(unit.created_at)}</p>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-yellow-500/20 text-yellow-400 shrink-0">
                      Needs Approval
                    </span>
                  </div>
                  {unit.invoice_url && (
                    <a
                      href={unit.invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm text-orange-400 hover:text-orange-300"
                    >
                      View estimate / invoice →
                    </a>
                  )}
                  <form action={approveRepair} className="space-y-3">
                    <input type="hidden" name="id" value={unit.id} />
                    <input
                      name="approver_name"
                      required
                      placeholder="Your name (required)"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        name="decision"
                        value="approve"
                        className="bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                      >
                        Approve repair
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="upgrade"
                        className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                      >
                        Upgrade
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="equivalent"
                        className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                      >
                        Same / equivalent
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="deny"
                        className="bg-red-700/80 hover:bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                      >
                        Deny ($49.99 diagnosis)
                      </button>
                    </div>
                  </form>
                </div>
              ))}
            </div>
          </section>
        )}

        {inShop.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              In the shop ({inShop.length})
            </h2>
            <div className="space-y-3">
              {inShop.map(unit => (
                <div
                  key={unit.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start justify-between gap-3"
                >
                  <div>
                    <p className="font-semibold">{unit.serial_number}</p>
                    <p className="text-sm text-gray-400">
                      {unit.model || '—'}
                      {unit.equipment_type ? ` · ${unit.equipment_type}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Checked in {formatDate(unit.created_at)}</p>
                    {unit.notes && <p className="text-sm text-gray-300 mt-2">{unit.notes}</p>}
                  </div>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full shrink-0 ${
                      unit.status === 'Ready for Pickup'
                        ? 'bg-green-500/20 text-green-400'
                        : unit.status === 'In Repair'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-orange-500/20 text-orange-400'
                    }`}
                  >
                    {unit.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-wrap gap-3">
          <details className="bg-zinc-900 border border-zinc-800 rounded-xl open:border-orange-500/40">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-orange-400 list-none">
              + Register a unit
            </summary>
            <form action={addRegisteredUnit} className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
              <input type="hidden" name="customer_id" value={customer.id} />
              <input
                name="serial"
                required
                placeholder="Serial number *"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <input
                name="model"
                placeholder="Model"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <textarea
                name="notes"
                rows={2}
                placeholder="Notes (optional)"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <button type="submit" className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                Save unit
              </button>
            </form>
          </details>

          <details className="bg-zinc-900 border border-zinc-800 rounded-xl open:border-orange-500/40">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-300 list-none">
              Send a message
            </summary>
            <form action={sendMessage} className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
              <input type="hidden" name="customer_id" value={customer.id} />
              <input type="hidden" name="customer_name" value={customer.name} />
              <textarea
                name="message"
                required
                rows={3}
                placeholder="What do you need?"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
              />
              <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                Send
              </button>
            </form>
          </details>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Your units ({units?.length || 0})
          </h2>
          {!units?.length ? (
            <p className="text-sm text-gray-500">No units on file yet. Register one above or drop it off.</p>
          ) : (
            <div className="space-y-3">
              {units.map(unit => (
                <div
                  key={unit.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-lg">{unit.serial_number}</p>
                      <p className="text-sm text-gray-400">
                        {unit.model || '—'}
                        {unit.equipment_type ? ` · ${unit.equipment_type}` : ''}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Status:{' '}
                        <span className="text-orange-400">{unit.status}</span>
                        {' · '}
                        {formatDate(unit.created_at)}
                      </p>
                      {unit.notes && (
                        <p className="text-sm text-gray-300 mt-2">{unit.notes}</p>
                      )}
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 text-gray-300 shrink-0">
                      {unit.status}
                    </span>
                  </div>
                  {unit.status === 'Registered' && (
                    <form action={requestRepair} className="mt-3">
                      <input type="hidden" name="id" value={unit.id} />
                      <input type="hidden" name="notes" value="Customer requested repair" />
                      <button
                        type="submit"
                        className="bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
                      >
                        Request Repair
                      </button>
                    </form>
                  )}
                  {unit.invoice_url && (
                    <a
                      href={unit.invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block mt-2 text-sm text-orange-400 hover:text-orange-300"
                    >
                      View file →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="border-t border-zinc-800 pt-6 pb-10 text-center space-y-2">
          <p className="text-sm text-gray-500">Savage Chainsaws LLC · Oviedo, Florida</p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <a href="https://savagechainsaws.com" target="_blank" rel="noreferrer" className="text-orange-400 hover:text-orange-300">
              Website
            </a>
            <a href="mailto:savagechainsaws@gmail.com" className="text-orange-400 hover:text-orange-300">
              Email us
            </a>
          </div>
          <p className="text-xs text-gray-600">Chainsaw Precision by Jesse</p>
        </footer>
      </div>
    </main>
  )
}