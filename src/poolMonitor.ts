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
    private provider: ethers.WebSocketProvider;
    private pool: ethers.Contract;
    private tokenCache: Map<string, TokenInfo>;
    private currentReserves: { reserve0: bigint; reserve1: bigint } = {
        reserve0: 0n,
        reserve1: 0n,
    };
    private token0: ethers.Contract;
    private token1: ethers.Contract;
    private seenTxHashes = new Set<string>();

    constructor() {
        this.alchemy = new Alchemy(config);

        // Use WebSocket provider for faster event delivery
        this.provider = new ethers.WebSocketProvider(
            `wss://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
        );

        // Initialize token contracts
        const tokenABI = [
            "function symbol() view returns (string)",
            "function decimals() view returns (uint8)",
        ];
        this.token0 = new ethers.Contract(
            USDC_ADDRESS,
            tokenABI,
            this.provider
        );
        this.token1 = new ethers.Contract(
            WETH_ADDRESS,
            tokenABI,
            this.provider
        );

        this.pool = new ethers.Contract(
            USDC_ETH_POOL,
            UNISWAP_V2_ERC20_ABI,
            this.provider
        );

        this.tokenCache = new Map([
            [
                WETH_ADDRESS.toLowerCase(),
                {
                    address: WETH_ADDRESS,
                    symbol: "WETH",
                    decimals: 18,
                },
            ],
            [
                USDC_ADDRESS.toLowerCase(),
                {
                    address: USDC_ADDRESS,
                    symbol: "USDC",
                    decimals: 6,
                },
            ],
        ]);

        this.initialize();
    }

    private async initialize() {
        try {
            // Get initial reserves
            const [reserve0, reserve1] = await this.pool.getReserves();
            this.currentReserves = { reserve0, reserve1 };

            this.setupSubscriptions();
        } catch (error) {
            console.error("Error initializing pool monitor:", error);
        }
    }

    private setupSubscriptions() {
        console.log("🚀 Setting up pool monitoring...");
        console.log(`📍 Monitoring USDC/ETH Pool: ${USDC_ETH_POOL}`);

        // Handle WebSocket connection issues
        this.provider.on("error", (error) => {
            console.log("WebSocket error:", error);
            this.initialize();
        });

        // Subscribe to all events from the pool
        this.pool.on("Mint", this.handleMint.bind(this));
        this.pool.on("Burn", this.handleBurn.bind(this));
        this.pool.on("Swap", this.handleSwap.bind(this));
        this.pool.on("Sync", this.handleSync.bind(this));
        this.pool.on("Approval", this.handleApproval.bind(this));

        console.log("✅ Pool monitoring established");
    }

    private getCurrentPrice(): string {
        const { reserve0, reserve1 } = this.currentReserves;
        return this.calculatePrice(
            reserve0,
            reserve1,
            this.tokenCache.get(USDC_ADDRESS.toLowerCase())!.decimals!,
            this.tokenCache.get(WETH_ADDRESS.toLowerCase())!.decimals!
        );
    }

    private async getTokenInfo(address: string): Promise<TokenInfo> {
        const lowerAddress = address.toLowerCase();
        if (this.tokenCache.has(lowerAddress)) {
            return this.tokenCache.get(lowerAddress)!;
        }

        try {
            const contract =
                lowerAddress === USDC_ADDRESS.toLowerCase()
                    ? this.token0
                    : this.token1;

            const [symbol, decimals] = await Promise.all([
                contract.symbol(),
                contract.decimals(),
            ]);

            const tokenInfo = { address, symbol, decimals };
            this.tokenCache.set(lowerAddress, tokenInfo);
            return tokenInfo;
        } catch (error) {
            console.error(`Error fetching token info for ${address}:`, error);
            return {
                address,
                symbol: address.slice(0, 10),
                decimals: 18,
            };
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

            const priceLog = await this.getCurrentPrice();

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
            console.log(`🔗 Sender: ${sender}`);
            if (priceLog) console.log(priceLog);
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

            const priceLog = await this.getCurrentPrice();

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
            console.log(`🔗 Sender: ${sender}`);
            console.log(`🎯 To: ${to}`);
            if (priceLog) console.log(priceLog);
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

            const priceInUSDC = this.getCurrentPrice();

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
            console.log(`🔗 Sender: ${sender}`);
            console.log(`🎯 To: ${to}`);
            console.log(`💵 ETH Price: ${priceInUSDC} USDC`);
            console.log(`🔗 Hash: ${event.log.transactionHash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error handling Swap event:", error);
        }
    }

    private calculatePrice(
        reserve0: bigint,
        reserve1: bigint,
        token0Decimals: number,
        token1Decimals: number
    ): string {
        // Calculate price in terms of token0 (USDC)
        // price = reserve0/10^token0decimals / (reserve1/10^token1decimals)
        const adjustedReserve0 =
            Number(reserve0) / Math.pow(10, token0Decimals);
        const adjustedReserve1 =
            Number(reserve1) / Math.pow(10, token1Decimals);
        const price = adjustedReserve0 / adjustedReserve1;
        return price.toFixed(2);
    }

    private async handleSync(reserve0: bigint, reserve1: bigint, event: any) {
        try {
            // Skip if we've already seen this transaction
            if (this.seenTxHashes.has(event.log.transactionHash)) {
                return;
            }
            this.seenTxHashes.add(event.log.transactionHash);

            // Update current reserves immediately
            this.currentReserves = { reserve0, reserve1 };
            const priceInUSDC = this.getCurrentPrice();

            console.log("\n🔄 Pool Sync Event");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Event: Sync`);
            console.log(
                `💰 Reserve0: ${this.formatValue(
                    reserve0,
                    this.tokenCache.get(USDC_ADDRESS.toLowerCase())!.decimals
                )} USDC`
            );
            console.log(
                `💰 Reserve1: ${this.formatValue(
                    reserve1,
                    this.tokenCache.get(WETH_ADDRESS.toLowerCase())!.decimals
                )} WETH`
            );
            console.log(`💵 ETH Price: ${priceInUSDC} USDC`);
            console.log(`🔗 Hash: ${event.log.transactionHash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

            // Clear old transaction hashes periodically
            if (this.seenTxHashes.size > 1000) {
                this.seenTxHashes.clear();
            }
        } catch (error) {
            console.error("Error handling Sync event:", error);
        }
    }

    private async handleApproval(
        owner: string,
        spender: string,
        value: bigint,
        event: any
    ) {
        try {
            const [token0Info, token1Info] = await Promise.all([
                this.getTokenInfo(USDC_ADDRESS),
                this.getTokenInfo(WETH_ADDRESS),
            ]);

            const priceLog = await this.getCurrentPrice();

            console.log("\n✅ Pool Approval Event");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Event: Approval`);
            console.log(`👤 Owner: ${owner}`);
            console.log(`🎯 Spender: ${spender}`);

            // Format value based on the token being approved
            const token = event.log.address;
            const tokenInfo =
                token.toLowerCase() === USDC_ADDRESS.toLowerCase()
                    ? token0Info
                    : token1Info;
            console.log(
                `💰 Value: ${this.formatValue(value, tokenInfo.decimals)} ${
                    tokenInfo.symbol
                }`
            );

            if (priceLog) console.log(priceLog);
            console.log(`🔗 Hash: ${event.log.transactionHash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error handling Approval event:", error);
        }
    }
}

// Start the monitor
const monitor = new PoolMonitor();
