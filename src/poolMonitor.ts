import { Alchemy, Network, AlchemySubscription } from "alchemy-sdk";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { UNISWAP_V2_ERC20_ABI } from "./abis/uniswapV2ERC20";

dotenv.config();

// Constants
const USDC_ETH_POOL = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

if (!ALCHEMY_API_KEY) {
    throw new Error("ALCHEMY_API_KEY not found in environment variables");
}

// Configure Alchemy SDK
const config = {
    apiKey: ALCHEMY_API_KEY,
    network: Network.ETH_MAINNET,
};

interface TokenInfo {
    address: string;
    symbol?: string;
    decimals?: number;
}

class PoolMonitor {
    private alchemy: Alchemy;
    private provider: ethers.JsonRpcProvider;
    private pool: ethers.Contract;
    private tokenCache: Map<string, TokenInfo>;

    constructor() {
        this.alchemy = new Alchemy(config);
        this.provider = new ethers.JsonRpcProvider(
            `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
        );
        this.pool = new ethers.Contract(
            USDC_ETH_POOL,
            UNISWAP_V2_ERC20_ABI,
            this.provider
        );
        this.tokenCache = new Map();

        // Pre-cache token info
        this.tokenCache.set(WETH_ADDRESS, {
            address: WETH_ADDRESS,
            symbol: "WETH",
            decimals: 18,
        });
        this.tokenCache.set(USDC_ADDRESS, {
            address: USDC_ADDRESS,
            symbol: "USDC",
            decimals: 6,
        });

        this.setupSubscriptions();
    }

    private async setupSubscriptions() {
        console.log("🚀 Setting up pool monitoring...");
        console.log(`📍 Monitoring USDC/ETH Pool: ${USDC_ETH_POOL}`);

        // Subscribe to all events from the pool
        this.pool.on("Mint", this.handleMint.bind(this));
        this.pool.on("Burn", this.handleBurn.bind(this));
        this.pool.on("Swap", this.handleSwap.bind(this));
        this.pool.on("Sync", this.handleSync.bind(this));

        console.log("✅ Pool monitoring established");
    }

    private async getTokenInfo(address: string): Promise<TokenInfo> {
        if (this.tokenCache.has(address)) {
            return this.tokenCache.get(address)!;
        }

        try {
            const tokenContract = new ethers.Contract(
                address,
                [
                    "function symbol() view returns (string)",
                    "function decimals() view returns (uint8)",
                ],
                this.provider
            );

            const [symbol, decimals] = await Promise.all([
                tokenContract.symbol().catch(() => null),
                tokenContract.decimals().catch(() => 18),
            ]);

            const tokenInfo = {
                address,
                symbol: symbol || address.slice(0, 10),
                decimals,
            };
            this.tokenCache.set(address, tokenInfo);
            return tokenInfo;
        } catch (error) {
            const tokenInfo = {
                address,
                symbol: address.slice(0, 10),
                decimals: 18,
            };
            this.tokenCache.set(address, tokenInfo);
            return tokenInfo;
        }
    }

    private formatValue(value: string | bigint, decimals: number = 18): string {
        try {
            const formatted = ethers.formatUnits(value, decimals);
            return `${parseFloat(formatted).toFixed(4)}`;
        } catch (error) {
            return "0.0000";
        }
    }

    private async handleMint(
        sender: string,
        amount0: bigint,
        amount1: bigint,
        event: any
    ) {
        try {
            const [token0Info, token1Info] = await Promise.all([
                this.getTokenInfo(USDC_ADDRESS),
                this.getTokenInfo(WETH_ADDRESS),
            ]);

            console.log("\n🌱 Pool Mint Event");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Event: Mint`);
            console.log(
                `💰 Amount0: ${this.formatValue(
                    amount0,
                    token0Info.decimals
                )} ${token0Info.symbol}`
            );
            console.log(
                `💰 Amount1: ${this.formatValue(
                    amount1,
                    token1Info.decimals
                )} ${token1Info.symbol}`
            );
            console.log(`👤 Sender: ${sender}`);
            console.log(`🔗 Hash: ${event.log.transactionHash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error handling Mint event:", error);
        }
    }

    private async handleBurn(
        sender: string,
        amount0: bigint,
        amount1: bigint,
        to: string,
        event: any
    ) {
        try {
            const [token0Info, token1Info] = await Promise.all([
                this.getTokenInfo(USDC_ADDRESS),
                this.getTokenInfo(WETH_ADDRESS),
            ]);

            console.log("\n🔥 Pool Burn Event");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Event: Burn`);
            console.log(
                `💰 Amount0: ${this.formatValue(
                    amount0,
                    token0Info.decimals
                )} ${token0Info.symbol}`
            );
            console.log(
                `💰 Amount1: ${this.formatValue(
                    amount1,
                    token1Info.decimals
                )} ${token1Info.symbol}`
            );
            console.log(`👤 Sender: ${sender}`);
            console.log(`🎯 To: ${to}`);
            console.log(`🔗 Hash: ${event.log.transactionHash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error handling Burn event:", error);
        }
    }

    private async handleSwap(
        sender: string,
        amount0In: bigint,
        amount1In: bigint,
        amount0Out: bigint,
        amount1Out: bigint,
        to: string,
        event: any
    ) {
        try {
            const [token0Info, token1Info] = await Promise.all([
                this.getTokenInfo(USDC_ADDRESS),
                this.getTokenInfo(WETH_ADDRESS),
            ]);

            console.log("\n💫 Pool Swap Event");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Event: Swap`);
            if (amount0In > 0n) {
                console.log(
                    `📥 Amount0In: ${this.formatValue(
                        amount0In,
                        token0Info.decimals
                    )} ${token0Info.symbol}`
                );
            }
            if (amount1In > 0n) {
                console.log(
                    `📥 Amount1In: ${this.formatValue(
                        amount1In,
                        token1Info.decimals
                    )} ${token1Info.symbol}`
                );
            }
            if (amount0Out > 0n) {
                console.log(
                    `📤 Amount0Out: ${this.formatValue(
                        amount0Out,
                        token0Info.decimals
                    )} ${token0Info.symbol}`
                );
            }
            if (amount1Out > 0n) {
                console.log(
                    `📤 Amount1Out: ${this.formatValue(
                        amount1Out,
                        token1Info.decimals
                    )} ${token1Info.symbol}`
                );
            }
            console.log(`👤 Sender: ${sender}`);
            console.log(`🎯 To: ${to}`);
            console.log(`🔗 Hash: ${event.log.transactionHash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error handling Swap event:", error);
        }
    }

    private async handleSync(reserve0: bigint, reserve1: bigint, event: any) {
        try {
            const [token0Info, token1Info] = await Promise.all([
                this.getTokenInfo(USDC_ADDRESS),
                this.getTokenInfo(WETH_ADDRESS),
            ]);

            console.log("\n🔄 Pool Sync Event");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Event: Sync`);
            console.log(
                `💰 Reserve0: ${this.formatValue(
                    reserve0,
                    token0Info.decimals
                )} ${token0Info.symbol}`
            );
            console.log(
                `💰 Reserve1: ${this.formatValue(
                    reserve1,
                    token1Info.decimals
                )} ${token1Info.symbol}`
            );
            console.log(`🔗 Hash: ${event.log.transactionHash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error handling Sync event:", error);
        }
    }
}

// Start the monitor
const monitor = new PoolMonitor();