import { ProxyForm } from "@/components/proxy-form"

export default function Page() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(600px circle at 50% 0%, color-mix(in oklch, var(--primary) 12%, transparent), transparent 70%)",
        }}
      />
      <div className="relative z-10 flex w-full max-w-xl flex-col items-center gap-8 py-16">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card">
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-foreground"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
            </svg>
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground">Veil</h1>
          <p className="max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
            A fast web proxy. Enter a URL to browse through the server. Requests, styles, and scripts are rewritten on
            the fly for low-latency page loads.
          </p>
        </div>

        <ProxyForm />

        <p className="max-w-md text-pretty text-center text-xs leading-relaxed text-muted-foreground">
          Works best on content and reading sites. Heavy single-page apps that rely on WebSockets (chat, streaming
          video, some logins) may not fully load.
        </p>
      </div>
    </main>
  )
}
