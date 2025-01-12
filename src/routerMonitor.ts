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
    private knownSignatures: { [key: string]: string } = {
        "0x791ac947": "swapExactTokensForTokensSupportingFeeOnTransferTokens",
        "0x38ed1739": "swapExactTokensForTokens",
        "0x7ff36ab5": "swapExactETHForTokens",
        "0x18cbafe5": "swapExactTokensForETH",
        "0xfb3bdb41": "swapETHForExactTokens",
        "0x4a25d94a": "swapTokensForExactETH",
        "0x8803dbee": "swapTokensForExactTokens",
        "0xf305d719": "addLiquidityETH",
        "0xe8e33700": "addLiquidity",
        "0xbaa2abde": "removeLiquidity",
        "0x02751cec": "removeLiquidityETH",
    };

    private functionTypes: { [key: string]: string[] } = {
        swapExactTokensForTokensSupportingFeeOnTransferTokens: [
            "uint256", // amountIn
            "uint256", // amountOutMin
            "address[]", // path
            "address", // to
            "uint256", // deadline
        ],
        swapExactTokensForTokens: [
            "uint256", // amountIn
            "uint256", // amountOutMin
            "address[]", // path
            "address", // to
            "uint256", // deadline
        ],
        swapExactETHForTokens: [
            "uint256", // amountOutMin
            "address[]", // path
            "address", // to
            "uint256", // deadline
        ],
        swapExactTokensForETH: [
            "uint256", // amountIn
            "uint256", // amountOutMin
            "address[]", // path
            "address", // to
            "uint256", // deadline
        ],
        // Add other function types as needed
    };

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

    private decodeParameters(types: string[], data: string): any {
        const abiCoder = new ethers.AbiCoder();
        // Remove function signature (first 4 bytes / 8 hex chars + '0x')
        const params = "0x" + data.slice(10);
        try {
            return abiCoder.decode(types, params);
        } catch (error) {
            console.log("⚠️ Failed to decode parameters:", error);
            return null;
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

            if (this.knownSignatures[signature]) {
                const functionName = this.knownSignatures[signature];
                console.log(
                    `🎯 Debug: Found matching signature for ${functionName}`
                );

                // Get parameter types for this function
                const types = this.functionTypes[functionName];
                if (types) {
                    const decoded = this.decodeParameters(types, txData);
                    if (decoded) {
                        const formatted: { [key: string]: string } = {};

                        // Format parameters based on the function type
                        if (decoded[2] && Array.isArray(decoded[2])) {
                            // path array
                            const path = decoded[2];
                            formatted.path = await this.getTokenPathInfo(path);

                            if (decoded[0]) {
                                // amountIn
                                const firstToken = path[0];
                                const tokenInfo = await this.getTokenInfo(
                                    firstToken
                                );
                                formatted.amountIn = `${this.formatValue(
                                    decoded[0],
                                    tokenInfo.decimals
                                )} ${tokenInfo.symbol}`;
                            }

                            if (decoded[1]) {
                                // amountOutMin
                                const lastToken = path[path.length - 1];
                                const outTokenInfo = await this.getTokenInfo(
                                    lastToken
                                );
                                formatted.amountOutMin = `${this.formatValue(
                                    decoded[1],
                                    outTokenInfo.decimals
                                )} ${outTokenInfo.symbol}`;
                            }

                            if (decoded[3]) {
                                // to address
                                formatted.to = decoded[3];
                            }
                        }

                        return {
                            name: functionName,
                            args: decoded,
                            formatted,
                        };
                    }
                }
            }

            // Try the interface if manual decoding fails
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
                // First try our known signatures map
                if (this.knownSignatures[signature]) {
                    // Try to decode parameters even if initial parsing failed
                    try {
                        const decodedParams = this.iface.decodeFunctionData(
                            this.knownSignatures[signature],
                            tx.input
                        );

                        const formatted: { [key: string]: string } = {};

                        // Format parameters based on the function type
                        if (decodedParams.path) {
                            formatted.path = await this.getTokenPathInfo(
                                decodedParams.path
                            );

                            if (decodedParams.amountIn) {
                                const firstToken = decodedParams.path[0];
                                const tokenInfo = await this.getTokenInfo(
                                    firstToken
                                );
                                formatted.amountIn = `${this.formatValue(
                                    decodedParams.amountIn,
                                    tokenInfo.decimals
                                )} ${tokenInfo.symbol}`;
                            }

                            if (decodedParams.amountOutMin) {
                                const lastToken =
                                    decodedParams.path[
                                        decodedParams.path.length - 1
                                    ];
                                const outTokenInfo = await this.getTokenInfo(
                                    lastToken
                                );
                                formatted.amountOutMin = `${this.formatValue(
                                    decodedParams.amountOutMin,
                                    outTokenInfo.decimals
                                )} ${outTokenInfo.symbol}`;
                            }

                            if (decodedParams.to) {
                                formatted.to = decodedParams.to;
                            }
                        }

                        return {
                            name: this.knownSignatures[signature],
                            args: decodedParams,
                            formatted,
                        };
                    } catch (decodeError) {
                        console.log(
                            "⚠️ Debug: Failed to decode parameters:",
                            decodeError
                        );
                        return {
                            name: this.knownSignatures[signature],
                            args: [],
                            formatted: {},
                        };
                    }
                }

                // Then try the interface
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

            // Standard order of fields
            const standardFields = [
                ["Function", decodedFunction.name],
                ["path", decodedFunction.formatted.path],
                ["amountIn", decodedFunction.formatted.amountIn],
                ["amountOutMin", decodedFunction.formatted.amountOutMin],
                ["amountOut", decodedFunction.formatted.amountOut],
                ["amountInMax", decodedFunction.formatted.amountInMax],
                ["to", decodedFunction.formatted.to],
                ["Value", formattedValue],
                ["From", tx.from],
                ["Gas Price", `${parseFloat(gasPrice).toFixed(2)} gwei`],
                ["Hash", tx.hash],
            ];

            // Log fields in standard order, skipping empty ones
            standardFields.forEach(([key, value]) => {
                if (value) {
                    const emoji = this.getParameterEmoji(key.toLowerCase());
                    console.log(`${emoji} ${key}: ${value}`);
                }
            });

            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
        } catch (error) {
            console.error("Error processing router transaction:", error);
        }
    }

    private getParameterEmoji(paramName: string): string {
        const emojiMap: { [key: string]: string } = {
            function: "📝",
            path: "🛣️",
            amountin: "📥",
            amountout: "📤",
            amountoutmin: "📉",
            amountinmax: "📈",
            to: "🎯",
            value: "💰",
            from: "👤",
            "gas price": "⛽",
            hash: "🔗",
            amountadesired: "💎",
            amountbdesired: "💎",
            liquidity: "💧",
        };
        return emojiMap[paramName] || "📋";
    }
}

// Start the monitor
const monitor = new RouterMonitor();
