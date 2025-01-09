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
    SWAP_ETH_FOR_EXACT_TOKENS: "0xfb3bdb41",
    SWAP_EXACT_ETH_FOR_TOKENS: "0x7ff36ab5",
    SWAP_EXACT_TOKENS_FOR_ETH: "0x18cbafe5",
    SWAP_TOKENS_FOR_EXACT_ETH: "0x4a25d94a",
    SWAP_EXACT_TOKENS_FOR_TOKENS: "0x38ed1739",
    SWAP_TOKENS_FOR_EXACT_TOKENS: "0x8803dbee",
};

// Configure Alchemy SDK
const config = {
    apiKey: ALCHEMY_API_KEY,
    network: Network.ETH_MAINNET,
};

// Types
interface TransactionData {
    hash: string;
    from: string;
    to: string;
    value: string;
    type: string;
    timestamp: number;
}

class TransactionMonitor {
    private alchemy: Alchemy;

    constructor() {
        this.alchemy = new Alchemy(config);
        this.setupSubscriptions();
    }

    private async setupSubscriptions() {
        console.log("Setting up subscriptions...");

        // Debug log
        console.log("Monitoring addresses:", {
            pool: USDC_ETH_POOL,
            router: UNISWAP_V2_ROUTER,
        });

        // Subscribe to pending transactions for both pool and router
        this.alchemy.ws.on(
            {
                method: AlchemySubscription.PENDING_TRANSACTIONS,
                toAddress: UNISWAP_V2_ROUTER,
            },
            (tx) => {
                console.log("Received transaction:", tx);
                this.handlePendingTransaction(tx);
            }
        );

        console.log("Subscriptions established");
    }

    private getTransactionType(input: string): string {
        const functionSignature = input.slice(0, 10);

        switch (functionSignature) {
            case FUNCTION_SIGNATURES.SWAP:
                return "SWAP";
            case FUNCTION_SIGNATURES.ADD_LIQUIDITY:
                return "ADD_LIQUIDITY";
            case FUNCTION_SIGNATURES.REMOVE_LIQUIDITY:
                return "REMOVE_LIQUIDITY";
            case FUNCTION_SIGNATURES.MINT:
                return "MINT";
            case FUNCTION_SIGNATURES.BURN:
                return "BURN";
            case FUNCTION_SIGNATURES.SYNC:
                return "SYNC";
            default:
                console.log("Unknown function signature:", functionSignature);
                return "UNKNOWN";
        }
    }

    private formatValue(value: string): string {
        return `${parseFloat(ethers.formatEther(value)).toFixed(4)} ETH`;
    }

    private getRouterFunctionName(input: string): string {
        const signature = input.slice(0, 10);
        switch (signature) {
            case ROUTER_SIGNATURES.SWAP_ETH_FOR_EXACT_TOKENS:
                return "SWAP_ETH_FOR_EXACT_TOKENS";
            case ROUTER_SIGNATURES.SWAP_EXACT_ETH_FOR_TOKENS:
                return "SWAP_EXACT_ETH_FOR_TOKENS";
            case ROUTER_SIGNATURES.SWAP_EXACT_TOKENS_FOR_ETH:
                return "SWAP_EXACT_TOKENS_FOR_ETH";
            case ROUTER_SIGNATURES.SWAP_TOKENS_FOR_EXACT_ETH:
                return "SWAP_TOKENS_FOR_EXACT_ETH";
            case ROUTER_SIGNATURES.SWAP_EXACT_TOKENS_FOR_TOKENS:
                return "SWAP_EXACT_TOKENS_FOR_TOKENS";
            case ROUTER_SIGNATURES.SWAP_TOKENS_FOR_EXACT_TOKENS:
                return "SWAP_TOKENS_FOR_EXACT_TOKENS";
            default:
                return "UNKNOWN";
        }
    }

    private handlePendingTransaction(transaction: any) {
        try {
            const functionName = this.getRouterFunctionName(transaction.input);
            const formattedValue = this.formatValue(transaction.value);
            const gasPrice = ethers.formatUnits(
                transaction.maxFeePerGas || transaction.gasPrice,
                "gwei"
            );

            console.log({
                type: functionName,
                value: formattedValue,
                from: transaction.from,
                gasPrice: `${parseFloat(gasPrice).toFixed(2)} gwei`,
                hash: transaction.hash,
            });
        } catch (error) {
            console.error("Error processing transaction:", error);
        }
    }
}

// Start the monitor
const monitor = new TransactionMonitor();
