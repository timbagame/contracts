import idl from "../target/idl/coinflip.json";
import type { Coinflip } from "../target/types/coinflip";
import { Connection, LAMPORTS_PER_SOL, PublicKey, Keypair } from "@solana/web3.js";
import {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";

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

    // Load wallet from default Solana CLI path
    const walletPath = os.homedir() + "/.config/solana/id.json";
    const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
    const authorityKp = Keypair.fromSecretKey(new Uint8Array(secretKey));
    const wallet = new anchor.Wallet(authorityKp);

    // Setup provider
    const provider = new anchor.AnchorProvider(connection, wallet, anchor.AnchorProvider.defaultOptions());
    anchor.setProvider(provider);

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
    const authorityBalance = await connection.getBalance(wallet.publicKey);
    const neededAmount = 1002 * LAMPORTS_PER_SOL;
    if (authorityBalance < neededAmount) {
        console.log(`Airdropping ${neededAmount / LAMPORTS_PER_SOL} SOL to authority ${wallet.publicKey.toString()}`);
        const authorityAirdrop = await safeAirdrop(connection, wallet.publicKey, neededAmount - authorityBalance);
        if (!authorityAirdrop) {
            throw new Error("Failed to fund authority wallet");
        }
    } else {
        console.log(`Authority wallet ${wallet.publicKey.toString()} already has sufficient funds.`);
    }

    // Create Program interface
    const program = new anchor.Program(idl as Coinflip, provider);

    // Derive oracle PDA
    const [oraclePDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("oracle")],
        program.programId
    );

    try {
        // Check if the oracle account already exists
        const oracleAccount = await connection.getAccountInfo(oraclePDA);

        if (oracleAccount) {
            console.log("Oracle account already exists:", oraclePDA.toString());
        } else {
            // Initialize oracle only if it doesn't exist
            await program.methods
                .initializeOracle(
                    new anchor.BN(1), // 1% fee
                    300, // oracle_buffer_time: 5 minutes in seconds
                    100, // max_players
                    3600, // max_timeout: 1 hour in seconds
                    300, // min_timeout: 5 minutes in seconds
                )
                .accounts({
                    authority: wallet.publicKey,
                })
                .rpc();

            console.log("Oracle initialized successfully!");
            console.log("Oracle Account:", oraclePDA.toString());
        }
    } catch (error) {
        console.error("Error with oracle setup:", error);
    }

    // Let's initialize a token (wSOL in this case)
    console.log("Initializing wSOL token...");

    // Use the standard Wrapped SOL mint address
    const WRAPPED_SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

    // Find token PDA
    const [tokenPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("game_token"), WRAPPED_SOL_MINT.toBuffer()],
        program.programId
    );

    // Find game vault PDA
    const [gameVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("game_vault"), WRAPPED_SOL_MINT.toBuffer()],
        program.programId
    );

    // Find game token account (ATA)
    const gameTokenAccountATA = getAssociatedTokenAddressSync(
        WRAPPED_SOL_MINT,
        gameVaultPDA,
        true // allowOwnerOffCurve - PDA can be off-curve
    );

    try {
        // Check if the token account already exists
        const tokenAccount = await connection.getAccountInfo(tokenPDA);

        if (tokenAccount) {
            console.log("Token account already exists:", tokenPDA.toString());
        } else {
            // Initialize token
            await program.methods
                .initializeToken(
                    "WSOL",            // ticker
                    new anchor.BN(10_000_000), // min_amount (0.01 SOL in lamports)
                    true               // enabled
                )
                .accounts({
                    authority: wallet.publicKey,
                    tokenMint: WRAPPED_SOL_MINT,
                    oracle: oraclePDA,
                    gameToken: tokenPDA, // The game token state account PDA
                    gameVault: gameVaultPDA,
                    gameTokenAccount: gameTokenAccountATA,
                    systemProgram: anchor.web3.SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .preInstructions([
                    createAssociatedTokenAccountInstruction(
                        wallet.publicKey, // Payer
                        gameTokenAccountATA, // ATA address
                        gameVaultPDA, // Owner (the vault PDA)
                        WRAPPED_SOL_MINT // Mint
                    )
                ])
                .rpc();

            console.log("Token initialized successfully!");
            console.log("Token Account:", tokenPDA.toString());
        }
    } catch (error) {
        console.error("Error initializing token:", error);
    }
}

main().catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
});
