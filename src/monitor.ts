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

        // Subscribe to pending transactions for both pool and router
        this.alchemy.ws.on(
            {
                method: AlchemySubscription.PENDING_TRANSACTIONS,
                toAddress: [USDC_ETH_POOL, UNISWAP_V2_ROUTER],
            },
            (tx) => this.handlePendingTransaction(tx)
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

    private handlePendingTransaction(transaction: any) {
        const toAddress = transaction.to?.toLowerCase();
        if (
            toAddress === USDC_ETH_POOL.toLowerCase() ||
            (toAddress === UNISWAP_V2_ROUTER.toLowerCase() &&
                transaction.input.includes(
                    USDC_ETH_POOL.toLowerCase().slice(2)
                ))
        ) {
            const txType = this.getTransactionType(transaction.input);

            const txData: TransactionData = {
                hash: transaction.hash,
                from: transaction.from,
                to: transaction.to,
                value: transaction.value,
                type: txType,
                timestamp: Date.now(),
            };

            console.log(`New ${txType} transaction:`, {
                hash: txData.hash,
                from: txData.from,
                value: ethers.formatEther(txData.value),
            });
        }
    }
}

// Start the monitor
const monitor = new TransactionMonitor();
