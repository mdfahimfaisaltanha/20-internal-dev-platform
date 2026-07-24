import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Internal Developer Platform",
  description:
    "API gateway with hashed API keys, token-bucket rate limiting, a self-service portal, and live OpenAPI docs.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
