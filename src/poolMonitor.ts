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

// Uniswap V2 Pair ABI (from https://github.com/Uniswap/v2-core/blob/master/contracts/interfaces/IUniswapV2Pair.sol)
const UNISWAP_V2_PAIR_ABI = [
    // Events
    "event Approval(address indexed owner, address indexed spender, uint value)",
    "event Transfer(address indexed from, address indexed to, uint value)",
    "event Mint(address indexed sender, uint amount0, uint amount1)",
    "event Burn(address indexed sender, uint amount0, uint amount1, address indexed to)",
    "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
    "event Sync(uint112 reserve0, uint112 reserve1)",

    // Functions
    "function name() external pure returns (string memory)",
    "function symbol() external pure returns (string memory)",
    "function decimals() external pure returns (uint8)",
    "function totalSupply() external view returns (uint)",
    "function balanceOf(address owner) external view returns (uint)",
    "function allowance(address owner, address spender) external view returns (uint)",
    "function approve(address spender, uint value) external returns (bool)",
    "function transfer(address to, uint value) external returns (bool)",
    "function transferFrom(address from, address to, uint value) external returns (bool)",
    "function DOMAIN_SEPARATOR() external view returns (bytes32)",
    "function PERMIT_TYPEHASH() external pure returns (bytes32)",
    "function nonces(address owner) external view returns (uint)",
    "function permit(address owner, address spender, uint value, uint deadline, uint8 v, bytes32 r, bytes32 s) external",
    "function MINIMUM_LIQUIDITY() external pure returns (uint)",
    "function factory() external view returns (address)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function price0CumulativeLast() external view returns (uint)",
    "function price1CumulativeLast() external view returns (uint)",
    "function kLast() external view returns (uint)",
    "function mint(address to) external returns (uint liquidity)",
    "function burn(address to) external returns (uint amount0, uint amount1)",
    "function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external",
    "function skim(address to) external",
    "function sync() external",
    "function initialize(address, address) external",
];

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
    private readonly PRICE_SCALE_FACTOR = 10n ** 12n; // For fixed-point arithmetic
    private readonly USDC_SCALE = 10n ** 6n;
    private readonly WETH_SCALE = 10n ** 18n;
    private readonly TOKEN_DECIMALS = {
        [USDC_ADDRESS.toLowerCase()]: 6n,
        [WETH_ADDRESS.toLowerCase()]: 18n,
    };
    private readonly TOKEN_SCALES = {
        [USDC_ADDRESS.toLowerCase()]: 10n ** 6n,
        [WETH_ADDRESS.toLowerCase()]: 10n ** 18n,
    };

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

        // Use the correct Pair ABI
        this.pool = new ethers.Contract(
            USDC_ETH_POOL,
            UNISWAP_V2_PAIR_ABI,
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

        // Subscribe to each event type separately
        this.pool.on(
            "Swap",
            (
                sender: string,
                amount0In: bigint,
                amount1In: bigint,
                amount0Out: bigint,
                amount1Out: bigint,
                to: string,
                event: any
            ) => {
                console.log("🎯 Received Swap event");
                this.handleSwap(
                    sender,
                    amount0In,
                    amount1In,
                    amount0Out,
                    amount1Out,
                    to,
                    event
                );
            }
        );

        this.pool.on(
            "Sync",
            (reserve0: bigint, reserve1: bigint, event: any) => {
                console.log("🎯 Received Sync event");
                this.handleSync(reserve0, reserve1, event);
            }
        );

        this.pool.on(
            "Mint",
            (sender: string, amount0: bigint, amount1: bigint, event: any) => {
                console.log("🎯 Received Mint event");
                this.handleMint(sender, amount0, amount1, event);
            }
        );

        this.pool.on(
            "Burn",
            (
                sender: string,
                amount0: bigint,
                amount1: bigint,
                to: string,
                event: any
            ) => {
                console.log("🎯 Received Burn event");
                this.handleBurn(sender, amount0, amount1, to, event);
            }
        );

        // Test the connection by getting current reserves
        this.pool
            .getReserves()
            .then(([r0, r1]) => {
                console.log("✅ Successfully connected to pool");
                console.log(
                    `Current reserves: ${this.formatValue(
                        r0,
                        6
                    )} USDC, ${this.formatValue(r1, 18)} WETH`
                );
            })
            .catch((error) => {
                console.error("❌ Error connecting to pool:", error);
            });

        console.log("✅ Pool monitoring established");
    }

    private getCurrentPrice(): string {
        const { reserve0, reserve1 } = this.currentReserves;
        return this.calculatePriceOptimized(reserve0, reserve1);
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

    private formatValueOptimized(value: bigint, scale: bigint): string {
        const scaled = (value * this.PRICE_SCALE_FACTOR) / scale;
        return (Number(scaled) / Number(this.PRICE_SCALE_FACTOR)).toFixed(4);
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
            // Add this swap's hash to seen transactions immediately
            this.seenTxHashes.add(event.log.transactionHash);

            // Calculate new reserves based on the swap amounts
            const newReserve0 =
                this.currentReserves.reserve0 + amount0In - amount0Out;
            const newReserve1 =
                this.currentReserves.reserve1 + amount1In - amount1Out;
            const calculatedPrice = this.calculatePriceOptimized(
                newReserve0,
                newReserve1
            );

            console.log("\n💫 Pool Swap Event");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Event: Swap`);
            if (amount0In > 0n) {
                console.log(
                    `📥 Amount0In: ${this.formatTokenValue(
                        amount0In,
                        USDC_ADDRESS
                    )} USDC`
                );
            }
            if (amount1In > 0n) {
                console.log(
                    `📥 Amount1In: ${this.formatTokenValue(
                        amount1In,
                        WETH_ADDRESS
                    )} WETH`
                );
            }
            if (amount0Out > 0n) {
                console.log(
                    `📤 Amount0Out: ${this.formatTokenValue(
                        amount0Out,
                        USDC_ADDRESS
                    )} USDC`
                );
            }
            if (amount1Out > 0n) {
                console.log(
                    `📤 Amount1Out: ${this.formatTokenValue(
                        amount1Out,
                        WETH_ADDRESS
                    )} WETH`
                );
            }
            console.log(`🔗 Sender: ${sender}`);
            console.log(`🎯 To: ${to}`);
            console.log(`💵 Calculated Price: ${calculatedPrice} USDC`);
            console.log(`🔗 Hash: ${event.log.transactionHash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error handling Swap event:", error);
        }
    }

    private calculatePriceOptimized(
        reserve0: bigint,
        reserve1: bigint
    ): string {
        // Use fixed-point arithmetic to avoid floating point operations
        const price =
            (reserve0 * this.PRICE_SCALE_FACTOR * this.WETH_SCALE) /
            (reserve1 * this.USDC_SCALE);
        return (Number(price) / Number(this.PRICE_SCALE_FACTOR)).toFixed(2);
    }

    private async handleSync(reserve0: bigint, reserve1: bigint, event: any) {
        try {
            // Skip if we've already seen this transaction (it's likely from a Swap)
            if (this.seenTxHashes.has(event.log.transactionHash)) {
                const oldPrice = this.calculatePriceOptimized(
                    this.currentReserves.reserve0,
                    this.currentReserves.reserve1
                );
                // Update reserves and calculate new price
                this.currentReserves = { reserve0, reserve1 };
                const newPrice = this.calculatePriceOptimized(
                    reserve0,
                    reserve1
                );

                console.log("\n🔄 Related Sync Event");
                console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                console.log(`Previous Price: ${oldPrice} USDC`);
                console.log(`New Price: ${newPrice} USDC`);
                console.log(`🔗 Hash: ${event.log.transactionHash}`);
                console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                return;
            }

            // If we haven't seen this Sync (it's independent), process it
            this.currentReserves = { reserve0, reserve1 };
            const priceInUSDC = this.getCurrentPrice();

            console.log("\n🔄 Independent Sync Event");
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

    private formatTokenValue(value: bigint, tokenAddress: string): string {
        const scale =
            this.TOKEN_SCALES[tokenAddress.toLowerCase()] ?? this.WETH_SCALE;
        return this.formatValueOptimized(value, scale);
    }
}

// Start the monitor
const monitor = new PoolMonitor();
