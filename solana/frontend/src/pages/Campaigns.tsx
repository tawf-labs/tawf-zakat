import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'

interface Campaign {
  id: string
  title: string
  description: string
  target: number
  raised: number
  poolType: 'normal' | 'zakat' | 'wakaf'
}

const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: '1',
    title: 'Clean Water for Rural Communities',
    description: 'Providing clean drinking water access to underserved rural communities',
    target: 10000,
    raised: 4500,
    poolType: 'zakat',
  },
  {
    id: '2',
    title: 'Education Fund for Orphans',
    description: 'Supporting education expenses for orphaned children',
    target: 25000,
    raised: 12000,
    poolType: 'wakaf',
  },
  {
    id: '3',
    title: 'Emergency Relief Aid',
    description: 'Immediate relief supplies for disaster-affected areas',
    target: 50000,
    raised: 38000,
    poolType: 'zakat',
  },
]

export default function Campaigns() {
  const { connected } = useWallet()
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [donationAmount, setDonationAmount] = useState('')
  const [donationType, setDonationType] = useState<'public' | 'zk' | 'private'>('public')

  const handleDonate = (campaign: Campaign) => {
    setSelectedCampaign(campaign)
  }

  const submitDonation = () => {
    if (!selectedCampaign || !donationAmount) return
    // In production, this would call the Solana program
    alert(`Donation of ${donationAmount} IDRX (${donationType}) to "${selectedCampaign.title}" submitted!`)
    setSelectedCampaign(null)
    setDonationAmount('')
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold text-ink mb-8">Campaigns</h1>

      {!connected && (
        <div className="bg-gold/10 border border-gold/30 p-4 rounded-lg mb-8">
          <p className="text-ink">Connect your wallet to view and donate to campaigns</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {MOCK_CAMPAIGNS.map((campaign) => (
          <div key={campaign.id} className="bg-white p-6 rounded-2xl shadow-md">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs px-2 py-1 rounded-full ${
                campaign.poolType === 'zakat' ? 'bg-gold/20 text-gold' :
                campaign.poolType === 'wakaf' ? 'bg-blue-100 text-blue-600' :
                'bg-gray-100 text-gray-600'
              }`}>
                {campaign.poolType.toUpperCase()}
              </span>
            </div>
            <h3 className="text-xl font-bold text-ink mb-2">{campaign.title}</h3>
            <p className="text-muted text-sm mb-4">{campaign.description}</p>
            
            <div className="mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted">Raised</span>
                <span className="text-ink font-semibold">
                  ${campaign.raised.toLocaleString()} / ${campaign.target.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-gold h-2 rounded-full"
                  style={{ width: `${(campaign.raised / campaign.target) * 100}%` }}
                />
              </div>
            </div>

            {connected && (
              <button
                onClick={() => handleDonate(campaign)}
                className="w-full bg-gold text-ink py-2 rounded-full font-semibold hover:bg-gold/90 transition"
              >
                Donate
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Donation Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-2xl max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-ink mb-4">
              Donate to {selectedCampaign.title}
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Donation Type
                </label>
                <div className="flex space-x-2">
                  {(['public', 'zk', 'private'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setDonationType(type)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                        donationType === type
                          ? 'bg-gold text-ink'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {type === 'public' ? 'Public' : type === 'zk' ? 'ZK Proof' : 'Private'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">
                  Amount (IDRX)
                </label>
                <input
                  type="number"
                  value={donationAmount}
                  onChange={(e) => setDonationAmount(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gold focus:border-transparent"
                  placeholder="Enter amount"
                />
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-muted">
                  {donationType === 'public' && 'Your donation will be publicly visible on-chain.'}
                  {donationType === 'zk' && 'Amount hidden via ZK proof. Only eligibility is verified.'}
                  {donationType === 'private' && 'Fully private via Pedersen commitments. Amount never revealed.'}
                </p>
              </div>

              <div className="flex space-x-4">
                <button
                  onClick={() => setSelectedCampaign(null)}
                  className="flex-1 border-2 border-ink text-ink py-2 rounded-full font-semibold hover:bg-ink hover:text-sand transition"
                >
                  Cancel
                </button>
                <button
                  onClick={submitDonation}
                  className="flex-1 bg-gold text-ink py-2 rounded-full font-semibold hover:bg-gold/90 transition"
                >
                  Donate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
