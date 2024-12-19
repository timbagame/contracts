import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import idl from "../target/idl/coinflip.json";
import type { Coinflip } from "../target/types/coinflip";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createWrappedNativeAccount } from "@solana/spl-token";

async function safeAirdrop(connection: Connection, address: PublicKey, amount: number) {
    try {
        const signature = await connection.requestAirdrop(address, amount);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        }, 'confirmed');

        return true;
    } catch (e) {
        console.error('Airdrop failed:', e);
        return false;
    }
}

async function main() {
    // Connect to local Solana network
    const connection = new Connection("http://127.0.0.1:8899", "confirmed");

    // Create or load a keypair for the authority
    const authorityKp = Keypair.generate();

    // Add the target wallet address
    const targetWallet = new PublicKey("HhEWJstpJE6vvrYGS3BaK5ZJbdVAXqGmQ2MBM8FyiPvy");

    // Single airdrop of 1000 SOL
    console.log(`Airdropping 1000 SOL to ${targetWallet.toString()}`);
    const success = await safeAirdrop(connection, targetWallet, 1000 * LAMPORTS_PER_SOL);
    if (!success) {
        throw new Error("Failed to airdrop SOL to target wallet");
    }
    console.log("SOL airdrop completed successfully");

    // Airdrop to authority wallet (need extra SOL for wrapping)
    const authorityAirdrop = await safeAirdrop(connection, authorityKp.publicKey, 1002 * LAMPORTS_PER_SOL);
    if (!authorityAirdrop) {
        throw new Error("Failed to fund authority wallet");
    }

    // Create and fund wrapped SOL account
    console.log("Creating wrapped SOL account...");
    const wsolAccount = await createWrappedNativeAccount(
        connection,
        authorityKp,
        targetWallet,
        1000 * LAMPORTS_PER_SOL
    );

    console.log(`Successfully created wSOL account: ${wsolAccount.toString()}`);

    console.log(`Successfully created wSOL account with 1000 wSOL for ${targetWallet.toString()}`);

    // Setup provider
    const wallet = new Wallet(authorityKp);
    const provider = new AnchorProvider(connection, wallet, {});

    // Create Program interface
    const program = new Program(idl as Coinflip, provider);

    // Derive config PDA
    const [configPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        program.programId
    );

    try {
        // Initialize config
        await program.methods
            .initializeConfig(
                authorityKp.publicKey, // treasury
                new BN(1), // 1% fee
                authorityKp.publicKey  // operator
            )
            .accounts({
                signer: authorityKp.publicKey,
            })
            .signers([authorityKp])
            .rpc();

        console.log("Config initialized successfully!");
        console.log("Config Account:", configPDA.toString());
    } catch (error) {
        console.error("Error initializing config:", error);
    }
}

main().catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
}); 