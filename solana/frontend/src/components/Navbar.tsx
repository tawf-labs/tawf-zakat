import { Link } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'

export default function Navbar() {
  const { publicKey } = useWallet()

  return (
    <nav className="bg-ink text-sand shadow-lg">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-8">
            <Link to="/" className="text-xl font-bold text-gold">
              ZKT Hackathon
            </Link>
            <Link to="/organizers" className="hover:text-gold transition">
              Organizers
            </Link>
            <Link to="/campaigns" className="hover:text-gold transition">
              Campaigns
            </Link>
          </div>
          <div className="flex items-center space-x-4">
            {publicKey && (
              <span className="text-sm text-muted">
                {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
              </span>
            )}
            <WalletMultiButton className="!bg-gold !text-ink hover:!bg-gold/90" />
          </div>
        </div>
      </div>
    </nav>
  )
}
