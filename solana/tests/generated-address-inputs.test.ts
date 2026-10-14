import { expect, test } from "bun:test";
import { address, createNoopSigner } from "@solana/kit";
import {
  findGameVaultPda,
  getOracleInitializedEventDecoder,
  getOracleInitializedEventEncoder,
} from "./generated/index.ts";

test("address-bearing inputs preserve event bytes and PDA seeds", async () => {
  const operator = address("So11111111111111111111111111111111111111112");
  const signer = createNoopSigner(operator);
  const event = {
    operator,
    feePercentage: 5,
    oracleBufferTime: 10n,
    maxTickets: 10,
    maxTimeout: 60n,
    minTimeout: 1n,
  };
  const encoder = getOracleInitializedEventEncoder();
  const bytes = encoder.encode(event);
  expect(encoder.encode({ ...event, operator: signer })).toEqual(bytes);
  expect(getOracleInitializedEventDecoder().decode(bytes)).toEqual(event);
  expect(await findGameVaultPda({ tokenMint: signer })).toEqual(
    await findGameVaultPda({ tokenMint: operator }),
  );
});
