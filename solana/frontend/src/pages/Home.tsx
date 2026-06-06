import { useWallet } from '@solana/wallet-adapter-react'

export default function Home() {
  const { connected } = useWallet()

  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero Section */}
      <section className="text-center py-16">
        <h1 className="text-5xl font-bold text-ink mb-6">
          Privacy-Preserving <span className="text-gold">Zakat</span> Platform
        </h1>
        <p className="text-xl text-muted mb-8">
          Zero-knowledge proofs for confidential zakat compliance and donations on Solana
        </p>
        <div className="flex justify-center space-x-4">
          {connected ? (
            <a href="/campaigns" className="bg-gold text-ink px-8 py-3 rounded-full font-semibold hover:bg-gold/90 transition">
              Start Donating
            </a>
          ) : (
            <span className="bg-muted text-sand px-8 py-3 rounded-full font-semibold cursor-not-allowed">
              Connect Wallet to Start
            </span>
          )}
          <a href="/organizers" className="border-2 border-ink text-ink px-8 py-3 rounded-full font-semibold hover:bg-ink hover:text-sand transition">
            Become Organizer
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8 py-16">
        <div className="bg-white p-6 rounded-2xl shadow-md">
          <div className="w-12 h-12 bg-gold/20 rounded-full flex items-center justify-center mb-4">
            <span className="text-gold text-2xl">🔐</span>
          </div>
          <h3 className="text-xl font-bold text-ink mb-2">ZK Eligibility</h3>
          <p className="text-muted">
            Prove zakat eligibility without revealing income or assets
          </p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-md">
          <div className="w-12 h-12 bg-gold/20 rounded-full flex items-center justify-center mb-4">
            <span className="text-gold text-2xl">🗳️</span>
          </div>
          <h3 className="text-xl font-bold text-ink mb-2">Private Voting</h3>
          <p className="text-muted">
            Sharia council votes aggregated confidentially via MPC
          </p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-md">
          <div className="w-12 h-12 bg-gold/20 rounded-full flex items-center justify-center mb-4">
            <span className="text-gold text-2xl">💰</span>
          </div>
          <h3 className="text-xl font-bold text-ink mb-2">Anonymous Donations</h3>
          <p className="text-muted">
            Donate privately with commitment-based accounting
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16">
        <h2 className="text-3xl font-bold text-ink text-center mb-12">How It Works</h2>
        <div className="space-y-8">
          {[
            { step: 1, title: 'Connect Wallet', desc: 'Connect your Solana wallet (Phantom, Solflare)' },
            { step: 2, title: 'Check Eligibility', desc: 'ZK proof verifies zakat eligibility without revealing data' },
            { step: 3, title: 'Donate Privately', desc: 'Amount hidden via Pedersen commitments' },
            { step: 4, title: 'Track Impact', desc: 'Privacy-safe participation tracking' },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex items-start space-x-4">
              <div className="w-10 h-10 bg-gold rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-ink font-bold">{step}</span>
              </div>
              <div>
                <h4 className="text-lg font-bold text-ink">{title}</h4>
                <p className="text-muted">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
