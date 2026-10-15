import { expect, test } from "bun:test";
import { address, createNoopSigner, createSolanaRpc } from "@solana/kit";
import {
  findGameVaultPda,
  findOraclePda,
  getCloseOracleInstructionAsync,
  getOracleInitializedEventDecoder,
  getOracleInitializedEventEncoder,
  TIMBA_PROGRAM_ADDRESS,
  timbaProgram,
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

test("program plugins preserve defaults and per-call address overrides without RPC", async () => {
  const unexpectedNetwork = async () => {
    throw new Error("offline instruction construction must not plan or send transactions");
  };
  const client = {
    rpc: createSolanaRpc("http://127.0.0.1:1"),
    planTransaction: unexpectedNetwork,
    planTransactions: unexpectedNetwork,
    sendTransaction: unexpectedNetwork,
    sendTransactions: unexpectedNetwork,
  };
  const alternate = address("So11111111111111111111111111111111111111112");
  const override = address("11111111111111111111111111111111");
  const signer = createNoopSigner(alternate);
  const input = { oracleOperator: signer, upgradeAuthority: signer, programData: alternate };
  const cases = [
    { plugin: timbaProgram()(client).timba, expected: TIMBA_PROGRAM_ADDRESS },
    { plugin: timbaProgram({})(client).timba, expected: TIMBA_PROGRAM_ADDRESS },
    { plugin: timbaProgram({ programAddress: alternate })(client).timba, expected: alternate },
    {
      plugin: timbaProgram({ programAddress: { address: alternate } })(client).timba,
      expected: alternate,
    },
  ];
  for (const { plugin, expected } of cases) {
    expect(await plugin.pdas.oracle()).toEqual(await findOraclePda({ programAddress: expected }));
    const instruction = await plugin.instructions.closeOracle(input);
    const direct = await getCloseOracleInstructionAsync(input, { programAddress: expected });
    expect(instruction.programAddress).toBe(expected);
    expect(instruction.accounts).toEqual(direct.accounts);
    expect(instruction.data).toEqual(direct.data);
    const perCall = { programAddress: { address: override } };
    expect(await plugin.pdas.oracle(perCall)).toEqual(await findOraclePda(perCall));
    expect((await plugin.instructions.closeOracle(input, perCall)).programAddress).toBe(override);
  }
});
