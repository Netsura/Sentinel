import './global.css';

export const metadata = {
  title: 'Sentinel | Security posture',
  description: 'Security monitoring and vulnerability assessment for authorized assets.',
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
