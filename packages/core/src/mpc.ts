// NEAR Chain Signatures: derive the EVM address an account controls through the MPC network.
// child = root + epsilon·G, epsilon = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:{predecessor},{path}")
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { base58 } from "@scure/base";
import { bytesToHex, keccak256 } from "viem";

export const MPC = {
  testnet: {
    contract: "v1.signer-prod.testnet",
    rootKey: "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3",
  },
  mainnet: {
    contract: "v1.signer",
    rootKey: "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya",
  },
} as const;

/** Lowercase 0x address controlled by `predecessor` at `path`. */
export function deriveEvmAddress(network: keyof typeof MPC, predecessor: string, path: string): string {
  const root = secp256k1.Point.fromBytes(new Uint8Array([4, ...base58.decode(MPC[network].rootKey.split(":")[1]!)]));
  const epsilon = sha3_256(new TextEncoder().encode(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`));
  const child = root.add(secp256k1.Point.BASE.multiply(secp256k1.Point.Fn.create(BigInt(bytesToHex(epsilon)))));
  return `0x${keccak256(child.toBytes(false).slice(1)).slice(-40)}`;
}
