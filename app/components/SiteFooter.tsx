import ContactLinksBar from './ContactLinksBar'

export default function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-zinc-800 pt-5 pb-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm font-semibold shrink-0">
          SAVAGE <span className="text-orange-500">CHAINSAWS</span>
        </p>
        <ContactLinksBar variant="full" />
      </div>
    </footer>
  )
}
