# ZK Zakat

Private, verifiable Zakat with ZK proofs - A modern web application for conducting Zakat donations with privacy and transparency using zero-knowledge proofs.

## Overview

ZK Zakat is a Next.js-based web application that enables private and verifiable Zakat donations through zero-knowledge proof technology. The platform provides a secure way for users to fulfill their Zakat obligations while maintaining privacy and ensuring transparency through cryptographic proofs.

## Features

- **Zero-Knowledge Proofs**: Privacy-preserving verification of Zakat calculations
- **Campaign Management**: Create and participate in Zakat campaigns
- **Wallet Integration**: Built-in Web3 wallet support
- **Dark/Light Mode**: User-friendly theme switching
- **Responsive Design**: Optimized for both desktop and mobile devices
- **Dashboard**: Separate dashboards for organizers and users
- **DAO Governance**: Decentralized autonomous organization features

## Tech Stack

### Frontend
- **Next.js 15.2.4** - React framework with App Router
- **React 19** - UI library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework

### UI Components
- **Radix UI** - Accessible component primitives
- **Lucide React** - Icon library
- **Shadcn/ui** - Component library built on Radix UI

### State & Form Management
- **React Hook Form** - Form handling with validation
- **Zod** - Schema validation
- **Sonner** - Toast notifications

### Additional Libraries
- **Next Themes** - Theme management
- **Geist Fonts** - Modern typography
- **Recharts** - Data visualization
- **Date-fns** - Date manipulation
- **Embla Carousel** - Carousel components

### Development Tools
- **ESLint** - Code linting
- **PostCSS** - CSS processing
- **Vercel Analytics** - Performance monitoring

## Project Structure

```
app/                    # Next.js app router pages
  campaigns/         # Campaign-related pages
  dao/              # DAO governance page
  dashboard/        # User and organizer dashboards
  bayar/            # Payment/donation page
  layout.tsx        # Root layout
  page.tsx          # Home page
components/            # React components
  campaigns/        # Campaign-specific components
  donations/        # Donation-related components
  landing/          # Landing page components
  layout/           # Layout components
  shared/           # Shared components
  ui/               # UI component library
  wallet/           # Web3 wallet components
data/                 # Static data and mock data
hooks/                # Custom React hooks
lib/                  # Utility functions and configurations
public/               # Static assets
styles/               # Global styles
```

## Getting Started

### Prerequisites

- Node.js (version 18 or higher)
- pnpm (recommended) or npm/yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/tawf-labs/zkt-app.git
cd zkt-app
```

2. Install dependencies:
```bash
pnpm install
```

3. Start the development server:
```bash
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Key Pages

- **Home (`/`)** - Landing page with hero section and featured campaigns
- **Campaigns (`/campaigns`)** - Browse and discover Zakat campaigns
- **Campaign Details (`/campaigns/[id]`)** - View individual campaign details
- **DAO (`/dao`)** - Participate in governance and voting
- **Payment (`/bayar`)** - Process Zakat donations
- **User Dashboard (`/dashboard/user`)** - User-specific dashboard
- **Organizer Dashboard (`/dashboard/organizer`)** - Campaign organizer tools

## Configuration

### Environment Variables

Create a `.env.local` file in the root directory for environment-specific variables:

```env
# Web3 Configuration
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_wallet_connect_project_id
NEXT_PUBLIC_RPC_URL=https://mainnet.infura.io/v3/your_infura_project_id

# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Zero-Knowledge Proof Configuration
ZK_CIRCUIT_PATH=./circuits
ZK_PROVING_KEY_PATH=./keys/proving_key.zkey

# Database (if applicable)
DATABASE_URL=postgresql://username:password@localhost:5432/zakat_db

# Analytics
NEXT_PUBLIC_VERCEL_ANALYTICS_ID=your_vercel_analytics_id
```

### Build Configuration

The application is configured to:
- Ignore ESLint errors during builds
- Ignore TypeScript build errors (for development)
- Use unoptimized images for better compatibility

## Development Notes

- The application uses the App Router pattern introduced in Next.js 13
- All components are TypeScript-first with proper type definitions
- The UI is built using Radix UI primitives with custom styling
- Theme support is built-in using the next-themes library
- Web3 wallet integration is handled through a custom context provider

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the Apache License, Version 2.0.

Copyright 2026 Tawf Labs

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## Support

For support and questions, please open an issue in the repository or contact the development team.