import { Alchemy, Network, AlchemySubscription } from "alchemy-sdk";
import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Constants
const USDC_ETH_POOL = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc";
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

if (!ALCHEMY_API_KEY) {
    throw new Error("ALCHEMY_API_KEY not found in environment variables");
}

// Uniswap V2 Pool Function Signatures
const FUNCTION_SIGNATURES = {
    SWAP: "0x022c0d9f", // swap(uint amount0Out, uint amount1Out, address to, bytes data)
    ADD_LIQUIDITY: "0xf305d719", // addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline)
    REMOVE_LIQUIDITY: "0xbaa2abde", // removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline)
    MINT: "0x6a627842", // mint(address to)
    BURN: "0x3c6bb436", // burn(address to)
    SYNC: "0xfff6cae9", // sync()
};

// Router Function Signatures
const ROUTER_SIGNATURES = {
    SWAP_ETH_FOR_EXACT_TOKENS: "0xfb3bdb41", // swapETHForExactTokens(uint amountOut, address[] path, address to, uint deadline)
    SWAP_EXACT_ETH_FOR_TOKENS: "0x7ff36ab5", // swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline)
    SWAP_EXACT_TOKENS_FOR_ETH: "0x18cbafe5", // swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)
    SWAP_TOKENS_FOR_EXACT_ETH: "0x4a25d94a", // swapTokensForExactETH(uint amountOut, uint amountInMax, address[] path, address to, uint deadline)
    SWAP_EXACT_TOKENS_FOR_TOKENS: "0x38ed1739", // swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)
    SWAP_TOKENS_FOR_EXACT_TOKENS: "0x8803dbee", // swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] path, address to, uint deadline)
    ADD_LIQUIDITY_ETH: "0xf305d719", // addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline)
    REMOVE_LIQUIDITY_ETH: "0xbaa2abde", // removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline)
};

// Configure Alchemy SDK
const config = {
    apiKey: ALCHEMY_API_KEY,
    network: Network.ETH_MAINNET,
};

class RouterMonitor {
    private alchemy: Alchemy;

    constructor() {
        this.alchemy = new Alchemy(config);
        this.setupSubscriptions();
    }

    private async setupSubscriptions() {
        console.log("Setting up router monitoring...");
        console.log(`Monitoring Uniswap V2 Router: ${UNISWAP_V2_ROUTER}`);

        this.alchemy.ws.on(
            {
                method: AlchemySubscription.PENDING_TRANSACTIONS,
                toAddress: UNISWAP_V2_ROUTER,
            },
            this.handleRouterTransaction.bind(this)
        );

        console.log("Router monitoring established");
    }

    private getRouterFunctionName(input: string): string {
        const signature = input.slice(0, 10);
        for (const [name, sig] of Object.entries(ROUTER_SIGNATURES)) {
            if (signature === sig) return name;
        }
        return "UNKNOWN";
    }

    private extractTokenPath(input: string): string[] {
        // Skip function signature (first 10 chars) and parameters before path
        const inputData = input.slice(10);
        // Extract 20-byte (40 hex chars) sequences that could be addresses
        const addresses = (inputData.match(/.{40}/g) || []) as string[];

        return addresses.map((addr) => `0x${addr}`);
    }

    private formatValue(value: string): string {
        return `${parseFloat(ethers.formatEther(value)).toFixed(4)} ETH`;
    }

    private async handleRouterTransaction(tx: any) {
        try {
            const functionName = this.getRouterFunctionName(tx.input);
            const formattedValue = this.formatValue(tx.value);
            const gasPrice = ethers.formatUnits(
                tx.maxFeePerGas || tx.gasPrice,
                "gwei"
            );
            const tokenPath = this.extractTokenPath(tx.input);

            // Create a formatted log entry
            console.log("\n🔄 Router Transaction Detected");
            console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            console.log(`📝 Type: ${functionName}`);
            console.log(`💰 Value: ${formattedValue}`);
            console.log(`🛣️  Token Path: ${tokenPath.join(" → ")}`);
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
}

// Start the monitor
const monitor = new RouterMonitor();
