# Uniswap V2 Pool Monitor

A real-time monitoring tool for Uniswap V2 liquidity pools, specifically focused on the USDC/ETH pool. This tool tracks and logs various pool events including swaps, liquidity additions/removals, and price changes.

## Features

-   Real-time monitoring of USDC/ETH Uniswap V2 pool
-   Tracks multiple event types:
    -   Swap events
    -   Liquidity additions (Mint)
    -   Liquidity removals (Burn)
    -   Reserve synchronization (Sync)
    -   Token approvals
-   Price calculation and tracking
-   WebSocket connection for instant event notifications
-   Detailed logging with formatted output

## Prerequisites

-   Node.js (v16 or higher)
-   pnpm (recommended) or npm
-   An Alchemy API key

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd pool-monitor
```

2. Install dependencies:

```bash
pnpm install
```

3. Create a `.env` file in the root directory:

```bash
ALCHEMY_API_KEY=your_alchemy_api_key_here
```

## Usage

The project includes two monitoring tools:

### Pool Monitor

To start the USDC/ETH pool monitor:

```bash
pnpm start:pool
```

### Router Monitor (if available)

To start the router monitor:

```bash
pnpm start
```

## Development

For development with auto-reloading:

```bash
pnpm dev
```

## Project Structure

```
pool-monitor/
├── src/
│   ├── poolMonitor.ts      # Main pool monitoring logic
│   ├── routerMonitor.ts    # Router monitoring logic
│   ├── abis/              # Contract ABIs
│   └── contracts/         # Contract interfaces
├── .env                   # Environment variables
├── package.json          # Project dependencies and scripts
└── tsconfig.json        # TypeScript configuration
```

## Environment Variables

-   `ALCHEMY_API_KEY`: Your Alchemy API key for Ethereum mainnet access

## Technical Details

-   Monitors the USDC/ETH pool at address: `0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc`
-   Uses WebSocket connection for real-time event monitoring
-   Implements efficient price calculation using fixed-point arithmetic
-   Handles transaction deduplication for related events
-   Provides formatted output with detailed event information

## Dependencies

-   `alchemy-sdk`: Ethereum API integration
-   `ethers`: Ethereum library for contract interaction
-   `dotenv`: Environment variable management
-   `ws`: WebSocket client
-   TypeScript development tools

## License

Use it don't abuse it.
