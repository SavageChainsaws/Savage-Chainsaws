import { replyToMessage } from '../actions/unitWorkflow'

type UnitReply = { id: string; customer_name: string | null; is_admin: boolean; created_at: string; message: string }

// The messages thread for this unit (customer questions and admin
// replies, distinguished by is_admin) plus a small form to send a new
// admin reply.
export default function UnitRepliesSection({ unitId, messages }: { unitId: string; messages: UnitReply[] }) {
  return (
    <div className="mt-3 border-t border-zinc-800 pt-2.5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Messages</p>
      {messages.length > 0 && (
        <div className="space-y-2 mb-2">
          {messages.map(m => (
            <div
              key={m.id}
              className={`border rounded-lg px-3 py-2 ${
                m.is_admin ? 'bg-orange-500/10 border-orange-500/30' : 'bg-zinc-800/60 border-zinc-700'
              }`}
            >
              <p className="text-xs text-gray-500">
                {m.is_admin ? 'Savage Chainsaws' : m.customer_name || 'Customer'} -{' '}
                {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap mt-0.5">{m.message}</p>
            </div>
          ))}
        </div>
      )}
      <form action={replyToMessage} className="flex flex-col sm:flex-row gap-2">
        <input type="hidden" name="unit_id" value={unitId} />
        <input
          name="message"
          placeholder="Reply to the customer..."
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
        />
        <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium px-4 py-2 rounded-lg shrink-0">
          Reply
        </button>
      </form>
    </div>
  )
}
