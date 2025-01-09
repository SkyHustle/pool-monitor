import { Alchemy, Network, AlchemySubscription } from "alchemy-sdk";
import { ethers } from "ethers";
import dotenv from "dotenv";
import { UNISWAP_V2_ROUTER_ABI } from "./abis/uniswapV2Router";

dotenv.config();

// Constants
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
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
        this.tokenCache = new Map();
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
                tokenContract.symbol(),
                tokenContract.decimals(),
            ]);

            const tokenInfo = { address, symbol, decimals };
            this.tokenCache.set(address, tokenInfo);
            return tokenInfo;
        } catch (error) {
            return { address };
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

    private formatValue(value: string): string {
        return `${parseFloat(ethers.formatEther(value)).toFixed(4)} ETH`;
    }

    private async decodeRouterFunction(tx: any): Promise<{
        name: string;
        args: any[];
        formatted: { [key: string]: string };
    }> {
        try {
            const txData = tx.input;
            const decoded = this.router.interface.parseTransaction({
                data: txData,
            });

            if (!decoded) {
                throw new Error("Could not decode transaction data");
            }

            const formatted: { [key: string]: string } = {};

            // Format common parameters
            if (decoded.args.path) {
                formatted.path = await this.getTokenPathInfo(decoded.args.path);
            }
            if (decoded.args.amountIn) {
                formatted.amountIn = ethers.formatEther(decoded.args.amountIn);
            }
            if (decoded.args.amountOut) {
                formatted.amountOut = ethers.formatEther(
                    decoded.args.amountOut
                );
            }
            if (decoded.args.amountOutMin) {
                formatted.amountOutMin = ethers.formatEther(
                    decoded.args.amountOutMin
                );
            }
            if (decoded.args.amountInMax) {
                formatted.amountInMax = ethers.formatEther(
                    decoded.args.amountInMax
                );
            }
            if (decoded.args.to) {
                formatted.to = decoded.args.to;
            }

            return {
                name: decoded.name,
                args: decoded.args,
                formatted,
            };
        } catch (error) {
            console.error("Error decoding function:", error);
            return {
                name: "UNKNOWN",
                args: [],
                formatted: {},
            };
        }
    }

    private async handleRouterTransaction(tx: any) {
        try {
            const decodedFunction = await this.decodeRouterFunction(tx);
            const formattedValue = this.formatValue(tx.value);
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
        };
        return emojiMap[paramName] || "📋";
    }
}

// Start the monitor
const monitor = new RouterMonitor();
