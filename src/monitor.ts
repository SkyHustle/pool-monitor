import { Alchemy, Network, AlchemySubscription } from "alchemy-sdk";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { UNISWAP_V2_ROUTER_ABI } from "./abis/uniswapV2Router";

dotenv.config();

// Constants
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
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

class RouterMonitor {
    private alchemy: Alchemy;
    private provider: ethers.JsonRpcProvider;
    private router: ethers.Contract;
    private tokenCache: Map<string, TokenInfo>;
    private iface: ethers.Interface;

    constructor() {
        this.alchemy = new Alchemy(config);
        this.provider = new ethers.JsonRpcProvider(
            `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
        );
        this.router = new ethers.Contract(
            UNISWAP_V2_ROUTER,
            UNISWAP_V2_ROUTER_ABI,
            this.provider
        );
        this.iface = new ethers.Interface(UNISWAP_V2_ROUTER_ABI);
        this.tokenCache = new Map();

        // Pre-cache WETH
        this.tokenCache.set(WETH_ADDRESS, {
            address: WETH_ADDRESS,
            symbol: "WETH",
            decimals: 18,
        });

        this.setupSubscriptions();
    }

    private async setupSubscriptions() {
        console.log("🚀 Setting up router monitoring...");
        console.log(`📍 Monitoring Uniswap V2 Router: ${UNISWAP_V2_ROUTER}`);

        this.alchemy.ws.on(
            {
                method: AlchemySubscription.PENDING_TRANSACTIONS,
                toAddress: UNISWAP_V2_ROUTER,
            },
            this.handleRouterTransaction.bind(this)
        );

        console.log("✅ Router monitoring established");
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

    private async getTokenPathInfo(path: string[]): Promise<string> {
        const tokenInfos = await Promise.all(
            path.map((addr) => this.getTokenInfo(addr))
        );
        return tokenInfos
            .map((info) => info.symbol || info.address.slice(0, 10))
            .join(" → ");
    }

    private formatValue(value: string | bigint, decimals: number = 18): string {
        try {
            const formatted = ethers.formatUnits(value, decimals);
            return `${parseFloat(formatted).toFixed(4)}`;
        } catch (error) {
            return "0.0000";
        }
    }

    private async decodeRouterFunction(tx: any): Promise<{
        name: string;
        args: any[];
        formatted: { [key: string]: string };
    }> {
        try {
            const txData = tx.input;
            const signature = txData.slice(0, 10);
            console.log(
                `\n🔍 Debug: Attempting to decode function with signature: ${signature}`
            );

            const decoded = this.iface.parseTransaction({ data: txData });

            if (!decoded) {
                throw new Error("Could not decode transaction data");
            }

            const formatted: { [key: string]: string } = {};

            // Format common parameters
            if (decoded.args) {
                if (decoded.args.path) {
                    formatted.path = await this.getTokenPathInfo(
                        decoded.args.path
                    );
                }
                if (decoded.args.amountIn) {
                    const firstToken = decoded.args.path?.[0];
                    const tokenInfo = firstToken
                        ? await this.getTokenInfo(firstToken)
                        : null;
                    formatted.amountIn = `${this.formatValue(
                        decoded.args.amountIn,
                        tokenInfo?.decimals
                    )} ${tokenInfo?.symbol || ""}`;
                }
                if (decoded.args.amountOut) {
                    const lastToken =
                        decoded.args.path?.[decoded.args.path.length - 1];
                    const tokenInfo = lastToken
                        ? await this.getTokenInfo(lastToken)
                        : null;
                    formatted.amountOut = `${this.formatValue(
                        decoded.args.amountOut,
                        tokenInfo?.decimals
                    )} ${tokenInfo?.symbol || ""}`;
                }
                if (decoded.args.amountOutMin) {
                    const lastToken =
                        decoded.args.path?.[decoded.args.path.length - 1];
                    const tokenInfo = lastToken
                        ? await this.getTokenInfo(lastToken)
                        : null;
                    formatted.amountOutMin = `${this.formatValue(
                        decoded.args.amountOutMin,
                        tokenInfo?.decimals
                    )} ${tokenInfo?.symbol || ""}`;
                }
                if (decoded.args.amountInMax) {
                    const firstToken = decoded.args.path?.[0];
                    const tokenInfo = firstToken
                        ? await this.getTokenInfo(firstToken)
                        : null;
                    formatted.amountInMax = `${this.formatValue(
                        decoded.args.amountInMax,
                        tokenInfo?.decimals
                    )} ${tokenInfo?.symbol || ""}`;
                }
                if (decoded.args.to) {
                    formatted.to = decoded.args.to;
                }
                // Add liquidity specific parameters
                if (decoded.args.amountADesired) {
                    const tokenInfo = decoded.args.tokenA
                        ? await this.getTokenInfo(decoded.args.tokenA)
                        : null;
                    formatted.amountADesired = `${this.formatValue(
                        decoded.args.amountADesired,
                        tokenInfo?.decimals
                    )} ${tokenInfo?.symbol || ""}`;
                }
                if (decoded.args.amountBDesired) {
                    const tokenInfo = decoded.args.tokenB
                        ? await this.getTokenInfo(decoded.args.tokenB)
                        : null;
                    formatted.amountBDesired = `${this.formatValue(
                        decoded.args.amountBDesired,
                        tokenInfo?.decimals
                    )} ${tokenInfo?.symbol || ""}`;
                }
            }

            return {
                name: decoded.name,
                args: decoded.args || [],
                formatted,
            };
        } catch (error) {
            // Try to get at least the function signature
            try {
                const signature = tx.input.slice(0, 10);
                console.log(
                    `\n❌ Debug: Initial decode failed. Function signature: ${signature}`
                );
                console.log(`📄 Debug: Full input data: ${tx.input}`);

                // Try to match against known function signatures
                const functionNames = Object.keys(this.iface.fragments).filter(
                    (name) => {
                        try {
                            const selector =
                                this.iface.getFunction(name)?.selector;
                            console.log(
                                `🔍 Debug: Checking against ${name} (${selector})`
                            );
                            return selector === signature;
                        } catch {
                            return false;
                        }
                    }
                );

                if (functionNames.length === 0) {
                    console.log(
                        "⚠️ Debug: No matching function signature found in ABI"
                    );
                }

                return {
                    name: functionNames[0] || "UNKNOWN",
                    args: [],
                    formatted: {},
                };
            } catch (e) {
                console.log(
                    "💥 Debug: Failed to decode even the function signature"
                );
                return {
                    name: "UNKNOWN",
                    args: [],
                    formatted: {},
                };
            }
        }
    }

    private async handleRouterTransaction(tx: any) {
        try {
            const decodedFunction = await this.decodeRouterFunction(tx);
            const formattedValue = `${this.formatValue(tx.value)} ETH`;
            const gasPrice = ethers.formatUnits(
                tx.maxFeePerGas || tx.gasPrice,
                "gwei"
            );

            // Create a formatted log entry
            console.log("\n🔄 Router Transaction Detected");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Function: ${decodedFunction.name}`);

            // Log formatted parameters
            Object.entries(decodedFunction.formatted).forEach(
                ([key, value]) => {
                    const emoji = this.getParameterEmoji(key);
                    console.log(`${emoji} ${key}: ${value}`);
                }
            );

            // Log transaction details
            console.log(`💰 Value: ${formattedValue}`);
            console.log(`👤 From: ${tx.from}`);
            console.log(
                `⛽ Gas Price: ${parseFloat(gasPrice).toFixed(2)} gwei`
            );
            console.log(`🔗 Hash: ${tx.hash}`);
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error processing router transaction:", error);
        }
    }

    private getParameterEmoji(paramName: string): string {
        const emojiMap: { [key: string]: string } = {
            path: "🛣️",
            amountIn: "📥",
            amountOut: "📤",
            amountOutMin: "📉",
            amountInMax: "📈",
            to: "🎯",
            amountADesired: "💎",
            amountBDesired: "💎",
            liquidity: "💧",
        };
        return emojiMap[paramName] || "📋";
    }
}

// Start the monitor
const monitor = new RouterMonitor();
