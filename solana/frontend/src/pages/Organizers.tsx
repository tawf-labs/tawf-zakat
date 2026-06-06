import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

export default function Organizers() {
  const { connected } = useWallet()
  const [status, setStatus] = useState<'idle' | 'applied' | 'approved'>('idle')

  if (!connected) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <h1 className="text-4xl font-bold text-ink mb-4">Organizers</h1>
        <p className="text-muted">Connect your wallet to apply as an organizer</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold text-ink mb-8">Organizer Application</h1>

      {status === 'idle' && (
        <div className="bg-white p-8 rounded-2xl shadow-md">
          <h2 className="text-2xl font-bold text-ink mb-4">Apply as Organizer</h2>
          <p className="text-muted mb-6">
            Submit your application to become a verified organizer on the platform.
            Your application will be reviewed by the Sharia council.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-2">Organization Name</label>
              <input
                type="text"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
                placeholder="Enter organization name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-2">Description</label>
              <textarea
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
                rows={4}
                placeholder="Describe your organization"
              />
            </div>
            <button
              onClick={() => setStatus('applied')}
              className="w-full bg-gold text-ink py-3 rounded-full font-semibold hover:bg-gold/90 transition"
            >
              Submit Application
            </button>
          </div>
        </div>
      )}

      {status === 'applied' && (
        <div className="bg-white p-8 rounded-2xl shadow-md text-center">
          <div className="w-16 h-16 bg-gold/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-gold text-3xl">⏳</span>
          </div>
          <h2 className="text-2xl font-bold text-ink mb-2">Application Submitted</h2>
          <p className="text-muted mb-6">
            Your application is under review by the Sharia council.
            You will be notified once a decision is made.
          </p>
          <button
            onClick={() => setStatus('approved')}
            className="bg-gold text-ink px-6 py-2 rounded-full font-semibold hover:bg-gold/90 transition"
          >
            Simulate Approval
          </button>
        </div>
      )}

      {status === 'approved' && (
        <div className="bg-white p-8 rounded-2xl shadow-md text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-green-600 text-3xl">✓</span>
          </div>
          <h2 className="text-2xl font-bold text-ink mb-2">Application Approved!</h2>
          <p className="text-muted mb-6">
            Congratulations! You are now a verified organizer.
          </p>
          <a
            href="/campaigns"
            className="inline-block bg-gold text-ink px-6 py-2 rounded-full font-semibold hover:bg-gold/90 transition"
          >
            Create Campaign
          </a>
        </div>
      )}
    </div>
  )
}
