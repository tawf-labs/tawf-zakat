import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { getArciumEnv, getMXEPublicKeyWithRetry, awaitComputationFinalization, getCompDefAccAddress, getCompDefAccOffset, getComputationAccAddress, getClusterAccAddress, getMXEAccAddress, getMempoolAccAddress, getExecutingPoolAccAddress } from "@arcium-hq/client";
import { RescueCipher } from "@arcium-hq/client";
import * as x25519 from "@noble/curves/ed25519";
import { randomBytes } from "crypto";

const ZKT_PROGRAM_ID = "EpT68DDpM3sasCBqw7VBp7XrKPv7mGQx9sy2JNdXciaD";

function deserializeLE(bytes: Uint8Array): BigInt {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function awaitEvent(program: Program, eventName: string): Promise<any> {
  return new Promise((resolve) => {
    const listener = program.addEventListener(eventName, (event: any) => {
      program.removeEventListener(listener);
      resolve(event);
    });
  });
}

describe("Arcium MXE Integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const programId = new anchor.web3.PublicKey(ZKT_PROGRAM_ID);
  const arciumEnv = getArciumEnv();

  // ============================================================
  // Circuit 1: Zakat Eligibility Check
  // ============================================================

  it("initializes zakat eligibility computation definition", async () => {
    const sig = await program.methods
      .initZkatEligibilityCompDef()
      .accountsPartial({
        payer: (provider.wallet as anchor.Wallet).payer.publicKey,
        mxeAccount: getMXEAccAddress(programId),
        compDefAccount: getCompDefAccAddress(
          programId,
          Buffer.from(getCompDefAccOffset("check_zkat_eligibility")).readUInt32LE()
        ),
      })
      .rpc({ commitment: "confirmed" });

    console.log("Zakat eligibility comp def initialized:", sig);
  });

  it("checks zakat eligibility via Arcium MXE", async () => {
    // Setup encryption
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      programId
    );

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Encrypt inputs
    const plaintext = [
      BigInt(50000),  // income
      BigInt(100000), // assets  
      BigInt(1670000000), // hawl_start (epoch)
      BigInt(42),     // secret
      BigInt(1000),   // amount
    ];
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    // Queue computation
    const computationOffset = new BN(randomBytes(8), "hex");
    const eligibilityEvent = awaitEvent(program, "ZkatEligibilityEvent");

    const queueSig = await program.methods
      .checkZkatEligibility(
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(ciphertext[1]),
        Array.from(ciphertext[2]),
        Array.from(ciphertext[3]),
        Array.from(ciphertext[4]),
        Array.from(publicKey),
        new BN(deserializeLE(nonce).toString()),
        new BN(100000),   // nisab_threshold
        new BN(Date.now() / 1000), // current_time
        new BN(1), // recipient_0
        new BN(2), // recipient_1
        new BN(1), // cycle_id
      )
      .accountsPartial({
        payer: (provider.wallet as anchor.Wallet).payer.publicKey,
        mxeAccount: getMXEAccAddress(programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset),
        compDefAccount: getCompDefAccAddress(
          programId,
          Buffer.from(getCompDefAccOffset("check_zkat_eligibility")).readUInt32LE()
        ),
        clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
      })
      .rpc({ commitment: "confirmed" });

    console.log("Zakat eligibility computation queued:", queueSig);

    // Wait for computation
    const finalizeSig = await awaitComputationFinalization(
      provider as anchor.AnchorProvider,
      computationOffset,
      programId,
      "confirmed"
    );
    console.log("Computation finalized:", finalizeSig);

    // Verify event
    const event = await eligibilityEvent;
    expect(event).to.not.be.undefined;
    expect(event.nonce).to.not.be.undefined;
  });

  // ============================================================
  // Circuit 2: Vote Aggregation
  // ============================================================

  it("initializes vote aggregation computation definition", async () => {
    const sig = await program.methods
      .initVoteAggregationCompDef()
      .accountsPartial({
        payer: (provider.wallet as anchor.Wallet).payer.publicKey,
        mxeAccount: getMXEAccAddress(programId),
        compDefAccount: getCompDefAccAddress(
          programId,
          Buffer.from(getCompDefAccOffset("aggregate_votes")).readUInt32LE()
        ),
      })
      .rpc({ commitment: "confirmed" });

    console.log("Vote aggregation comp def initialized:", sig);
  });

  it("aggregates sharia council votes via Arcium MXE", async () => {
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      programId
    );

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    // Pack 5 votes into one ciphertext
    const votes = [
      { approved: true, weight: 1 },
      { approved: true, weight: 1 },
      { approved: true, weight: 2 },
      { approved: false, weight: 1 },
      { approved: false, weight: 1 },
    ];
    const flatVotes = votes.flatMap(v => [v.approved ? 1n : 0n, BigInt(v.weight)]);
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(flatVotes, nonce);

    const computationOffset = new BN(randomBytes(8), "hex");
    const voteEvent = awaitEvent(program, "VoteAggregationEvent");

    const queueSig = await program.methods
      .aggregateVotes(
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(publicKey),
        new BN(deserializeLE(nonce).toString()),
        new BN(1), // proposal_id
        3, // quorum_threshold
      )
      .accountsPartial({
        payer: (provider.wallet as anchor.Wallet).payer.publicKey,
        mxeAccount: getMXEAccAddress(programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset),
        compDefAccount: getCompDefAccAddress(
          programId,
          Buffer.from(getCompDefAccOffset("aggregate_votes")).readUInt32LE()
        ),
        clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
      })
      .rpc({ commitment: "confirmed" });

    console.log("Vote aggregation queued:", queueSig);
  });

  // ============================================================
  // Circuit 3: Private Donation
  // ============================================================

  it("initializes private donation computation definition", async () => {
    const sig = await program.methods
      .initPrivateDonationCompDef()
      .accountsPartial({
        payer: (provider.wallet as anchor.Wallet).payer.publicKey,
        mxeAccount: getMXEAccAddress(programId),
        compDefAccount: getCompDefAccAddress(
          programId,
          Buffer.from(getCompDefAccOffset("process_private_donation")).readUInt32LE()
        ),
      })
      .rpc({ commitment: "confirmed" });

    console.log("Private donation comp def initialized:", sig);
  });

  it("processes private donation via Arcium MXE", async () => {
    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      programId
    );

    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const plaintext = [
      BigInt(1),  // donor_0
      BigInt(2),  // donor_1
      BigInt(500), // amount
      BigInt(3),  // commitment_0
      BigInt(4),  // commitment_1
      BigInt(Date.now() / 1000), // timestamp
    ];
    const nonce = randomBytes(16);
    const ciphertext = cipher.encrypt(plaintext, nonce);

    const computationOffset = new BN(randomBytes(8), "hex");
    const donationEvent = awaitEvent(program, "PrivateDonationEvent");

    const queueSig = await program.methods
      .processPrivateDonation(
        computationOffset,
        Array.from(ciphertext[0]),
        Array.from(ciphertext[1]),
        Array.from(ciphertext[2]),
        Array.from(ciphertext[3]),
        Array.from(ciphertext[4]),
        Array.from(ciphertext[5]),
        Array.from(publicKey),
        new BN(deserializeLE(nonce).toString()),
        new BN(1), // pool_id
      )
      .accountsPartial({
        payer: (provider.wallet as anchor.Wallet).payer.publicKey,
        mxeAccount: getMXEAccAddress(programId),
        mempoolAccount: getMempoolAccAddress(arciumEnv.arciumClusterOffset),
        executingPool: getExecutingPoolAccAddress(arciumEnv.arciumClusterOffset),
        computationAccount: getComputationAccAddress(arciumEnv.arciumClusterOffset, computationOffset),
        compDefAccount: getCompDefAccAddress(
          programId,
          Buffer.from(getCompDefAccOffset("process_private_donation")).readUInt32LE()
        ),
        clusterAccount: getClusterAccAddress(arciumEnv.arciumClusterOffset),
      })
      .rpc({ commitment: "confirmed" });

    console.log("Private donation queued:", queueSig);
  });
});
